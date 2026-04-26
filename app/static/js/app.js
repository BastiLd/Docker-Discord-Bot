const initial = window.__INITIAL_STATE__ || {};
const page = document.body.dataset.page || initial.page || "dashboard";

const state = {
    page,
    locale: initial.locale || "en",
    translations: initial.translations || {},
    settings: initial.settings || {},
    panelMeta: initial.panelMeta || {},
    servers: initial.servers || [],
    activeServerId: initial.activeServerId || "default",
    envEntries: initial.envEntries || [],
    currentPath: "",
    entries: [],
    selected: new Set(),
    currentFile: null,
    originalContent: "",
    activeTaskId: null,
    tasks: [],
    logTab: "bot",
    logBuffers: { bot: [], system: [] },
    sockets: {},
    backups: [],
    schedules: [],
    metrics: {},
    status: null,
};

const els = {};
const dateTimeFormatter = new Intl.DateTimeFormat(state.locale === "de" ? "de-AT" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
});
const tourSteps = [
    "tour.step_dashboard",
    "tour.step_console",
    "tour.step_files",
    "tour.step_startup",
    "tour.step_activity",
];
const tourStorageKey = "katabot.panelTour.seen.v2";
let tourIndex = 0;

document.addEventListener("DOMContentLoaded", () => {
    collectBaseElements();
    localizeModalDefaults();
    bindModal();
    bindTour();
    bindGlobalBotControls();
    initializePage();
    bindQuickFocus();
    refreshStatus({ silent: true });
    refreshMetrics({ silent: true });
    window.setInterval(() => refreshStatus({ silent: true }), 5000);
    window.setInterval(() => refreshMetrics({ silent: true }), 10000);
});

function collectBaseElements() {
    Object.assign(els, {
        toastStack: byId("toastStack"),
        quickFocusBtn: byId("quickFocusBtn"),
        modalShell: byId("modalShell"),
        modalForm: byId("modalForm"),
        modalEyebrow: byId("modalEyebrow"),
        modalTitle: byId("modalTitle"),
        modalDescription: byId("modalDescription"),
        modalFieldOneWrap: byId("modalFieldOneWrap"),
        modalFieldOneLabel: byId("modalFieldOneLabel"),
        modalFieldOneInput: byId("modalFieldOneInput"),
        modalFieldTwoWrap: byId("modalFieldTwoWrap"),
        modalFieldTwoLabel: byId("modalFieldTwoLabel"),
        modalFieldTwoInput: byId("modalFieldTwoInput"),
        modalConfirmBtn: byId("modalConfirmBtn"),
        modalCancelBtn: byId("modalCancelBtn"),
        modalSecondaryBtn: byId("modalSecondaryBtn"),
        mascotHelpBtn: byId("mascotHelpBtn"),
        tourShell: byId("tourShell"),
        tourText: byId("tourText"),
        tourProgress: byId("tourProgress"),
        tourNextBtn: byId("tourNextBtn"),
        tourSkipBtn: byId("tourSkipBtn"),
        globalActionButtons: queryAll("[data-bot-action]"),
        serverNameLabels: queryAll(".server-name"),
        statusBadges: queryAll('[data-status-field="badge"]'),
        statusStateTexts: queryAll('[data-status-field="state_text"]'),
        statusPidTexts: queryAll('[data-status-field="pid"]'),
        statusUptimeTexts: queryAll('[data-status-field="uptime"]'),
        statusExitTexts: queryAll('[data-status-field="exit"]'),
        statusCommandTexts: queryAll('[data-status-field="command"]'),
        statusConsoleMessages: queryAll('[data-status-field="console_message"]'),
        statusErrorTexts: queryAll('[data-status-field="error"]'),
        metricCpuPrimary: queryAll('[data-metric-field="cpu-primary"]'),
        metricCpuSecondary: queryAll('[data-metric-field="cpu-secondary"]'),
        metricMemoryPrimary: queryAll('[data-metric-field="memory-primary"]'),
        metricMemorySecondary: queryAll('[data-metric-field="memory-secondary"]'),
        metricDiskPrimary: queryAll('[data-metric-field="disk-primary"]'),
        metricDiskSecondary: queryAll('[data-metric-field="disk-secondary"]'),
    });
}

function localizeModalDefaults() {
    if (els.modalSecondaryBtn) els.modalSecondaryBtn.textContent = tr("schedules.cancel");
    if (els.modalConfirmBtn) els.modalConfirmBtn.textContent = tr("common.save");
}

function initializePage() {
    if (page === "dashboard" || page === "activity") {
        bindHistoryAndLogs();
        refreshHistory({ silent: true });
        window.setInterval(() => refreshHistory({ silent: true }), 7000);
    }

    if (page === "files") bindFilesPage();
    if (page === "home") bindHomePage();
    if (page === "console") bindConsolePage();
    if (page === "startup") bindStartupPage();
    if (page === "settings") bindSettingsPage();
    if (page === "backups") bindBackupsPage();
    if (page === "network") bindNetworkPage();
    if (page === "schedules") bindSchedulesPage();
}

function bindQuickFocus() {
    els.quickFocusBtn?.addEventListener("click", () => {
        getQuickFocusTarget()?.focus();
    });
}

function getQuickFocusTarget() {
    if (page === "home") return byId("serverNameInput");
    if (page === "files") return state.currentFile ? byId("editorTextarea") : byId("fileSearchInput");
    if (page === "console") return byId("consoleInput");
    if (page === "startup") return byId("startCommandInput") || byId("packageInput");
    if (page === "settings") return byId("panelNameInput");
    if (page === "network") return byId("networkNoteInput");
    if (page === "backups") return byId("createBackupBtn");
    if (page === "schedules") return byId("scheduleNameInput") || byId("newScheduleBtn");
    return null;
}

function bindHomePage() {
    Object.assign(els, {
        createServerForm: byId("createServerForm"),
        serverNameInput: byId("serverNameInput"),
        serverDescriptionInput: byId("serverDescriptionInput"),
    });

    els.createServerForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const displayName = (els.serverNameInput?.value || "").trim();
        if (!displayName) {
            showToastKey("home.name_required", {}, "error");
            els.serverNameInput?.focus();
            return;
        }

        try {
            await api("/api/servers", {
                method: "POST",
                body: JSON.stringify({
                    display_name: displayName,
                    description: (els.serverDescriptionInput?.value || "").trim(),
                }),
            });
            showToastKey("toast.server_created");
            window.location.href = "/dashboard";
        } catch (error) {
            showToast(error.message, "error");
        }
    });
}

function byId(id) {
    return document.getElementById(id);
}

function queryAll(selector) {
    return [...document.querySelectorAll(selector)];
}

function tr(key, vars = {}) {
    const template = state.translations[key] || key;
    return template.replace(/\{(\w+)\}/g, (_, token) => String(vars[token] ?? ""));
}

async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const isFormData = options.body instanceof FormData;
    if (options.body && !isFormData && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }

    const response = await fetch(path, { ...options, headers });
    if (!response.ok) {
        throw new Error(await extractError(response));
    }
    if (response.status === 204) return null;
    const contentType = response.headers.get("content-type") || "";
    return contentType.includes("application/json") ? response.json() : response.text();
}

async function extractError(response) {
    try {
        const payload = await response.json();
        return payload.detail || payload.message || JSON.stringify(payload);
    } catch {
        const text = await response.text();
        return text || "Unknown error";
    }
}

