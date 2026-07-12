const state = {
  config: null,
  modelCatalog: [],
  modelSyncStatus: null,
  records: [],
  templates: [],
  addenda: [],
  results: [],
  activeRecordId: null,
  activeResultId: null,
  activeJobId: null,
  unsaved: false,
  pollTimer: null
};

const $ = (id) => document.getElementById(id);

function setStatus(message, isError = false) {
  $("statusLine").textContent = message;
  $("statusLine").style.color = isError ? "#a73535" : "";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "content-type": "application/json", ...(options.headers || {}) }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || `HTTP ${response.status}`);
  }
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response;
}

function selectedRecordIds() {
  return [...document.querySelectorAll(".record-check:checked")].map((input) => Number(input.value));
}

function activeRecord() {
  return state.records.find((record) => record.id === state.activeRecordId) || state.records[0] || null;
}

function activeResult() {
  return state.results.find((result) => result.id === state.activeResultId) || state.results[0] || null;
}

function populateSelect(select, items, getValue, getLabel, configureOption = () => {}) {
  select.innerHTML = "";
  for (const item of items) {
    const option = document.createElement("option");
    option.value = getValue(item);
    option.textContent = getLabel(item);
    configureOption(option, item);
    select.append(option);
  }
}

function appendCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value ?? "";
  row.append(cell);
  return cell;
}

function renderRecords() {
  const rows = $("recordRows");
  rows.innerHTML = "";
  for (const record of state.records) {
    const tr = document.createElement("tr");
    if (record.id === state.activeRecordId) tr.classList.add("is-active");
    tr.innerHTML = `
      <td><input class="record-check" type="checkbox" value="${record.id}" aria-label="Select ${record.displayName}"></td>
      <td>${record.normalized.id ?? record.recordKey}</td>
      <td><button type="button" class="link-button" data-record-id="${record.id}">${record.displayName}</button></td>
      <td>${record.status}</td>`;
    rows.append(tr);
  }
  rows.querySelectorAll("[data-record-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeRecordId = Number(button.dataset.recordId);
      renderRecords();
      syncRecordSelect();
    });
  });
  populateSelect(
    $("recordSelect"),
    state.records,
    (record) => record.id,
    (record) => `${record.id}: ${record.displayName}`
  );
  syncRecordSelect();
}

function syncRecordSelect() {
  const record = activeRecord();
  if (record) {
    state.activeRecordId = record.id;
    $("recordSelect").value = String(record.id);
  }
}

function renderResults() {
  const rows = $("resultRows");
  rows.innerHTML = "";
  for (const result of state.results) {
    const record = state.records.find((item) => item.id === result.recordId);
    const tr = document.createElement("tr");
    if (result.id === state.activeResultId) tr.classList.add("is-active");

    const recordCell = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "link-button";
    button.dataset.resultId = result.id;
    button.textContent = record?.displayName || result.recordId;
    recordCell.append(button);
    tr.append(recordCell);
    appendCell(tr, result.status);
    appendCell(
      tr,
      result.status === "failed" ? result.error?.message || "Processing failed." : result.subject
    );
    rows.append(tr);
  }
  rows.querySelectorAll("[data-result-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectResult(button.dataset.resultId);
    });
  });
  if (!state.activeResultId && state.results.length) state.activeResultId = state.results[0].id;
  renderActiveResult();
}

function renderActiveResult() {
  const result = activeResult();
  const disabled = !result;
  for (const id of [
    "subjectInput",
    "bodyInput",
    "saveEditButton",
    "discardEditButton",
    "regenerateButton",
    "copySubjectButton",
    "copyRenderedButton",
    "copyHtmlButton",
    "copyTextButton",
    "exportOneButton",
    "printButton"
  ]) {
    $(id).disabled = disabled;
  }
  if (!result) {
    $("subjectInput").value = "";
    $("bodyInput").value = "";
    $("emailPreview").srcdoc = "";
    $("resultPrompt").textContent = "";
    $("resultError").hidden = true;
    $("resultError").textContent = "";
    return;
  }
  const errorText = result.status === "failed" ? result.error?.message || "Processing failed." : "";
  $("resultError").hidden = !errorText;
  $("resultError").textContent = errorText;
  $("subjectInput").value = result.subject;
  $("bodyInput").value = result.bodyHtml;
  $("emailPreview").srcdoc = result.emailHtml || "";
  $("resultPrompt").textContent =
    `${result.prompt || ""}\n\nResearch:\n${JSON.stringify(result.research || {}, null, 2)}`;
  state.unsaved = false;
}

