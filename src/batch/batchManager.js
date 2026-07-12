import { AppError } from "../utils/errors.js";
import { clampNumber, sleep } from "../utils/helpers.js";
import { analyzeRecords } from "../templates/variables.js";
import { processRecord } from "../ai/processor.js";
import { JOB_STATUS } from "./jobState.js";
import { withRetry } from "./retryPolicy.js";

function countsFor(total) {
  return { total, queued: total, processing: 0, completed: 0, failed: 0, skipped: 0 };
}

export function settledJobStatus(counts, { canceled = false } = {}) {
  if (canceled) return JOB_STATUS.CANCELED;
  if ((counts.failed ?? 0) > 0 && (counts.completed ?? 0) === 0) return JOB_STATUS.FAILED;
  return JOB_STATUS.COMPLETED;
}

export function createBatchManager({
  repositories,
  config,
  providerRegistry,
  logger,
  cacheRepository,
  browserLauncher
}) {
  const active = new Map();

  async function runJob(jobId) {
    const job = repositories.jobs.get(jobId);
    if (!job) return;
    const options = job.options;
    const projectId = job.projectId || options.projectId || "project_default";
    repositories.jobs.update(jobId, { status: JOB_STATUS.RUNNING });
    const records = repositories.records.findMany(options.recordIds, { projectId });
    const queue = [...records];
    const concurrency = clampNumber(
      options.concurrency,
      1,
      config.ai.maxConcurrency,
      config.ai.defaultConcurrency
    );
    const delayMs = clampNumber(options.delayMs, 0, config.ai.maxDelayMs, config.ai.defaultDelayMs);
    const state = { cancelRequested: false };
    active.set(jobId, state);

    async function worker() {
      while (queue.length > 0) {
        const latestJob = repositories.jobs.get(jobId);
        if (state.cancelRequested || latestJob?.cancelRequested) break;
        const record = queue.shift();
        repositories.jobs.increment(jobId, { queued: -1, processing: 1 });
        const result = repositories.results.createProcessing({
          projectId,
          jobId,
          recordId: record.id,
          templateName: options.templateName,
          provider: options.provider,
          model: options.model
        });
        try {
          const payload = await withRetry(
            () =>
              processRecord({
                record,
                template: options.template,
                addendumName: options.addendumName,
                provider: options.provider,
                model: options.model,
                researchEnabled: options.researchEnabled,
                config,
                providerRegistry,
                cacheRepository,
                browserLauncher,
                logger
              }),
            config,
            logger
          );
          repositories.results.saveCompleted(result.id, payload);
          repositories.jobs.increment(jobId, { processing: -1, completed: 1 });
        } catch (error) {
          logger.warn({ err: error, recordId: record.id, jobId }, "Record processing failed");
          repositories.results.saveFailed(result.id, error);
          repositories.jobs.increment(jobId, { processing: -1, failed: 1 });
        }
        if (delayMs > 0) await sleep(delayMs);
      }
    }

    try {
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      const finalJob = repositories.jobs.get(jobId);
      const counts = finalJob.counts;
      const status = settledJobStatus(counts, {
        canceled: finalJob.cancelRequested || state.cancelRequested
      });
      repositories.jobs.update(jobId, {
        status,
        error:
          status === JOB_STATUS.FAILED
            ? { code: "ALL_RECORDS_FAILED", message: "Every selected record failed to process." }
            : null,
        counts: { ...counts, queued: Math.max(0, counts.queued), processing: 0 }
      });
    } catch (error) {
      repositories.jobs.update(jobId, {
        status: JOB_STATUS.FAILED,
        error: { code: error.code || "JOB_FAILED", message: error.message || String(error) }
      });
    } finally {
      active.delete(jobId);
    }
  }

  return {
    createJob({ records, template, options }) {
      if (!records.length)
        throw new AppError("NO_RECORDS_SELECTED", "No records were selected for processing.", 400);
      providerRegistry.validate(options.provider, options.model);
      const analysis = analyzeRecords(template.content, records);
      const blockedRows = analysis.rows.filter((row) => !row.canProcess);
      if (blockedRows.length && !options.continueOnWarnings) {
        throw new AppError(
          "TEMPLATE_VARIABLE_MISSING",
          "Required template variables are missing for one or more records.",
          400,
          {
            blockedRows
          }
        );
      }

      const processableRecords = records.filter(
        (record) => analysis.rows.find((row) => row.recordId === record.id)?.canProcess
      );
      const job = repositories.jobs.create({
        projectId: options.projectId,
        options: {
          ...options,
          templateName: template.name,
          template,
          recordIds: processableRecords.map((record) => record.id)
        },
        counts: countsFor(processableRecords.length)
      });
      setImmediate(() => runJob(job.id));
      return job;
    },

    stop(jobId) {
      const job = repositories.jobs.get(jobId);
      if (!job) throw new AppError("JOB_NOT_FOUND", "Job was not found.", 404);
      const state = active.get(jobId);
      if (state) state.cancelRequested = true;
      return repositories.jobs.update(jobId, { cancelRequested: true, status: JOB_STATUS.STOPPING });
    },

    retryFailed(jobId) {
      const job = repositories.jobs.get(jobId);
      if (!job) throw new AppError("JOB_NOT_FOUND", "Job was not found.", 404);
      const failed = repositories.results.failedForJob(jobId);
      if (!failed.length)
        throw new AppError("NO_FAILED_RESULTS", "This job has no failed results to retry.", 400);
      const records = repositories.records.findMany(
        failed.map((result) => result.recordId),
        {
          projectId: job.projectId
        }
      );
      return this.createJob({
        records,
        template: job.options.template,
        options: { ...job.options, recordIds: records.map((record) => record.id) }
      });
    }
  };
}