function showToast(message, type = "info") {
    if (!els.toastStack) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type === "error" ? "is-error" : ""}`.trim();
    toast.textContent = message;
    els.toastStack.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4000);
}

function showToastKey(key, vars = {}, type = "info") {
    showToast(tr(key, vars), type);
}

function setText(nodes, value) {
    nodes.forEach((node) => {
        node.textContent = value;
    });
}

function bindGlobalBotControls() {
    els.globalActionButtons.forEach((button) => {
        button.addEventListener("click", async () => {
            await controlBot(button.dataset.botAction);
        });
    });
}

async function controlBot(action) {
    const messageKey = {
        start: "toast.bot_started",
        stop: "toast.bot_stopped",
        restart: "toast.bot_restarted",
    }[action];

    try {
        await api(`/api/bot/${action}`, { method: "POST" });
        await refreshStatus({ silent: true });
        if (page === "dashboard" || page === "activity") {
            await refreshHistory({ silent: true });
        }
        showToastKey(messageKey || "toast.bot_started");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function refreshStatus({ silent = false } = {}) {
    try {
        const payload = await api("/api/status");
        state.status = payload;
        renderStatus(payload);
        renderMetrics(state.metrics);
    } catch (error) {
        if (!silent) showToast(error.message, "error");
    }
}

function renderStatus(payload) {
    const mapping = {
        running: { text: tr("status.running"), className: "is-running", consoleKey: "console.status_running" },
        stopped: { text: tr("status.stopped"), className: "is-stopped", consoleKey: "console.status_stopped" },
        crashed: { text: tr("status.crashed"), className: "is-crashed", consoleKey: "console.status_crashed" },
        unknown: { text: tr("status.unknown"), className: "is-unknown", consoleKey: "console.status_unknown" },
    };
    const current = mapping[payload.state] || mapping.unknown;

    setText(els.statusStateTexts, current.text);
    setText(els.statusConsoleMessages, tr(current.consoleKey));
    setText(els.statusPidTexts, payload.pid ?? "-");
    setText(els.statusUptimeTexts, payload.uptime_human || tr("common.none"));
    setText(els.statusExitTexts, payload.last_exit_code ?? "-");
    setText(els.statusCommandTexts, payload.last_command || state.settings.start_command || "python bot.py");
    setText(els.statusErrorTexts, payload.last_error || "");
    els.statusBadges.forEach((badge) => {
        badge.textContent = current.text;
        badge.className = `status-pill ${current.className}`;
    });
    if (payload.last_command) state.settings.start_command = payload.last_command;
}

async function refreshMetrics({ silent = false } = {}) {
    try {
        state.metrics = await api("/api/metrics");
        renderMetrics(state.metrics);
    } catch (error) {
        if (!silent) showToast(error.message, "error");
    }
}

function renderMetrics(payload = {}) {
    const currentState = state.status?.state || "unknown";
    setText(els.metricCpuPrimary, `${payload.cpu_percent ?? 0}%`);
    setText(els.metricCpuSecondary, tr(`status.${currentState}`));
    setText(els.metricMemoryPrimary, formatUsage(payload.memory_used_human, payload.memory_total_human));
    setText(els.metricMemorySecondary, payload.memory_total_bytes ? tr("dashboard.memory") : tr("common.none"));
    setText(els.metricDiskPrimary, formatUsage(payload.disk_used_human, payload.disk_total_human));
    setText(els.metricDiskSecondary, tr("dashboard.disk"));
}

function formatUsage(used, total) {
    if (!used || !total || used === "--" || total === "--") return tr("common.none");
    return `${used} / ${total}`;
}

function bindSettingsPage() {
    Object.assign(els, {
        panelNameInput: byId("panelNameInput"),
        panelDescriptionInput: byId("panelDescriptionInput"),
        localeSelect: byId("localeSelect"),
        savePanelBtn: byId("savePanelBtn"),
    });

    els.savePanelBtn?.addEventListener("click", savePanelMeta);
}

async function savePanelMeta() {
    const nextLocale = els.localeSelect?.value || state.locale;
    try {
        const payload = await api("/api/panel-meta", {
            method: "PUT",
            body: JSON.stringify({
                display_name: (els.panelNameInput?.value || state.panelMeta.display_name || "Discord-Bot").trim(),
                description: (els.panelDescriptionInput?.value || "").trim(),
                network_note: state.panelMeta.network_note || "",
            }),
        });
        state.panelMeta = payload;
        setText(els.serverNameLabels, payload.display_name);
        setLocaleCookie(nextLocale);
        if (nextLocale !== state.locale) {
            window.location.reload();
            return;
        }
        showToastKey("toast.panel_saved");
    } catch (error) {
        showToast(error.message, "error");
    }
}

function setLocaleCookie(locale) {
    document.cookie = `locale=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

function bindNetworkPage() {
    Object.assign(els, {
        networkHostCell: byId("networkHostCell"),
        networkPortCell: byId("networkPortCell"),
        networkNoteInput: byId("networkNoteInput"),
        saveNetworkBtn: byId("saveNetworkBtn"),
    });

    const parts = splitServerAddress(initial.serverAddress || "");
    if (els.networkHostCell) els.networkHostCell.textContent = parts.host;
    if (els.networkPortCell) els.networkPortCell.textContent = parts.port;
    if (els.networkNoteInput) els.networkNoteInput.value = state.panelMeta.network_note || "";

    els.saveNetworkBtn?.addEventListener("click", async () => {
        try {
            const payload = await api("/api/panel-meta", {
                method: "PUT",
                body: JSON.stringify({
                    display_name: state.panelMeta.display_name || "Discord-Bot",
                    description: state.panelMeta.description || "",
                    network_note: els.networkNoteInput?.value || "",
                }),
            });
            state.panelMeta = payload;
            showToastKey("toast.network_saved");
        } catch (error) {
            showToast(error.message, "error");
        }
    });
}

function splitServerAddress(address) {
    const index = address.lastIndexOf(":");
    if (index > 0) {
        return { host: address.slice(0, index), port: address.slice(index + 1) };
    }
    return { host: address || "-", port: "-" };
}

function bindBackupsPage() {
    Object.assign(els, {
        createBackupBtn: byId("createBackupBtn"),
        backupTableBody: byId("backupTableBody"),
    });

    els.createBackupBtn?.addEventListener("click", async () => {
        try {
            await api("/api/backups", { method: "POST" });
            await refreshBackups();
            showToastKey("toast.backup_created");
        } catch (error) {
            showToast(error.message, "error");
        }
    });

    els.backupTableBody?.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-action]");
        if (!button) return;
        const name = button.dataset.name || "";
        if (button.dataset.action === "download") {
            window.open(`/api/backups/${encodeURIComponent(name)}/download`, "_blank", "noopener");
            return;
        }
        if (button.dataset.action === "delete") {
            try {
                await api(`/api/backups/${encodeURIComponent(name)}`, { method: "DELETE" });
                await refreshBackups();
                showToastKey("toast.backup_deleted");
            } catch (error) {
                showToast(error.message, "error");
            }
        }
    });

    refreshBackups();
}

async function refreshBackups() {
    try {
        const payload = await api("/api/backups");
        state.backups = payload.items || [];
        renderBackups();
    } catch (error) {
        showToast(error.message, "error");
    }
}

function renderBackups() {
    if (!els.backupTableBody) return;
    if (!state.backups.length) {
        els.backupTableBody.innerHTML = `<tr><td colspan="5"><div class="empty-state">${escapeHtml(tr("backups.empty"))}</div></td></tr>`;
        return;
    }
    els.backupTableBody.innerHTML = state.backups
        .map((item) => `
            <tr>
                <td>${escapeHtml(item.name)}</td>
                <td>${escapeHtml(item.size_human || "-")}</td>
                <td>${escapeHtml(formatUnixDate(item.created_at))}</td>
                <td>${escapeHtml(item.checksum || "-")}</td>
                <td>
                    <div class="file-actions">
                        <button class="file-action-link" type="button" data-action="download" data-name="${escapeHtml(item.name)}">${escapeHtml(tr("common.download"))}</button>
                        <button class="file-action-link" type="button" data-action="delete" data-name="${escapeHtml(item.name)}">${escapeHtml(tr("common.delete"))}</button>
                    </div>
                </td>
            </tr>
        `)
        .join("");
}

function bindConsolePage() {
    bindTaskPage({ withConsoleForm: true });
}

