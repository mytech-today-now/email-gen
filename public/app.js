const state = {
  config: null,
  modelCatalog: [],
  modelSyncStatus: null,
  projects: [],
  activeProjectId: null,
  projectApiAvailable: true,
  records: [],
  templates: [],
  addenda: [],
  results: [],
  activeRecordId: null,
  activeResultId: null,
  selectedResultIds: new Set(),
  activeJobId: null,
  unsaved: false,
  pollTimer: null
};

const $ = (id) => document.getElementById(id);

function setStatus(message, isError = false) {
  $("statusLine").textContent = message;
  $("statusLine").style.color = isError ? "#a73535" : "";
  if (isError) console.error(message);
  else console.info(message);
}

function logClientWarning(message, details = {}) {
  console.warn(message, details);
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
    const error = new Error(payload?.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload?.error?.code;
    error.requestId = payload?.error?.requestId;
    error.path = path;
    console.error("API request failed", {
      path,
      status: response.status,
      code: error.code,
      requestId: error.requestId,
      message: error.message
    });
    throw error;
  }
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response;
}

function projectQuery() {
  return state.projectApiAvailable && state.activeProjectId
    ? `projectId=${encodeURIComponent(state.activeProjectId)}`
    : "";
}

function withProject(path) {
  const query = projectQuery();
  if (!query) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

function selectedRecordIds() {
  return [...document.querySelectorAll(".record-check:checked")].map((input) => Number(input.value));
}

function selectedResultIds() {
  return [...state.selectedResultIds];
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

function cleanContact(value) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validEmail(value) {
  const candidate = cleanContact(value);
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(candidate) ? candidate : "";
}

function contactForResult(result) {
  const record = state.records.find((item) => item.id === result?.recordId);
  const normalized = record?.normalized ?? {};
  const emailFields = [
    "email",
    "emailAddress",
    "recipientEmail",
    "contactEmail",
    "workEmail",
    "businessEmail",
    "ownerEmail"
  ];
  for (const field of emailFields) {
    const email = validEmail(normalized[field]);
    if (email) return { label: email, href: `mailto:${email}` };
  }
  for (const [key, value] of Object.entries(normalized)) {
    if (/email/i.test(key)) {
      const email = validEmail(value);
      if (email) return { label: email, href: `mailto:${email}` };
    }
  }
  const contact = result?.research?.contact ?? result?.research?.metadata?.contact ?? {};
  const researchEmail = validEmail(contact.primaryEmail) || validEmail(contact.emails?.[0]);
  if (researchEmail) return { label: researchEmail, href: `mailto:${researchEmail}` };
  const contactPage = cleanContact(contact.contactPage || contact.contactPages?.[0]);
  if (contactPage) return { label: contactPage, href: contactPage };
  return { label: "No email or contact page found", href: "" };
}

function renderSelectedContact(result) {
  const target = $("selectedContactValue");
  target.innerHTML = "";
  if (!result) {
    target.textContent = "No result selected";
    return;
  }
  const contact = contactForResult(result);
  if (!contact.href) {
    target.textContent = contact.label;
    return;
  }
  const link = document.createElement("a");
  link.href = contact.href;
  link.textContent = contact.label;
  link.rel = "noreferrer";
  target.append(link);
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

function renderProjects() {
  populateSelect(
    $("projectSelect"),
    state.projects,
    (project) => project.id,
    (project) => `${project.name} (${project.recordCount})`
  );
  if (state.activeProjectId) $("projectSelect").value = state.activeProjectId;
}

function legacyProjectFromCounts(recordCount = state.records.length) {
  return {
    id: "legacy_current",
    name: "Current Data",
    datasetName: "Current Data",
    promptName: $("templateSelect")?.value || "restaurant-ai-sms.txt",
    sourceName: "legacy API",
    recordCount,
    createdAt: "",
    updatedAt: ""
  };
}

async function loadProjects({ fallbackRecordCount } = {}) {
  try {
    const payload = await api("/api/projects");
    state.projectApiAvailable = true;
    return payload;
  } catch (error) {
    if (error.status !== 404 && error.code !== "ROUTE_NOT_FOUND") throw error;
    state.projectApiAvailable = false;
    const project = legacyProjectFromCounts(fallbackRecordCount);
    logClientWarning("Project API unavailable; using current-data fallback.", {
      status: error.status,
      code: error.code,
      requestId: error.requestId
    });
    return { projects: [project], activeProject: project, legacyMode: true };
  }
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
  const currentIds = new Set(state.results.map((result) => result.id));
  state.selectedResultIds = new Set([...state.selectedResultIds].filter((id) => currentIds.has(id)));
  if (!currentIds.has(state.activeResultId)) state.activeResultId = state.results[0]?.id || null;
  for (const result of state.results) {
    const record = state.records.find((item) => item.id === result.recordId);
    const tr = document.createElement("tr");
    if (result.id === state.activeResultId) tr.classList.add("is-active");
    if (state.selectedResultIds.has(result.id)) tr.classList.add("is-selected");
    tr.dataset.resultRowId = result.id;

    const selectCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "result-check";
    checkbox.value = result.id;
    checkbox.checked = state.selectedResultIds.has(result.id);
    checkbox.disabled = result.status !== "completed";
    checkbox.ariaLabel = `Select ${record?.displayName || result.recordId}`;
    selectCell.append(checkbox);
    tr.append(selectCell);
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
  syncResultSelectAll();
  rows.querySelectorAll("[data-result-row-id]").forEach((row) => {
    row.addEventListener("click", () => {
      activateResultRow(row.dataset.resultRowId);
    });
  });
  rows.querySelectorAll(".result-check").forEach((checkbox) => {
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleResultSelection(checkbox.value);
    });
  });
  rows.querySelectorAll("[data-result-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectResult(button.dataset.resultId);
    });
  });
  renderActiveResult();
}