function formatJobSummary(job) {
  const summary = `${job.status}: ${job.counts.completed}/${job.counts.total} completed, ${job.counts.failed} failed`;
  return job.error?.message ? `${summary} (${job.error.message})` : summary;
}

async function selectResult(id) {
  if (state.unsaved && !confirm("Discard unsaved changes?")) return;
  state.activeResultId = id;
  renderResults();
}

function renderConfigControls() {
  const providers = state.config.ai.providers;
  populateSelect(
    $("providerSelect"),
    providers,
    (provider) => provider.id,
    (provider) => `${provider.label}${provider.hasCredential ? "" : " (needs key)"}`
  );
  $("providerSelect").value = state.config.ai.defaultProvider;
  renderModels();
  $("concurrencyInput").max = state.config.app.ai.maxConcurrency;
  $("concurrencyInput").value = state.config.app.ai.defaultConcurrency;
  $("delayInput").max = state.config.app.ai.maxDelayMs;
  $("delayInput").value = state.config.app.ai.defaultDelayMs;
  $("researchEnabled").checked = state.config.app.research.enabled;
}

function renderModels() {
  const provider =
    state.config.ai.providers.find((item) => item.id === $("providerSelect").value) ||
    state.config.ai.providers[0];
  const supportsStructured = (model) =>
    model.compatible !== false && model.capabilities.includes("structured");
  populateSelect(
    $("modelSelect"),
    provider.models,
    (model) => model.id,
    (model) =>
      supportsStructured(model)
        ? model.label
        : `${model.label} (${model.exclusionReason || model.capabilities.join("/")})`,
    (option, model) => {
      option.disabled = !supportsStructured(model);
      option.title = model.exclusionReason || model.capabilities.join(", ");
    }
  );
  const selectedModel =
    provider.models.find((model) => model.id === state.config.ai.defaultModel && supportsStructured(model)) ||
    provider.models.find((model) => supportsStructured(model)) ||
    provider.models[0];
  if (selectedModel) $("modelSelect").value = selectedModel.id;
}

function renderModelCatalog() {
  const statusRows = $("providerStatusRows");
  statusRows.innerHTML = "";
  for (const provider of state.modelSyncStatus?.providers ?? []) {
    const tr = document.createElement("tr");
    appendCell(tr, provider.providerId);
    appendCell(tr, provider.status);
    appendCell(tr, provider.lastSuccessAt || "Never");
    appendCell(tr, String(provider.modelsAccepted ?? 0));
    statusRows.append(tr);
  }

  const modelRows = $("modelCatalogRows");
  modelRows.innerHTML = "";
  for (const model of state.modelCatalog.slice(0, 80)) {
    const tr = document.createElement("tr");
    appendCell(tr, model.providerId);
    appendCell(tr, model.providerModelId);
    appendCell(tr, model.availability);
    appendCell(
      tr,
      model.compatibility?.compatible ? "Compatible" : model.compatibility?.reasons?.join(", ") || "Excluded"
    );
    modelRows.append(tr);
  }

  const latest = state.modelSyncStatus?.latestRuns?.[0];
  $("modelSyncSummary").textContent = latest
    ? `${latest.status} · ${latest.completedAt || latest.startedAt}`
    : "Configured fallback catalog loaded";
}

async function refreshAll() {
  const [config, records, templates, addenda, results, modelCatalog] = await Promise.all([
    api("/api/config"),
    api("/api/records"),
    api("/api/templates"),
    api("/api/addenda"),
    api("/api/results"),
    api("/api/models/catalog")
  ]);
  state.config = config;
  state.records = records.records;
  state.templates = templates.templates;
  state.addenda = addenda.addenda;
  state.results = results.results;
  state.modelCatalog = modelCatalog.models;
  state.modelSyncStatus = modelCatalog.status;
  if (!state.activeRecordId && state.records[0]) state.activeRecordId = state.records[0].id;
  renderConfigControls();
  populateSelect(
    $("templateSelect"),
    state.templates,
    (template) => template.name,
    (template) => template.name
  );
  populateSelect(
    $("addendumSelect"),
    [{ name: "" }, ...state.addenda],
    (item) => item.name,
    (item) => item.name || "None"
  );
  renderRecords();
  renderResults();
  renderModelCatalog();
  setStatus(`${state.records.length} records · ${state.results.length} results`);
}