function bindStartupPage() {
    Object.assign(els, {
        startCommandInput: byId("startCommandInput"),
        autoRestartInput: byId("autoRestartInput"),
        useVenvInput: byId("useVenvInput"),
        restartDelayInput: byId("restartDelayInput"),
        pythonRuntimeInput: byId("pythonRuntimeInput"),
        refreshStartupBtn: byId("refreshStartupBtn"),
        saveSettingsBtn: byId("saveSettingsBtn"),
        installDepsBtn: byId("installDepsBtn"),
        packageInput: byId("packageInput"),
        installPackageBtn: byId("installPackageBtn"),
    });

    applySettingsToForm();
    bindEnvironmentPage();
    bindTaskPage({ withConsoleForm: false });

    els.saveSettingsBtn?.addEventListener("click", saveSettings);
    els.refreshStartupBtn?.addEventListener("click", refreshStartupPage);
    els.installDepsBtn?.addEventListener("click", () => startTask("/api/tasks/install-deps", {}));
    els.installPackageBtn?.addEventListener("click", () => {
        const packageName = els.packageInput?.value.trim() || "";
        if (!packageName) {
            showToastKey("error.package_required", {}, "error");
            return;
        }
        startTask("/api/tasks/install-package", { package: packageName });
        els.packageInput.value = "";
    });
}

function applySettingsToForm() {
    if (!els.startCommandInput) return;
    els.startCommandInput.value = state.settings.start_command || "python bot.py";
    if (els.autoRestartInput) els.autoRestartInput.checked = Boolean(state.settings.auto_restart);
    if (els.useVenvInput) els.useVenvInput.checked = state.settings.use_virtualenv !== false;
    if (els.restartDelayInput) els.restartDelayInput.value = String(state.settings.restart_delay_seconds || 5);
    if (els.pythonRuntimeInput) els.pythonRuntimeInput.value = state.settings.python_runtime || "3.14";
}

async function saveSettings() {
    try {
        const payload = {
            start_command: els.startCommandInput?.value.trim() || "python bot.py",
            auto_restart: Boolean(els.autoRestartInput?.checked),
            use_virtualenv: Boolean(els.useVenvInput?.checked),
            restart_delay_seconds: Number(els.restartDelayInput?.value || 5),
            python_runtime: els.pythonRuntimeInput?.value || state.settings.python_runtime || "3.14",
        };
        state.settings = await api("/api/settings", {
            method: "PUT",
            body: JSON.stringify(payload),
        });
        applySettingsToForm();
        await refreshStatus({ silent: true });
        showToastKey("toast.settings_saved");
    } catch (error) {
        showToast(error.message, "error");
    }
}
function bindEnvironmentPage() {
    Object.assign(els, {
        envList: byId("envList"),
        addEnvBtn: byId("addEnvBtn"),
        saveEnvBtn: byId("saveEnvBtn"),
    });

    renderEnvList();

    els.addEnvBtn?.addEventListener("click", () => {
        state.envEntries.push({ key: "", value: "", masked: false });
        renderEnvList();
    });

    els.saveEnvBtn?.addEventListener("click", saveEnvEntries);

    els.envList?.addEventListener("input", (event) => {
        const row = event.target.closest(".env-item");
        if (!row) return;
        const index = Number(row.dataset.index);
        const field = event.target.dataset.field;
        state.envEntries[index][field] = event.target.value;
    });

    els.envList?.addEventListener("click", (event) => {
        const row = event.target.closest(".env-item");
        if (!row) return;
        const index = Number(row.dataset.index);
        const action = event.target.dataset.action;
        if (action === "toggle-mask") {
            state.envEntries[index].masked = !state.envEntries[index].masked;
            renderEnvList();
        }
        if (action === "remove") {
            state.envEntries.splice(index, 1);
            renderEnvList();
        }
    });
}

function renderEnvList() {
    if (!els.envList) return;
    if (!state.envEntries.length) {
        els.envList.innerHTML = `<div class="empty-state">${escapeHtml(tr("error.no_env_entries"))}</div>`;
        return;
    }

    els.envList.innerHTML = state.envEntries
        .map((entry, index) => `
            <div class="env-item" data-index="${index}">
                <div class="env-row">
                    <label class="field">
                        <span>Key</span>
                        <input class="env-key-input" data-field="key" type="text" value="${escapeHtml(entry.key || "")}">
                    </label>
                    <label class="field">
                        <span>Value</span>
                        <input data-field="value" type="${entry.masked ? "password" : "text"}" value="${escapeHtml(entry.value || "")}">
                    </label>
                    <button class="btn btn-secondary" type="button" data-action="toggle-mask">${escapeHtml(entry.masked ? tr("common.show") : tr("common.mask"))}</button>
                    <button class="btn btn-danger" type="button" data-action="remove">${escapeHtml(tr("common.delete"))}</button>
                </div>
            </div>
        `)
        .join("");
}

async function saveEnvEntries() {
    try {
        const entries = state.envEntries
            .filter((entry) => (entry.key || "").trim())
            .map((entry) => ({
                key: entry.key.trim(),
                value: entry.value ?? "",
                masked: Boolean(entry.masked),
            }));
        const payload = await api("/api/env", {
            method: "PUT",
            body: JSON.stringify({ entries }),
        });
        state.envEntries = payload.entries || [];
        renderEnvList();
        showToastKey("toast.env_saved");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function refreshStartupPage() {
    try {
        const [settings, envPayload, taskPayload] = await Promise.all([
            api("/api/settings"),
            api("/api/env"),
            api("/api/tasks"),
        ]);
        state.settings = settings;
        state.envEntries = envPayload.entries || [];
        state.tasks = taskPayload.items || [];
        applySettingsToForm();
        renderEnvList();
        renderTasks();
        await Promise.all([refreshStatus({ silent: true }), refreshMetrics({ silent: true })]);
        showToastKey("toast.startup_refreshed");
    } catch (error) {
        showToast(error.message, "error");
    }
}

function bindTaskPage({ withConsoleForm }) {
    Object.assign(els, {
        consoleForm: byId("consoleForm"),
        consoleInput: byId("consoleInput"),
        taskList: byId("taskList"),
        taskOutput: byId("taskOutput"),
    });

    if (withConsoleForm && els.consoleForm) {
        els.consoleForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const command = els.consoleInput?.value.trim() || "";
            if (!command) {
                showToastKey("error.command_required", {}, "error");
                return;
            }
            await startTask("/api/tasks/console", { command });
            els.consoleInput.value = "";
        });
    }

    els.taskList?.addEventListener("click", (event) => {
        const item = event.target.closest("[data-task-id]");
        if (!item) return;
        state.activeTaskId = item.dataset.taskId;
        renderTasks();
        refreshActiveTask({ silent: true });
    });

    refreshTasks({ silent: true });
    window.setInterval(() => refreshTasks({ silent: true }), 4000);
}