function syncResultSelectAll() {
  const selectAll = $("selectAllResults");
  const completed = state.results.filter((result) => result.status === "completed");
  const selectedCompleted = completed.filter((result) => state.selectedResultIds.has(result.id));
  selectAll.checked = completed.length > 0 && selectedCompleted.length === completed.length;
  selectAll.indeterminate = selectedCompleted.length > 0 && selectedCompleted.length < completed.length;
}

function toggleResultSelection(resultId, force) {
  const result = state.results.find((item) => item.id === resultId);
  if (!result || result.status !== "completed") return;
  const shouldSelect = force ?? !state.selectedResultIds.has(resultId);
  if (shouldSelect) state.selectedResultIds.add(resultId);
  else state.selectedResultIds.delete(resultId);
  renderResults();
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
    renderSelectedContact(null);
    $("resultError").hidden = true;
    $("resultError").textContent = "";
    return;
  }
  const errorText = result.status === "failed" ? result.error?.message || "Processing failed." : "";
  $("resultError").hidden = !errorText;
  $("resultError").textContent = errorText;
  renderSelectedContact(result);
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

function activateResultRow(id) {
  if (state.unsaved && !confirm("Discard unsaved changes?")) return;
  state.activeResultId = id;
  const result = state.results.find((item) => item.id === id);
  if (result?.status === "completed") {
    if (state.selectedResultIds.has(id)) state.selectedResultIds.delete(id);
    else state.selectedResultIds.add(id);
  }
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
  const projects = await loadProjects();
  state.projects = projects.projects;
  state.activeProjectId =
    state.activeProjectId || projects.activeProject?.id || state.projects[0]?.id || null;
  const [config, records, templates, addenda, results, modelCatalog] = await Promise.all([
    api("/api/config"),
    api(withProject("/api/records")),
    api("/api/templates"),
    api("/api/addenda"),
    api(withProject("/api/results")),
    api("/api/models/catalog")
  ]);
  state.config = config;
  state.records = records.records;
  state.templates = templates.templates;
  state.addenda = addenda.addenda;
  state.results = results.results;
  state.modelCatalog = modelCatalog.models;
  state.modelSyncStatus = modelCatalog.status;
  if (state.projectApiAvailable && records.project?.id) state.activeProjectId = records.project.id;
  if (!state.activeRecordId && state.records[0]) state.activeRecordId = state.records[0].id;
  if (!state.results.some((result) => result.id === state.activeResultId)) {
    state.activeResultId = state.results[0]?.id || null;
  }
  renderProjects();
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
  const payload = await api("/api/records/load-sample", {
    method: "POST",
    body: JSON.stringify({ templateName: $("templateSelect").value || "restaurant-ai-sms.txt" })
  });
  await refreshProjects(payload.project?.id);
  state.records = payload.records;
  state.results = [];
  state.activeRecordId = state.records[0]?.id || null;
  state.activeResultId = null;
  state.selectedResultIds.clear();
  renderRecords();
  renderResults();
  setStatus(`Loaded ${payload.count} sample records`);
}