async function refreshModels() {
  $("modelSyncButton").disabled = true;
  setStatus("Refreshing model catalog");
  try {
    await api("/api/models/sync", { method: "POST", body: "{}" });
    const [config, modelCatalog] = await Promise.all([api("/api/config"), api("/api/models/catalog")]);
    state.config = config;
    state.modelCatalog = modelCatalog.models;
    state.modelSyncStatus = modelCatalog.status;
    renderConfigControls();
    renderModelCatalog();
    setStatus("Model catalog refreshed");
  } finally {
    $("modelSyncButton").disabled = false;
  }
}

async function loadSample() {
  const payload = await api("/api/records/load-sample", { method: "POST", body: "{}" });
  state.records = payload.records;
  state.activeRecordId = state.records[0]?.id || null;
  renderRecords();
  setStatus(`Loaded ${payload.count} sample records`);
}

async function importFile(file) {
  const form = new FormData();
  form.append("file", file);
  const payload = await api("/api/records/import", { method: "POST", body: form });
  state.records = payload.records;
  state.activeRecordId = state.records[0]?.id || null;
  renderRecords();
  setStatus(`Imported ${payload.count} records`);
}

async function previewPrompt() {
  const record = activeRecord();
  if (!record) throw new Error("Load records first.");
  const payload = await api("/api/templates/preview", {
    method: "POST",
    body: JSON.stringify({ templateName: $("templateSelect").value, recordId: record.id })
  });
  $("promptPreview").textContent = payload.rendered;
  const messages = [];
  if (payload.analysis.malformed.length)
    messages.push(...payload.analysis.malformed.map((item) => item.message));
  if (payload.analysis.missing.length) messages.push(`Missing: ${payload.analysis.missing.join(", ")}`);
  if (payload.analysis.blank.length) messages.push(`Blank: ${payload.analysis.blank.join(", ")}`);
  $("templateWarnings").textContent = messages.join(" ");
}

async function createJob(mode) {
  const record = activeRecord();
  const body = {
    mode,
    recordId: record?.id,
    recordIds: selectedRecordIds(),
    startId: Number($("rangeStart").value || 0) || undefined,
    endId: Number($("rangeEnd").value || 0) || undefined,
    templateName: $("templateSelect").value,
    addendumName: $("addendumSelect").value || null,
    addendumEnabled: $("addendumEnabled").checked,
    provider: $("providerSelect").value,
    model: $("modelSelect").value,
    researchEnabled: $("researchEnabled").checked,
    concurrency: Number($("concurrencyInput").value),
    delayMs: Number($("delayInput").value)
  };
  const payload = await api("/api/jobs", { method: "POST", body: JSON.stringify(body) });
  state.activeJobId = payload.job.id;
  $("stopButton").disabled = false;
  $("retryButton").disabled = false;
  setStatus(`Started job ${payload.job.id}`);
  startPolling();
}

function startPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    if (!state.activeJobId) return;
    const [job, results] = await Promise.all([api(`/api/jobs/${state.activeJobId}`), api("/api/results")]);
    state.results = results.results;
    $("jobSummary").textContent = formatJobSummary(job.job);
    renderResults();
    if (["completed", "failed", "canceled"].includes(job.job.status)) {
      clearInterval(state.pollTimer);
      $("stopButton").disabled = true;
      setStatus(job.job.error?.message || `Job ${job.job.status}`, job.job.status === "failed");
    }
  }, 1200);
}

async function saveEdits() {
  const result = activeResult();
  if (!result) return;
  const payload = await api(`/api/results/${result.id}`, {
    method: "PATCH",
    body: JSON.stringify({ subject: $("subjectInput").value, bodyHtml: $("bodyInput").value })
  });
  const index = state.results.findIndex((item) => item.id === result.id);
  state.results[index] = payload.result;
  state.unsaved = false;
  renderResults();
  setStatus("Edits saved");
}

async function regenerate() {
  const result = activeResult();
  if (!result) return;
  const payload = await api(`/api/results/${result.id}/regenerate`, {
    method: "POST",
    body: JSON.stringify({
      provider: $("providerSelect").value,
      model: $("modelSelect").value,
      researchEnabled: $("researchEnabled").checked
    })
  });
  state.results.unshift(payload.result);
  state.activeResultId = payload.result.id;
  renderResults();
  setStatus("Result regenerated");
}