async function startTask(endpoint, payload) {
    try {
        const task = await api(endpoint, {
            method: "POST",
            body: JSON.stringify(payload),
        });
        state.activeTaskId = task.task_id;
        await refreshTasks({ silent: true });
        showToastKey("toast.task_started", { title: task.title });
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function refreshTasks({ silent = false } = {}) {
    if (!els.taskList || !els.taskOutput) return;
    try {
        const payload = await api("/api/tasks");
        state.tasks = payload.items || [];
        if (!state.activeTaskId && state.tasks[0]) state.activeTaskId = state.tasks[0].task_id;
        renderTasks();
        await refreshActiveTask({ silent: true });
    } catch (error) {
        if (!silent) showToast(error.message, "error");
    }
}

function renderTasks() {
    if (!els.taskList) return;
    if (!state.tasks.length) {
        els.taskList.innerHTML = `<div class="empty-state">${escapeHtml(tr("error.task_empty"))}</div>`;
        return;
    }
    els.taskList.innerHTML = state.tasks
        .map((task) => `
            <button class="task-item ${state.activeTaskId === task.task_id ? "is-active" : ""}" type="button" data-task-id="${task.task_id}">
                <div class="task-title">${escapeHtml(task.title)}</div>
                <div class="task-meta">${escapeHtml(renderTaskStatus(task.status))} - ${escapeHtml(task.duration || tr("common.none"))}</div>
            </button>
        `)
        .join("");
}

async function refreshActiveTask({ silent = false } = {}) {
    if (!els.taskOutput) return;
    if (!state.activeTaskId) {
        els.taskOutput.textContent = tr("error.task_empty");
        return;
    }
    try {
        const payload = await api(`/api/tasks/${state.activeTaskId}`);
        els.taskOutput.textContent = payload.output || tr("error.task_empty");
        const index = state.tasks.findIndex((task) => task.task_id === payload.task_id);
        if (index >= 0) {
            state.tasks[index] = { ...state.tasks[index], ...payload };
            renderTasks();
        }
    } catch (error) {
        if (!silent) showToast(error.message, "error");
    }
}

function bindFilesPage() {
    Object.assign(els, {
        fileBrowserView: byId("fileBrowserView"),
        fileEditorView: byId("fileEditorView"),
        fileEditorBackBtn: byId("fileEditorBackBtn"),
        breadcrumbs: byId("breadcrumbs"),
        navigateUpBtn: byId("navigateUpBtn"),
        refreshFilesBtn: byId("refreshFilesBtn"),
        newFileBtn: byId("newFileBtn"),
        newFolderBtn: byId("newFolderBtn"),
        uploadFilesBtn: byId("uploadFilesBtn"),
        uploadArchiveBtn: byId("uploadArchiveBtn"),
        uploadFilesInput: byId("uploadFilesInput"),
        uploadArchiveInput: byId("uploadArchiveInput"),
        fileSearchInput: byId("fileSearchInput"),
        bulkDeleteBtn: byId("bulkDeleteBtn"),
        bulkDownloadBtn: byId("bulkDownloadBtn"),
        bulkMoveBtn: byId("bulkMoveBtn"),
        bulkCopyBtn: byId("bulkCopyBtn"),
        fileTableBody: byId("fileTableBody"),
        selectAllCheckbox: byId("selectAllCheckbox"),
        dropzone: byId("dropzone"),
        editorTitle: byId("editorTitle"),
        editorPath: byId("editorPath"),
        editorLanguage: byId("editorLanguage"),
        editorDirtyBadge: byId("editorDirtyBadge"),
        editorTextarea: byId("editorTextarea"),
        editorMeta: byId("editorMeta"),
        reloadFileBtn: byId("reloadFileBtn"),
        saveFileBtn: byId("saveFileBtn"),
    });

    clearEditor();
    refreshFiles("").then(() => syncFileModeFromUrl({ replaceHistory: true }));

    els.refreshFilesBtn?.addEventListener("click", () => refreshFiles(state.currentPath));
    els.navigateUpBtn?.addEventListener("click", navigateUp);
    els.newFileBtn?.addEventListener("click", () => createEntry("file"));
    els.newFolderBtn?.addEventListener("click", () => createEntry("folder"));
    els.uploadFilesBtn?.addEventListener("click", () => els.uploadFilesInput?.click());
    els.uploadArchiveBtn?.addEventListener("click", () => els.uploadArchiveInput?.click());
    els.uploadFilesInput?.addEventListener("change", () => handleUpload(els.uploadFilesInput.files, false));
    els.uploadArchiveInput?.addEventListener("change", () => handleUpload(els.uploadArchiveInput.files, true));
    els.fileSearchInput?.addEventListener("input", renderFileTable);
    els.fileTableBody?.addEventListener("click", handleFileTableClick);
    els.fileTableBody?.addEventListener("change", handleFileSelectionChange);
    els.selectAllCheckbox?.addEventListener("change", toggleSelectAll);
    els.bulkDeleteBtn?.addEventListener("click", () => deleteEntries([...state.selected]));
    els.bulkDownloadBtn?.addEventListener("click", () => downloadSelection([...state.selected]));
    els.bulkMoveBtn?.addEventListener("click", () => transferSelection("move"));
    els.bulkCopyBtn?.addEventListener("click", () => transferSelection("copy"));
    els.reloadFileBtn?.addEventListener("click", () => state.currentFile && openFile(state.currentFile, { pushHistory: false }));
    els.saveFileBtn?.addEventListener("click", saveCurrentFile);
    els.editorTextarea?.addEventListener("input", renderEditorDirtyState);
    els.editorTextarea?.addEventListener("keydown", handleEditorTabKey);
    els.fileEditorBackBtn?.addEventListener("click", () => closeFileEditor({ updateHistory: true }));
    window.addEventListener("popstate", () => syncFileModeFromUrl({ replaceHistory: true }));

    bindDropzone();
}

async function refreshFiles(path) {
    try {
        const payload = await api(`/api/files?path=${encodeURIComponent(path || "")}`);
        state.currentPath = payload.current_path || "";
        state.entries = payload.entries || [];
        state.selected.clear();
        renderBreadcrumbs(payload.breadcrumbs || []);
        renderFileTable();
        updateSelectionActions();
    } catch (error) {
        showToast(error.message, "error");
    }
}

function renderBreadcrumbs(items) {
    if (!els.breadcrumbs) return;
    els.breadcrumbs.innerHTML = items
        .map((item) => `<button class="crumb-button" type="button" data-path="${escapeHtml(item.path)}">${escapeHtml(item.name)}</button>`)
        .join("");

    queryAll(".crumb-button").forEach((button) => {
        button.addEventListener("click", () => refreshFiles(button.dataset.path || ""));
    });
}

function filteredEntries() {
    const query = (els.fileSearchInput?.value || "").trim().toLowerCase();
    if (!query) return state.entries;
    return state.entries.filter((entry) => entry.name.toLowerCase().includes(query));
}

function renderFileTable() {
    if (!els.fileTableBody) return;
    const entries = filteredEntries();
    els.fileTableBody.innerHTML = entries.length
        ? entries.map(renderFileRow).join("")
        : `<tr><td colspan="6"><div class="empty-state">${escapeHtml(tr("files.empty"))}</div></td></tr>`;

    if (els.selectAllCheckbox) {
        els.selectAllCheckbox.checked = entries.length > 0 && entries.every((entry) => state.selected.has(entry.path));
    }
}

function renderFileRow(entry) {
    const checked = state.selected.has(entry.path) ? "checked" : "";
    const kindLabel = fileTypeLabel(entry);
    const primaryAction = entry.kind === "directory" ? "open" : entry.editable ? "edit" : "download";
    const primaryLabel = entry.kind === "directory" ? tr("files.open") : entry.editable ? tr("files.edit") : tr("files.download");
    const fileIcon = iconForEntry(entry);

    const actionButtons = [
        `<button class="file-action-link" type="button" data-action="${primaryAction}" data-path="${escapeHtml(entry.path)}">${escapeHtml(primaryLabel)}</button>`,
        `<button class="file-action-link" type="button" data-action="rename" data-path="${escapeHtml(entry.path)}">${escapeHtml(tr("files.rename"))}</button>`,
        `<button class="file-action-link" type="button" data-action="download" data-path="${escapeHtml(entry.path)}">${escapeHtml(tr("files.download"))}</button>`,
        entry.extractable ? `<button class="file-action-link" type="button" data-action="extract" data-path="${escapeHtml(entry.path)}">${escapeHtml(tr("files.extract"))}</button>` : "",
        `<button class="file-action-link" type="button" data-action="delete" data-path="${escapeHtml(entry.path)}">${escapeHtml(tr("common.delete"))}</button>`,
    ].join("");

    return `
        <tr>
            <td><input type="checkbox" data-path="${escapeHtml(entry.path)}" ${checked}></td>
            <td>
                <div class="file-name-cell">
                    <span class="file-icon file-icon-emoji" title="${escapeHtml(fileIcon.label)}" aria-hidden="true">${fileIcon.symbol}</span>
                    <button class="file-link" type="button" data-action="${primaryAction}" data-path="${escapeHtml(entry.path)}">${escapeHtml(entry.name)}</button>
                </div>
            </td>
            <td>${escapeHtml(kindLabel)}</td>
            <td>${escapeHtml(entry.size_human || "-")}</td>
            <td>${escapeHtml(formatUnixDate(entry.modified_at))}</td>
            <td><div class="file-actions">${actionButtons}</div></td>
        </tr>
    `;
}

function fileTypeLabel(entry) {
    if (entry.kind === "directory") return tr("files.new_folder");
    const name = (entry.name || "").toLowerCase();
    if (name === ".env") return ".env";
    if (name === "dockerfile") return "Dockerfile";
    if (name.endsWith(".tar.gz")) return ".tar.gz";
    if (name.endsWith(".tar.bz2")) return ".tar.bz2";
    return entry.extension || tr("files.type");
}

function iconForEntry(entry) {
    if (entry.kind === "directory") return { symbol: "📁", label: tr("files.new_folder") };

    const name = (entry.name || "").toLowerCase();
    const extension = (entry.extension || "").toLowerCase().replace(/^\./, "");
    const fullExtension = name.endsWith(".tar.gz") ? "tar.gz" : name.endsWith(".tar.bz2") ? "tar.bz2" : extension;

    if (name === ".env" || name.endsWith(".env") || name.includes(".env.")) return { symbol: "🔐", label: "Environment" };
    if (name === "dockerfile" || name.startsWith("dockerfile.")) return { symbol: "🐳", label: "Dockerfile" };
    if (name === "docker-compose.yml" || name === "docker-compose.yaml" || name === "compose.yml" || name === "compose.yaml") {
        return { symbol: "🐳", label: "Docker Compose" };
    }
    if (name === "requirements.txt" || name === "pyproject.toml" || name === "package.json") return { symbol: "📦", label: "Dependencies" };
    if (name.startsWith("readme") || name === "license" || name === "changelog") return { symbol: "📘", label: "Documentation" };

    const iconMap = {
        py: ["🐍", "Python"],
        pyw: ["🐍", "Python"],
        js: ["🟨", "JavaScript"],
        mjs: ["🟨", "JavaScript"],
        cjs: ["🟨", "JavaScript"],
        ts: ["🔷", "TypeScript"],
        tsx: ["🔷", "TypeScript React"],
        jsx: ["⚛️", "React"],
        html: ["🌐", "HTML"],
        htm: ["🌐", "HTML"],
        css: ["🎨", "CSS"],
        scss: ["🎨", "SCSS"],
        sass: ["🎨", "Sass"],
        json: ["🔧", "JSON"],
        yml: ["⚙️", "YAML"],
        yaml: ["⚙️", "YAML"],
        toml: ["⚙️", "TOML"],
        ini: ["⚙️", "INI"],
        cfg: ["⚙️", "Config"],
        conf: ["⚙️", "Config"],
        md: ["📘", "Markdown"],
        markdown: ["📘", "Markdown"],
        txt: ["📄", "Text"],
        log: ["📜", "Log"],
        csv: ["📊", "CSV"],
        xls: ["📊", "Spreadsheet"],
        xlsx: ["📊", "Spreadsheet"],
        db: ["🗄️", "Database"],
        sqlite: ["🗄️", "SQLite"],
        sqlite3: ["🗄️", "SQLite"],
        sql: ["🗄️", "SQL"],
        zip: ["🗜️", "Archive"],
        tar: ["🗜️", "Archive"],
        gz: ["🗜️", "Archive"],
        "tar.gz": ["🗜️", "Archive"],
        "tar.bz2": ["🗜️", "Archive"],
        rar: ["🗜️", "Archive"],
        "7z": ["🗜️", "Archive"],
        png: ["🖼️", "Image"],
        jpg: ["🖼️", "Image"],
        jpeg: ["🖼️", "Image"],
        gif: ["🖼️", "Image"],
        webp: ["🖼️", "Image"],
        svg: ["🖼️", "SVG"],
        pdf: ["📕", "PDF"],
        mp3: ["🎵", "Audio"],
        wav: ["🎵", "Audio"],
        ogg: ["🎵", "Audio"],
        mp4: ["🎬", "Video"],
        mov: ["🎬", "Video"],
        webm: ["🎬", "Video"],
    };

    const [symbol, label] = iconMap[fullExtension] || ["📄", extension ? extension.toUpperCase() : "File"];
    return { symbol, label };
}

function handleFileTableClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const { action, path } = button.dataset;
    if (action === "open") refreshFiles(path);
    if (action === "edit") openFile(path);
    if (action === "rename") renameEntry(path);
    if (action === "delete") deleteEntries([path]);
    if (action === "download") downloadEntry(path);
    if (action === "extract") extractArchive(path);
}

function handleFileSelectionChange(event) {
    const input = event.target.closest("input[type='checkbox'][data-path]");
    if (!input) return;
    if (input.checked) state.selected.add(input.dataset.path);
    else state.selected.delete(input.dataset.path);
    updateSelectionActions();
}

function toggleSelectAll() {
    filteredEntries().forEach((entry) => {
        if (els.selectAllCheckbox?.checked) state.selected.add(entry.path);
        else state.selected.delete(entry.path);
    });
    renderFileTable();
    updateSelectionActions();
}

function updateSelectionActions() {
    const disabled = state.selected.size === 0;
    [els.bulkDeleteBtn, els.bulkDownloadBtn, els.bulkMoveBtn, els.bulkCopyBtn].forEach((button) => {
        if (button) button.disabled = disabled;
    });
}

function navigateUp() {
    if (!state.currentPath) return;
    const parts = state.currentPath.split("/").filter(Boolean);
    parts.pop();
    refreshFiles(parts.join("/"));
}

let activeModal = null;

function createEntry(kind) {
    openModal({
        eyebrow: tr("nav.files"),
        title: tr(kind === "file" ? "modal.new_file_title" : "modal.new_folder_title"),
        description: tr(kind === "file" ? "modal.new_file_description" : "modal.new_folder_description"),
        fieldOneLabel: tr("modal.name"),
        fieldOneValue: "",
        async onConfirm({ fieldOne }) {
            const name = fieldOne.trim();
            if (!name) return;
            try {
                await api(kind === "file" ? "/api/files/new-file" : "/api/files/new-folder", {
                    method: "POST",
                    body: JSON.stringify({
                        parent_path: state.currentPath,
                        name,
                    }),
                });
                await refreshFiles(state.currentPath);
                showToastKey(kind === "file" ? "toast.file_created" : "toast.folder_created");
            } catch (error) {
                showToast(error.message, "error");
                return false;
            }
        },
    });
}

function renameEntry(path) {
    const currentName = path.split("/").filter(Boolean).pop() || path;
    openModal({
        eyebrow: tr("nav.files"),
        title: tr("modal.rename_title"),
        description: tr("modal.rename_description"),
        fieldOneLabel: tr("modal.new_name"),
        fieldOneValue: currentName,
        async onConfirm({ fieldOne }) {
            const newName = fieldOne.trim();
            if (!newName || newName === currentName) return;
            try {
                const payload = await api("/api/files/rename", {
                    method: "POST",
                    body: JSON.stringify({
                        path,
                        new_name: newName,
                    }),
                });
                if (state.currentFile === path) {
                    state.currentFile = payload.path;
                }
                await refreshFiles(state.currentPath);
                if (state.currentFile === payload.path) {
                    await openFile(payload.path, { pushHistory: false, force: true });
                }
                showToastKey("toast.entry_renamed");
            } catch (error) {
                showToast(error.message, "error");
                return false;
            }
        },
    });
}

async function deleteEntries(paths) {
    const uniquePaths = [...new Set(paths.filter(Boolean))];
    if (!uniquePaths.length) return;
    if (!window.confirm(tr("error.delete_confirm", { count: uniquePaths.length }))) return;

    try {
        await api("/api/files", {
            method: "DELETE",
            body: JSON.stringify({ paths: uniquePaths }),
        });
        if (state.currentFile && uniquePaths.some((item) => state.currentFile === item || state.currentFile.startsWith(`${item}/`))) {
            closeFileEditor({ updateHistory: false, force: true });
        }
        await refreshFiles(state.currentPath);
        showToastKey("toast.selection_deleted");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function transferSelection(mode) {
    const paths = [...state.selected].filter(Boolean);
    if (!paths.length) return;
    const label = mode === "move" ? tr("files.move") : tr("files.copy");
    const destination = window.prompt(`${label} path`, state.currentPath || "");
    if (destination === null) return;

    try {
        await api(`/api/files/${mode}`, {
            method: "POST",
            body: JSON.stringify({
                sources: paths,
                destination: destination.trim(),
            }),
        });
        await refreshFiles(state.currentPath);
        showToastKey(mode === "move" ? "toast.selection_moved" : "toast.selection_copied");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function handleUpload(fileList, isArchiveUpload) {
    const files = [...(fileList || [])];
    if (!files.length) return;

    let extractArchives = false;
    if (isArchiveUpload || files.every((file) => file.name.toLowerCase().endsWith(".zip"))) {
        extractArchives = window.confirm(tr("error.zip_extract_confirm"));
    }

    const formData = new FormData();
    formData.append("path", state.currentPath);
    formData.append("extract_archives", String(extractArchives));
    files.forEach((file) => formData.append("files", file));

    try {
        await api("/api/files/upload", {
            method: "POST",
            body: formData,
        });
        await refreshFiles(state.currentPath);
        showToastKey(extractArchives ? "toast.upload_extract_done" : "toast.upload_done");
    } catch (error) {
        showToast(error.message, "error");
    } finally {
        if (els.uploadFilesInput) els.uploadFilesInput.value = "";
        if (els.uploadArchiveInput) els.uploadArchiveInput.value = "";
    }
}

function bindDropzone() {
    if (!els.dropzone) return;

    ["dragenter", "dragover"].forEach((eventName) => {
        els.dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            els.dropzone.classList.add("is-dragover");
        });
    });

    ["dragleave", "dragend", "drop"].forEach((eventName) => {
        els.dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            els.dropzone.classList.remove("is-dragover");
        });
    });

    els.dropzone.addEventListener("drop", (event) => {
        const files = [...(event.dataTransfer?.files || [])];
        if (!files.length) return;
        const onlyArchives = files.every((file) => file.name.toLowerCase().endsWith(".zip"));
        handleUpload(files, onlyArchives);
    });
}

async function syncFileModeFromUrl({ replaceHistory = false } = {}) {
    const url = new URL(window.location.href);
    const requestedPath = url.searchParams.get("path") || "";
    const requestedFile = url.searchParams.get("file") || "";

    if (requestedFile) {
        const opened = await openFile(requestedFile, { pushHistory: false });
        if (!opened) {
            syncFileUrl({ replaceHistory: true });
        }
        return;
    }

    if (requestedPath !== state.currentPath) {
        await refreshFiles(requestedPath);
    }

    const closed = closeFileEditor({ updateHistory: false });
    if (!closed) {
        syncFileUrl({ replaceHistory: true });
        return;
    }

    if (replaceHistory) {
        syncFileUrl({ replaceHistory: true });
    }
}

async function openFile(path, { pushHistory = true, force = false } = {}) {
    if (!path) return false;
    if (!force && state.currentFile && state.currentFile !== path && isEditorDirty() && !window.confirm(tr("error.unsaved_changes"))) {
        return false;
    }

    try {
        const payload = await api(`/api/files/content?path=${encodeURIComponent(path)}`);
        const parentPath = payload.path.includes("/") ? payload.path.split("/").slice(0, -1).join("/") : "";
        if (parentPath !== state.currentPath) {
            await refreshFiles(parentPath);
        }
        state.currentFile = payload.path;
        state.originalContent = payload.content || "";
        if (els.editorTitle) els.editorTitle.textContent = payload.name || payload.path || tr("files.editor_title");
        if (els.editorPath) els.editorPath.textContent = payload.path || "/";
        if (els.editorLanguage) els.editorLanguage.textContent = detectLanguage(payload.path);
        if (els.editorTextarea) els.editorTextarea.value = payload.content || "";
        if (els.reloadFileBtn) els.reloadFileBtn.disabled = false;
        if (els.saveFileBtn) els.saveFileBtn.disabled = false;
        setFileEditorMode(true);
        renderEditorDirtyState();
        if (pushHistory) syncFileUrl();
        else syncFileUrl({ replaceHistory: true });
        els.editorTextarea?.focus();
        return true;
    } catch (error) {
        showToast(error.message, "error");
        return false;
    }
}

function syncFileUrl({ replaceHistory = false } = {}) {
    const url = new URL(window.location.href);
    if (state.currentPath) url.searchParams.set("path", state.currentPath);
    else url.searchParams.delete("path");

    if (state.currentFile) url.searchParams.set("file", state.currentFile);
    else url.searchParams.delete("file");

    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const method = replaceHistory ? "replaceState" : "pushState";
    window.history[method]({}, "", nextUrl);
}

function closeFileEditor({ updateHistory = true, force = false } = {}) {
    if (!force && state.currentFile && isEditorDirty() && !window.confirm(tr("error.unsaved_changes"))) {
        return false;
    }
    state.currentFile = null;
    state.originalContent = "";
    clearEditor();
    setFileEditorMode(false);
    if (updateHistory) syncFileUrl({ replaceHistory: true });
    els.fileSearchInput?.focus();
    return true;
}

function setFileEditorMode(isEditorOpen) {
    els.fileBrowserView?.classList.toggle("hidden", Boolean(isEditorOpen));
    els.fileEditorView?.classList.toggle("hidden", !isEditorOpen);
}

function handleEditorTabKey(event) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const target = event.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    target.value = `${target.value.slice(0, start)}\t${target.value.slice(end)}`;
    target.selectionStart = target.selectionEnd = start + 1;
    renderEditorDirtyState();
}

