import { sleep } from "../utils/helpers.js";

export function isTransientError(error) {
  const status = error.status ?? error.statusCode;
  if (status === 408 || status === 409 || status === 425 || status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return /timeout|temporar|network|rate limit|ECONNRESET|ETIMEDOUT/i.test(error.message ?? "");
}

export function backoffDelay(attempt, config) {
  const exponential = config.ai.backoffMinMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(config.ai.backoffMaxMs, exponential);
}

export async function withRetry(operation, config, logger, signal = null) {
  let lastError;
  for (let attempt = 1; attempt <= config.ai.maxRetries + 1; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw signal.reason ?? error;
      if (attempt > config.ai.maxRetries || !isTransientError(error)) throw error;
      const delay = backoffDelay(attempt, config);
      logger.warn(
        { attempt, delay, code: error.code, status: error.status },
        "Transient processing failure; retrying"
      );
      await sleep(delay, signal);
    }
  }
  throw lastError;
}