async function copyText(value, label) {
  await navigator.clipboard.writeText(value);
  setStatus(`${label} copied`);
}

async function copyRendered() {
  const result = activeResult();
  if (!result) return;
  const htmlBlob = new Blob([result.emailHtml], { type: "text/html" });
  const textBlob = new Blob([result.bodyText], { type: "text/plain" });
  if (navigator.clipboard.write && window.ClipboardItem) {
    await navigator.clipboard.write([new ClipboardItem({ "text/html": htmlBlob, "text/plain": textBlob })]);
  } else {
    await navigator.clipboard.writeText(result.bodyText);
  }
  setStatus("Rendered email copied");
}

function bind() {
  $("refreshButton").addEventListener("click", () =>
    refreshAll().catch((error) => setStatus(error.message, true))
  );
  $("modelSyncButton").addEventListener("click", () =>
    refreshModels().catch((error) => setStatus(error.message, true))
  );
  $("sampleButton").addEventListener("click", () =>
    loadSample().catch((error) => setStatus(error.message, true))
  );
  $("fileInput").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) importFile(file).catch((error) => setStatus(error.message, true));
  });
  $("recordSelect").addEventListener("change", () => {
    state.activeRecordId = Number($("recordSelect").value);
    renderRecords();
  });
  $("selectAllRecords").addEventListener("change", () => {
    document.querySelectorAll(".record-check").forEach((input) => {
      input.checked = $("selectAllRecords").checked;
    });
  });
  $("providerSelect").addEventListener("change", renderModels);
  $("previewButton").addEventListener("click", () =>
    previewPrompt().catch((error) => setStatus(error.message, true))
  );
  $("processCurrentButton").addEventListener("click", () =>
    createJob("current").catch((error) => setStatus(error.message, true))
  );
  $("processSelectedButton").addEventListener("click", () =>
    createJob("selected").catch((error) => setStatus(error.message, true))
  );
  $("processRangeButton").addEventListener("click", () =>
    createJob("range").catch((error) => setStatus(error.message, true))
  );
  $("processAllButton").addEventListener("click", () =>
    createJob("all").catch((error) => setStatus(error.message, true))
  );
  $("stopButton").addEventListener("click", () =>
    api(`/api/jobs/${state.activeJobId}/stop`, { method: "POST", body: "{}" }).catch((error) =>
      setStatus(error.message, true)
    )
  );
  $("retryButton").addEventListener("click", () =>
    api(`/api/jobs/${state.activeJobId}/retry`, { method: "POST", body: "{}" })
      .then(startPolling)
      .catch((error) => setStatus(error.message, true))
  );
  $("saveEditButton").addEventListener("click", () =>
    saveEdits().catch((error) => setStatus(error.message, true))
  );
  $("discardEditButton").addEventListener("click", renderActiveResult);
  $("regenerateButton").addEventListener("click", () =>
    regenerate().catch((error) => setStatus(error.message, true))
  );
  $("subjectInput").addEventListener("input", () => {
    state.unsaved = true;
  });
  $("bodyInput").addEventListener("input", () => {
    state.unsaved = true;
  });
  $("copySubjectButton").addEventListener("click", () =>
    copyText(activeResult()?.subject || "", "Subject").catch((error) => setStatus(error.message, true))
  );
  $("copyRenderedButton").addEventListener("click", () =>
    copyRendered().catch((error) => setStatus(error.message, true))
  );
  $("copyHtmlButton").addEventListener("click", () =>
    copyText(activeResult()?.emailHtml || "", "HTML").catch((error) => setStatus(error.message, true))
  );
  $("copyTextButton").addEventListener("click", () =>
    copyText(activeResult()?.bodyText || "", "Plain text").catch((error) => setStatus(error.message, true))
  );
  $("exportOneButton").addEventListener("click", () => {
    const result = activeResult();
    if (result) window.location.href = `/api/results/${result.id}/export`;
  });
  $("exportAllButton").addEventListener("click", () =>
    api("/api/results/export", { method: "POST", body: "{}" })
      .then((payload) => setStatus(`Exported ${payload.export.filename}`))
      .catch((error) => setStatus(error.message, true))
  );
  $("printButton").addEventListener("click", () => window.print());
  window.addEventListener("beforeunload", (event) => {
    if (state.unsaved) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

bind();
refreshAll().catch((error) => setStatus(error.message, true));