function isEditorDirty() {
    return Boolean(state.currentFile) && (els.editorTextarea?.value || "") !== (state.originalContent || "");
}

function renderEditorDirtyState() {
    const dirty = isEditorDirty();
    if (els.editorDirtyBadge) {
        els.editorDirtyBadge.dataset.dirty = String(dirty);
        els.editorDirtyBadge.textContent = dirty ? tr("files.editor_unsaved") : tr("files.editor_saved");
    }
    if (els.saveFileBtn) {
        els.saveFileBtn.disabled = !state.currentFile || !dirty;
    }
    if (els.reloadFileBtn) {
        els.reloadFileBtn.disabled = !state.currentFile;
    }
    if (els.editorMeta) {
        els.editorMeta.textContent = state.currentFile
            ? tr("editor.meta", {
                path: state.currentFile,
                count: (els.editorTextarea?.value || "").length,
            })
            : tr("editor.none");
    }
}

async function saveCurrentFile() {
    if (!state.currentFile) return;
    try {
        await api("/api/files/content", {
            method: "PUT",
            body: JSON.stringify({
                path: state.currentFile,
                content: els.editorTextarea?.value || "",
            }),
        });
        state.originalContent = els.editorTextarea?.value || "";
        renderEditorDirtyState();
        showToastKey("toast.file_saved");
        await refreshFiles(state.currentPath);
    } catch (error) {
        showToast(error.message, "error");
    }
}