async function importFile(file) {
  const form = new FormData();
  form.append("file", file);
  form.append("templateName", $("templateSelect").value || "restaurant-ai-sms.txt");
  const payload = await api("/api/records/import", { method: "POST", body: form });
  await refreshProjects(payload.project?.id);
  state.records = payload.records;
  state.results = [];
  state.activeRecordId = state.records[0]?.id || null;
  state.activeResultId = null;
  state.selectedResultIds.clear();
  renderRecords();
  renderResults();
  setStatus(`Imported ${payload.count} records`);
}

async function refreshProjects(activeProjectId = state.activeProjectId) {
  const payload = await loadProjects({ fallbackRecordCount: state.records.length });
  state.projects = payload.projects;
  state.activeProjectId = activeProjectId || payload.activeProject?.id || state.projects[0]?.id || null;
  renderProjects();
}

async function previewPrompt() {
  const record = activeRecord();
  if (!record) throw new Error("Load records first.");
  const payload = await api("/api/templates/preview", {
    method: "POST",
    body: JSON.stringify({
      projectId: state.projectApiAvailable ? state.activeProjectId : undefined,
      templateName: $("templateSelect").value,
      recordId: record.id
    })
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
    projectId: state.projectApiAvailable ? state.activeProjectId : undefined,
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
    const [job, results] = await Promise.all([
      api(`/api/jobs/${state.activeJobId}`),
      api(withProject("/api/results"))
    ]);
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

function downloadExport(filename) {
  const link = document.createElement("a");
  link.href = `/api/results/export-file/${encodeURIComponent(filename)}`;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

async function exportDeliverySelected() {
  const ids = selectedResultIds();
  if (!ids.length) {
    setStatus("Select one or more completed results first.", true);
    return;
  }
  await exportDelivery(ids);
}

async function exportDelivery(resultIds = []) {
  const body = {
    profile: $("deliveryProfileSelect").value,
    projectId: state.projectApiAvailable ? state.activeProjectId : undefined,
    resultIds
  };
  const payload = await api("/api/results/delivery-export", {
    method: "POST",
    body: JSON.stringify(body)
  });
  setStatus(`Delivery kit exported: ${payload.export.filename}`);
  downloadExport(payload.export.filename);
}

function bind() {
  $("refreshButton").addEventListener("click", () =>
    refreshAll().catch((error) => setStatus(error.message, true))
  );
  $("projectSelect").addEventListener("change", () => {
    state.activeProjectId = $("projectSelect").value;
    state.activeRecordId = null;
    state.activeResultId = null;
    state.selectedResultIds.clear();
    refreshAll().catch((error) => setStatus(error.message, true));
  });
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
  $("selectAllResults").addEventListener("change", () => {
    const checked = $("selectAllResults").checked;
    state.results
      .filter((result) => result.status === "completed")
      .forEach((result) => {
        if (checked) state.selectedResultIds.add(result.id);
        else state.selectedResultIds.delete(result.id);
      });
    renderResults();
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
    api("/api/results/export", {
      method: "POST",
      body: JSON.stringify({ projectId: state.projectApiAvailable ? state.activeProjectId : undefined })
    })
      .then((payload) => setStatus(`Exported ${payload.export.filename}`))
      .catch((error) => setStatus(error.message, true))
  );
  $("exportDeliverySelectedButton").addEventListener("click", () =>
    exportDeliverySelected().catch((error) => setStatus(error.message, true))
  );
  $("exportDeliveryAllButton").addEventListener("click", () =>
    exportDelivery().catch((error) => setStatus(error.message, true))
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

window.addEventListener("error", (event) => {
  console.error("Unhandled browser error", event.error || event.message);
  setStatus("Unexpected browser error. Check the console and app log for details.", true);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled browser promise rejection", event.reason);
  setStatus("Unexpected browser error. Check the console and app log for details.", true);
});