function clearEditor() {
    if (els.editorTitle) els.editorTitle.textContent = tr("files.editor_empty");
    if (els.editorPath) els.editorPath.textContent = "/";
    if (els.editorLanguage) els.editorLanguage.textContent = "Text";
    if (els.editorTextarea) els.editorTextarea.value = "";
    if (els.editorDirtyBadge) {
        els.editorDirtyBadge.dataset.dirty = "false";
        els.editorDirtyBadge.textContent = tr("files.editor_saved");
    }
    if (els.editorMeta) els.editorMeta.textContent = tr("editor.none");
    if (els.reloadFileBtn) els.reloadFileBtn.disabled = true;
    if (els.saveFileBtn) els.saveFileBtn.disabled = true;
}

function downloadEntry(path) {
    if (!path) return;
    window.open(`/api/files/download?path=${encodeURIComponent(path)}`, "_blank", "noopener");
}

async function extractArchive(path) {
    try {
        await api("/api/files/extract", {
            method: "POST",
            body: JSON.stringify({
                path,
                destination: state.currentPath,
            }),
        });
        await refreshFiles(state.currentPath);
        showToastKey("toast.archive_extracted");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function downloadSelection(paths) {
    const uniquePaths = [...new Set(paths.filter(Boolean))];
    if (!uniquePaths.length) return;

    try {
        const response = await fetch("/api/files/download-selection", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths: uniquePaths }),
        });
        if (!response.ok) {
            throw new Error(await extractError(response));
        }

        const blob = await response.blob();
        const disposition = response.headers.get("content-disposition") || "";
        const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
        const fileName = match?.[1] || "selection.zip";
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
    } catch (error) {
        showToast(error.message, "error");
    }
}

function bindSchedulesPage() {
    Object.assign(els, {
        newScheduleBtn: byId("newScheduleBtn"),
        scheduleForm: byId("scheduleForm"),
        scheduleTableBody: byId("scheduleTableBody"),
        scheduleIdInput: byId("scheduleIdInput"),
        scheduleNameInput: byId("scheduleNameInput"),
        scheduleActionInput: byId("scheduleActionInput"),
        scheduleIntervalInput: byId("scheduleIntervalInput"),
        scheduleCommandInput: byId("scheduleCommandInput"),
        scheduleCommandWrap: byId("scheduleCommandWrap"),
        scheduleEnabledInput: byId("scheduleEnabledInput"),
        saveScheduleBtn: byId("saveScheduleBtn"),
        cancelScheduleBtn: byId("cancelScheduleBtn"),
    });

    els.newScheduleBtn?.addEventListener("click", () => openScheduleForm());
    els.cancelScheduleBtn?.addEventListener("click", closeScheduleForm);
    els.scheduleActionInput?.addEventListener("change", toggleScheduleCommandVisibility);
    els.scheduleForm?.addEventListener("submit", saveSchedule);
    els.scheduleTableBody?.addEventListener("click", handleScheduleTableClick);

    toggleScheduleCommandVisibility();
    refreshSchedules();
}

async function refreshSchedules() {
    try {
        const payload = await api("/api/schedules");
        state.schedules = payload.items || [];
        renderSchedules();
    } catch (error) {
        showToast(error.message, "error");
    }
}

function renderSchedules() {
    if (!els.scheduleTableBody) return;
    if (!state.schedules.length) {
        els.scheduleTableBody.innerHTML = `<tr><td colspan="7"><div class="empty-state">${escapeHtml(tr("schedules.empty"))}</div></td></tr>`;
        return;
    }

    els.scheduleTableBody.innerHTML = state.schedules
        .map((schedule) => `
            <tr>
                <td>${escapeHtml(schedule.name)}</td>
                <td>${escapeHtml(renderScheduleAction(schedule.action, schedule.command))}</td>
                <td>${escapeHtml(`${schedule.interval_minutes} min`)}</td>
                <td>${escapeHtml(formatIsoDate(schedule.next_run_at))}</td>
                <td>${escapeHtml(formatIsoDate(schedule.last_run_at))}</td>
                <td>${escapeHtml(renderScheduleStatus(schedule.last_status, schedule.last_error))}</td>
                <td>
                    <div class="file-actions">
                        <button class="file-action-link" type="button" data-action="edit" data-id="${schedule.schedule_id}">${escapeHtml(tr("common.edit"))}</button>
                        <button class="file-action-link" type="button" data-action="toggle" data-id="${schedule.schedule_id}" data-enabled="${String(schedule.enabled)}">${escapeHtml(tr(schedule.enabled ? "common.disable" : "common.enable"))}</button>
                        <button class="file-action-link" type="button" data-action="delete" data-id="${schedule.schedule_id}">${escapeHtml(tr("common.delete"))}</button>
                    </div>
                </td>
            </tr>
        `)
        .join("");
}

function handleScheduleTableClick(event) {
    const button = event.target.closest("button[data-action][data-id]");
    if (!button) return;
    const schedule = state.schedules.find((item) => item.schedule_id === button.dataset.id);
    if (!schedule) return;

    if (button.dataset.action === "edit") openScheduleForm(schedule);
    if (button.dataset.action === "toggle") toggleSchedule(schedule.schedule_id, !schedule.enabled);
    if (button.dataset.action === "delete") removeSchedule(schedule.schedule_id);
}

function openScheduleForm(schedule = null) {
    if (!els.scheduleForm) return;
    els.scheduleForm.classList.remove("hidden");
    els.scheduleIdInput.value = schedule?.schedule_id || "";
    els.scheduleNameInput.value = schedule?.name || "";
    els.scheduleActionInput.value = schedule?.action || "bot_start";
    els.scheduleIntervalInput.value = String(schedule?.interval_minutes || 5);
    els.scheduleCommandInput.value = schedule?.command || "";
    els.scheduleEnabledInput.checked = schedule?.enabled ?? true;
    toggleScheduleCommandVisibility();
    els.scheduleNameInput.focus();
}

function closeScheduleForm() {
    if (!els.scheduleForm) return;
    els.scheduleForm.classList.add("hidden");
    els.scheduleIdInput.value = "";
    els.scheduleNameInput.value = "";
    els.scheduleActionInput.value = "bot_start";
    els.scheduleIntervalInput.value = "5";
    els.scheduleCommandInput.value = "";
    els.scheduleEnabledInput.checked = true;
    toggleScheduleCommandVisibility();
}

function toggleScheduleCommandVisibility() {
    const needsCommand = els.scheduleActionInput?.value === "console";
    els.scheduleCommandWrap?.classList.toggle("hidden", !needsCommand);
    if (els.scheduleCommandInput) {
        els.scheduleCommandInput.disabled = !needsCommand;
    }
}

async function saveSchedule(event) {
    event.preventDefault();
    try {
        await api("/api/schedules", {
            method: "POST",
            body: JSON.stringify({
                schedule_id: els.scheduleIdInput?.value || null,
                name: els.scheduleNameInput?.value || "",
                action: els.scheduleActionInput?.value || "bot_start",
                interval_minutes: Number(els.scheduleIntervalInput?.value || 5),
                command: els.scheduleCommandInput?.value || "",
                enabled: Boolean(els.scheduleEnabledInput?.checked),
            }),
        });
        closeScheduleForm();
        await refreshSchedules();
        showToastKey("toast.schedule_saved");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function toggleSchedule(scheduleId, enabled) {
    try {
        await api(`/api/schedules/${encodeURIComponent(scheduleId)}/enabled?enabled=${String(enabled)}`, {
            method: "POST",
        });
        await refreshSchedules();
        showToastKey(enabled ? "toast.schedule_enabled" : "toast.schedule_disabled");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function removeSchedule(scheduleId) {
    if (!window.confirm(tr("common.delete"))) return;
    try {
        await api(`/api/schedules/${encodeURIComponent(scheduleId)}`, {
            method: "DELETE",
        });
        await refreshSchedules();
        showToastKey("toast.schedule_deleted");
    } catch (error) {
        showToast(error.message, "error");
    }
}

function renderScheduleAction(action, command) {
    if (action === "console") {
        return `${tr("schedule.console")}: ${command || tr("common.none")}`;
    }
    return tr(`schedule.${action}`);
}

function renderScheduleStatus(status, errorText = "") {
    if (!status) return tr("common.none");
    const labels = {
        queued: state.locale === "de" ? "Eingeplant" : "Queued",
        success: renderTaskStatus("success"),
        failed: renderTaskStatus("failed"),
        running: renderTaskStatus("running"),
        pending: renderTaskStatus("pending"),
    };
    const label = labels[status] || status;
    return errorText ? `${label}: ${errorText}` : label;
}

function bindHistoryAndLogs() {
    Object.assign(els, {
        historyList: byId("historyList"),
        logOutput: byId("logOutput"),
        dashboardLogPreview: byId("dashboardLogPreview"),
        downloadLogsLink: byId("downloadLogsLink"),
        logTabButtons: queryAll("[data-log-tab]"),
    });

    els.logTabButtons.forEach((button) => {
        button.addEventListener("click", () => switchLogTab(button.dataset.logTab || "bot"));
    });

    if (els.dashboardLogPreview || els.logOutput) {
        connectLogSocket("bot");
    }
    if (els.logOutput) {
        connectLogSocket("system");
    }
    renderLogSurfaces();
}

function bindTour() {
    if (!els.tourShell || !els.tourNextBtn || !els.tourSkipBtn) return;

    els.mascotHelpBtn?.addEventListener("click", () => openTour({ force: true }));
    els.tourNextBtn.addEventListener("click", () => {
        if (tourIndex >= tourSteps.length - 1) {
            closeTour({ remember: true });
            return;
        }
        tourIndex += 1;
        renderTourStep();
    });
    els.tourSkipBtn.addEventListener("click", () => closeTour({ remember: true }));
    els.tourShell.addEventListener("click", (event) => {
        if (event.target === els.tourShell) closeTour({ remember: true });
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !els.tourShell.classList.contains("hidden")) {
            closeTour({ remember: true });
        }
    });

    if (!hasSeenTour()) {
        window.setTimeout(() => openTour(), 700);
    }
}

function hasSeenTour() {
    try {
        return window.localStorage.getItem(tourStorageKey) === "1";
    } catch {
        return true;
    }
}

function rememberTour() {
    try {
        window.localStorage.setItem(tourStorageKey, "1");
    } catch {
        // Ignore storage errors; the tour still works for this session.
    }
}

function openTour({ force = false } = {}) {
    if (!els.tourShell) return;
    if (!force && hasSeenTour()) return;
    tourIndex = 0;
    renderTourStep();
    els.tourShell.classList.remove("hidden");
    window.setTimeout(() => els.tourNextBtn?.focus(), 0);
}

function closeTour({ remember = false } = {}) {
    if (remember) rememberTour();
    els.tourShell?.classList.add("hidden");
}

function renderTourStep() {
    if (!els.tourText || !els.tourProgress || !els.tourNextBtn) return;
    els.tourText.textContent = tr(tourSteps[tourIndex]);
    els.tourNextBtn.textContent = tourIndex >= tourSteps.length - 1 ? tr("tour.finish") : tr("tour.next");
    els.tourProgress.innerHTML = tourSteps
        .map((_, index) => `<span class="${index === tourIndex ? "is-active" : ""}"></span>`)
        .join("");
}

function switchLogTab(tab) {
    state.logTab = tab === "system" ? "system" : "bot";
    renderLogSurfaces();
}

function connectLogSocket(channel) {
    if (state.sockets[channel]) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/logs/${channel}`);
    state.sockets[channel] = socket;

    socket.addEventListener("message", (event) => {
        state.logBuffers[channel].push(event.data);
        if (state.logBuffers[channel].length > 400) {
            state.logBuffers[channel] = state.logBuffers[channel].slice(-400);
        }
        renderLogSurfaces();
    });

    socket.addEventListener("close", () => {
        if (state.sockets[channel] === socket) {
            delete state.sockets[channel];
        }
        window.setTimeout(() => connectLogSocket(channel), 2500);
    });
}

function renderLogSurfaces() {
    if (els.dashboardLogPreview) {
        els.dashboardLogPreview.textContent = state.logBuffers.bot.length
            ? state.logBuffers.bot.slice(-160).join("\n")
            : tr("activity.waiting");
    }

    if (els.logOutput) {
        const buffer = state.logBuffers[state.logTab] || [];
        els.logOutput.textContent = buffer.length ? buffer.join("\n") : tr("activity.waiting");
    }

    if (els.downloadLogsLink) {
        els.downloadLogsLink.href = `/api/logs/${state.logTab}/download`;
    }

    els.logTabButtons?.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.logTab === state.logTab);
    });
}

async function refreshHistory({ silent = false } = {}) {
    if (!els.historyList) return;
    try {
        const payload = await api("/api/history");
        renderHistory(payload.items || []);
    } catch (error) {
        if (!silent) showToast(error.message, "error");
    }
}

function renderHistory(items) {
    if (!els.historyList) return;
    if (!items.length) {
        els.historyList.innerHTML = `
            <div class="empty-state activity-empty-state">
                <strong>${escapeHtml(tr("activity.empty_history"))}</strong>
                <span>${escapeHtml(tr("activity.history_hint"))}</span>
            </div>
        `;
        return;
    }

    els.historyList.innerHTML = items
        .map((item) => `
            <article class="history-item">
                <div class="history-topline">
                    <span class="history-state">${escapeHtml(renderProcessState(item.state))}</span>
                    <time>${escapeHtml(formatIsoDate(item.timestamp))}</time>
                </div>
                <p>${escapeHtml(item.message || tr("common.none"))}</p>
                <span class="history-meta">Exit ${escapeHtml(item.exit_code ?? "-")}</span>
            </article>
        `)
        .join("");
}

function bindModal() {
    if (!els.modalShell || !els.modalForm) return;

    els.modalCancelBtn?.addEventListener("click", () => closeModal());
    els.modalSecondaryBtn?.addEventListener("click", () => closeModal());
    els.modalShell.addEventListener("click", (event) => {
        if (event.target === els.modalShell) closeModal();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !els.modalShell.classList.contains("hidden")) {
            closeModal();
        }
    });

    els.modalForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!activeModal?.onConfirm) {
            closeModal();
            return;
        }
        const result = await activeModal.onConfirm({
            fieldOne: els.modalFieldOneInput?.value || "",
            fieldTwo: els.modalFieldTwoInput?.value || "",
        });
        if (result !== false) {
            closeModal();
        }
    });
}

function openModal(config) {
    activeModal = config;
    if (els.modalEyebrow) els.modalEyebrow.textContent = config.eyebrow || "";
    if (els.modalTitle) els.modalTitle.textContent = config.title || "";
    if (els.modalDescription) els.modalDescription.textContent = config.description || "";
    if (els.modalFieldOneLabel) els.modalFieldOneLabel.textContent = config.fieldOneLabel || tr("modal.name");
    if (els.modalFieldOneInput) {
        els.modalFieldOneInput.value = config.fieldOneValue || "";
        els.modalFieldOneInput.placeholder = config.fieldOnePlaceholder || "";
    }
    if (els.modalFieldTwoWrap) els.modalFieldTwoWrap.classList.toggle("hidden", !config.fieldTwoLabel);
    if (els.modalFieldTwoLabel) els.modalFieldTwoLabel.textContent = config.fieldTwoLabel || "";
    if (els.modalFieldTwoInput) {
        els.modalFieldTwoInput.value = config.fieldTwoValue || "";
        els.modalFieldTwoInput.placeholder = config.fieldTwoPlaceholder || "";
    }
    if (els.modalConfirmBtn) els.modalConfirmBtn.textContent = config.confirmText || tr("common.save");
    if (els.modalSecondaryBtn) els.modalSecondaryBtn.textContent = config.cancelText || tr("schedules.cancel");
    els.modalShell?.classList.remove("hidden");
    window.setTimeout(() => els.modalFieldOneInput?.focus(), 0);
}

function closeModal() {
    activeModal = null;
    els.modalShell?.classList.add("hidden");
    els.modalForm?.reset();
    els.modalFieldTwoWrap?.classList.add("hidden");
}

function renderTaskStatus(status) {
    const mapping = {
        pending: tr("task.pending"),
        running: tr("task.running"),
        success: tr("task.success"),
        failed: tr("task.failed"),
    };
    return mapping[status] || status || tr("common.none");
}

function renderProcessState(value) {
    const mapping = {
        running: tr("process.running"),
        stopped: tr("process.stopped"),
        crashed: tr("process.crashed"),
    };
    return mapping[value] || value || tr("common.none");
}

function detectLanguage(path = "") {
    const lower = path.toLowerCase();
    if (lower.endsWith(".py")) return "Python";
    if (lower.endsWith(".md")) return "Markdown";
    if (lower.endsWith(".json")) return "JSON";
    if (lower.endsWith(".html")) return "HTML";
    if (lower.endsWith(".css")) return "CSS";
    if (lower.endsWith(".js")) return "JavaScript";
    if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "YAML";
    if (lower.endsWith(".toml")) return "TOML";
    if (lower.endsWith(".ini") || lower.endsWith(".cfg") || lower.endsWith(".conf")) return "INI";
    if (lower.endsWith(".env")) return "ENV";
    if (lower.endsWith(".log")) return "Log";
    return "Text";
}

function formatUnixDate(value) {
    if (!value && value !== 0) return tr("common.none");
    return dateTimeFormatter.format(new Date(Number(value) * 1000));
}

function formatIsoDate(value) {
    if (!value) return tr("common.none");
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return tr("common.none");
    return dateTimeFormatter.format(date);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
