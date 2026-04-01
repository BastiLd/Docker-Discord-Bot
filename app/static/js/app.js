const initial = window.__INITIAL_STATE__ || {};

const state = {
    settings: initial.settings || {},
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
};

const els = {};
const dateFormatter = new Intl.DateTimeFormat("de-AT", { dateStyle: "medium", timeStyle: "short" });

document.addEventListener("DOMContentLoaded", () => {
    collectElements();
    bindNavigation();
    bindDashboard();
    bindFiles();
    bindEditor();
    bindEnvironment();
    bindTasks();
    bindLogs();
    bindModal();
    applySettingsToForm();
    renderEnvList();
    refreshStatus();
    refreshFiles("");
    refreshHistory();
    refreshTasks();
    connectLogSocket("bot");
    connectLogSocket("system");
    setInterval(refreshStatus, 5000);
    setInterval(refreshHistory, 7000);
    setInterval(refreshTasks, 4000);
    window.addEventListener("beforeunload", (event) => {
        if (isEditorDirty()) {
            event.preventDefault();
            event.returnValue = "";
        }
    });
});

function collectElements() {
    Object.assign(els, {
        navLinks: [...document.querySelectorAll(".nav-link")],
        statusState: document.getElementById("statusState"),
        statusBadge: document.getElementById("statusBadge"),
        statusPid: document.getElementById("statusPid"),
        statusUptime: document.getElementById("statusUptime"),
        statusExit: document.getElementById("statusExit"),
        statusCommand: document.getElementById("statusCommand"),
        statusError: document.getElementById("statusError"),
        startBotBtn: document.getElementById("startBotBtn"),
        stopBotBtn: document.getElementById("stopBotBtn"),
        restartBotBtn: document.getElementById("restartBotBtn"),
        startCommandInput: document.getElementById("startCommandInput"),
        autoRestartInput: document.getElementById("autoRestartInput"),
        useVenvInput: document.getElementById("useVenvInput"),
        restartDelayInput: document.getElementById("restartDelayInput"),
        saveSettingsBtn: document.getElementById("saveSettingsBtn"),
        installDepsBtn: document.getElementById("installDepsBtn"),
        installPackageBtn: document.getElementById("installPackageBtn"),
        packageInput: document.getElementById("packageInput"),
        navigateUpBtn: document.getElementById("navigateUpBtn"),
        refreshFilesBtn: document.getElementById("refreshFilesBtn"),
        newFileBtn: document.getElementById("newFileBtn"),
        newFolderBtn: document.getElementById("newFolderBtn"),
        uploadFilesBtn: document.getElementById("uploadFilesBtn"),
        uploadArchiveBtn: document.getElementById("uploadArchiveBtn"),
        uploadFilesInput: document.getElementById("uploadFilesInput"),
        uploadArchiveInput: document.getElementById("uploadArchiveInput"),
        bulkDeleteBtn: document.getElementById("bulkDeleteBtn"),
        bulkDownloadBtn: document.getElementById("bulkDownloadBtn"),
        bulkMoveBtn: document.getElementById("bulkMoveBtn"),
        bulkCopyBtn: document.getElementById("bulkCopyBtn"),
        fileSearchInput: document.getElementById("fileSearchInput"),
        breadcrumbs: document.getElementById("breadcrumbs"),
        dropzone: document.getElementById("dropzone"),
        fileTableBody: document.getElementById("fileTableBody"),
        selectAllCheckbox: document.getElementById("selectAllCheckbox"),
        editorTitle: document.getElementById("editorTitle"),
        editorLanguage: document.getElementById("editorLanguage"),
        editorDirtyBadge: document.getElementById("editorDirtyBadge"),
        reloadFileBtn: document.getElementById("reloadFileBtn"),
        saveFileBtn: document.getElementById("saveFileBtn"),
        editorTextarea: document.getElementById("editorTextarea"),
        editorMeta: document.getElementById("editorMeta"),
        envList: document.getElementById("envList"),
        addEnvBtn: document.getElementById("addEnvBtn"),
        saveEnvBtn: document.getElementById("saveEnvBtn"),
        consoleForm: document.getElementById("consoleForm"),
        consoleInput: document.getElementById("consoleInput"),
        taskList: document.getElementById("taskList"),
        taskOutput: document.getElementById("taskOutput"),
        tabButtons: [...document.querySelectorAll(".tab-button")],
        downloadLogsLink: document.getElementById("downloadLogsLink"),
        logOutput: document.getElementById("logOutput"),
        historyList: document.getElementById("historyList"),
        toastStack: document.getElementById("toastStack"),
        modalShell: document.getElementById("modalShell"),
        modalEyebrow: document.getElementById("modalEyebrow"),
        modalTitle: document.getElementById("modalTitle"),
        modalDescription: document.getElementById("modalDescription"),
        modalForm: document.getElementById("modalForm"),
        modalFieldOneWrap: document.getElementById("modalFieldOneWrap"),
        modalFieldOneLabel: document.getElementById("modalFieldOneLabel"),
        modalFieldOneInput: document.getElementById("modalFieldOneInput"),
        modalFieldTwoWrap: document.getElementById("modalFieldTwoWrap"),
        modalFieldTwoLabel: document.getElementById("modalFieldTwoLabel"),
        modalFieldTwoInput: document.getElementById("modalFieldTwoInput"),
        modalConfirmBtn: document.getElementById("modalConfirmBtn"),
        modalCancelBtn: document.getElementById("modalCancelBtn"),
    });
}

async function api(path, options = {}) {
    const response = await fetch(path, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options,
    });
    if (!response.ok) {
        let detail = "Unbekannter Fehler";
        try {
            const payload = await response.json();
            detail = payload.detail || JSON.stringify(payload);
        } catch {
            detail = await response.text();
        }
        throw new Error(detail);
    }
    return response.status === 204 ? null : response.json();
}

function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    els.toastStack.appendChild(toast);
    setTimeout(() => toast.remove(), 4200);
}

function bindNavigation() {
    els.navLinks.forEach((button) => {
        button.addEventListener("click", () => {
            const target = document.getElementById(button.dataset.target);
            if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
            els.navLinks.forEach((item) => item.classList.remove("active"));
            button.classList.add("active");
        });
    });
}

function bindDashboard() {
    els.startBotBtn.addEventListener("click", () => controlBot("start"));
    els.stopBotBtn.addEventListener("click", () => controlBot("stop"));
    els.restartBotBtn.addEventListener("click", () => controlBot("restart"));
    els.saveSettingsBtn.addEventListener("click", saveSettings);
    els.installDepsBtn.addEventListener("click", () => startTask("/api/tasks/install-deps", {}));
    els.installPackageBtn.addEventListener("click", () => {
        const pkg = els.packageInput.value.trim();
        if (!pkg) return showToast("Bitte zuerst einen Paketnamen eingeben.", "error");
        startTask("/api/tasks/install-package", { package: pkg });
        els.packageInput.value = "";
    });
}

async function controlBot(action) {
    try {
        await api(`/api/bot/${action}`, { method: "POST" });
        await refreshStatus();
        await refreshHistory();
        showToast(`Bot ${action} ausgefuehrt.`);
    } catch (error) {
        showToast(error.message, "error");
    }
}

function applySettingsToForm() {
    els.startCommandInput.value = state.settings.start_command || "python bot.py";
    els.autoRestartInput.checked = Boolean(state.settings.auto_restart);
    els.useVenvInput.checked = state.settings.use_virtualenv !== false;
    els.restartDelayInput.value = state.settings.restart_delay_seconds || 5;
}

async function saveSettings() {
    try {
        const payload = {
            start_command: els.startCommandInput.value.trim() || "python bot.py",
            auto_restart: els.autoRestartInput.checked,
            use_virtualenv: els.useVenvInput.checked,
            restart_delay_seconds: Number(els.restartDelayInput.value || 5),
        };
        state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify(payload) });
        await refreshStatus();
        showToast("Settings gespeichert.");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function refreshStatus() {
    try {
        const payload = await api("/api/status");
        renderStatus(payload);
    } catch (error) {
        showToast(error.message, "error");
    }
}

function renderStatus(payload) {
    const stateLabel = { running: "Bot laeuft", stopped: "Bot gestoppt", crashed: "Bot abgestuerzt" }[payload.state] || "Status unbekannt";
    els.statusState.textContent = stateLabel;
    els.statusBadge.textContent = payload.state || "unknown";
    els.statusBadge.className = `status-pill ${payload.state || "unknown"}`;
    els.statusPid.textContent = payload.pid ?? "-";
    els.statusUptime.textContent = payload.uptime_human || "-";
    els.statusExit.textContent = payload.last_exit_code ?? "-";
    els.statusCommand.textContent = payload.last_command || "python bot.py";
    els.statusError.textContent = payload.last_error || "";
}

function bindFiles() {
    els.refreshFilesBtn.addEventListener("click", () => refreshFiles(state.currentPath));
    els.navigateUpBtn.addEventListener("click", navigateUp);
    els.newFileBtn.addEventListener("click", () => createEntry("file"));
    els.newFolderBtn.addEventListener("click", () => createEntry("folder"));
    els.uploadFilesBtn.addEventListener("click", () => els.uploadFilesInput.click());
    els.uploadArchiveBtn.addEventListener("click", () => els.uploadArchiveInput.click());
    els.uploadFilesInput.addEventListener("change", () => handleFileInput(els.uploadFilesInput.files, false));
    els.uploadArchiveInput.addEventListener("change", () => handleFileInput(els.uploadArchiveInput.files, true));
    els.fileSearchInput.addEventListener("input", renderFileTable);
    els.fileTableBody.addEventListener("click", handleFileTableClick);
    els.fileTableBody.addEventListener("change", handleFileSelectionChange);
    els.selectAllCheckbox.addEventListener("change", toggleSelectAll);
    els.bulkDeleteBtn.addEventListener("click", bulkDelete);
    els.bulkDownloadBtn.addEventListener("click", () => downloadSelection([...state.selected]));
    els.bulkMoveBtn.addEventListener("click", () => transferSelection("move"));
    els.bulkCopyBtn.addEventListener("click", () => transferSelection("copy"));
    bindDropzone();
}

async function refreshFiles(path) {
    try {
        const payload = await api(`/api/files?path=${encodeURIComponent(path || "")}`);
        state.currentPath = payload.current_path;
        state.entries = payload.entries;
        state.selected.clear();
        renderBreadcrumbs(payload.breadcrumbs);
        renderFileTable();
        updateSelectionActions();
    } catch (error) {
        showToast(error.message, "error");
    }
}

function renderBreadcrumbs(breadcrumbs) {
    els.breadcrumbs.innerHTML = breadcrumbs.map((crumb) => `<button class="crumb" data-path="${escapeHtml(crumb.path)}">${escapeHtml(crumb.name)}</button>`).join("");
    [...els.breadcrumbs.querySelectorAll(".crumb")].forEach((button) => button.addEventListener("click", () => refreshFiles(button.dataset.path)));
}

function filteredEntries() {
    const query = els.fileSearchInput.value.trim().toLowerCase();
    if (!query) return state.entries;
    return state.entries.filter((entry) => entry.name.toLowerCase().includes(query));
}

function renderFileTable() {
    const rows = filteredEntries().map((entry) => {
        const checked = state.selected.has(entry.path) ? "checked" : "";
        const typeLabel = entry.kind === "directory" ? "Ordner" : entry.extension || "Datei";
        const actions = [
            entry.kind === "directory"
                ? `<button class="file-action" data-action="open" data-path="${escapeHtml(entry.path)}">Oeffnen</button>`
                : entry.editable
                    ? `<button class="file-action" data-action="edit" data-path="${escapeHtml(entry.path)}">Edit</button>`
                    : "",
            `<button class="file-action" data-action="rename" data-path="${escapeHtml(entry.path)}">Rename</button>`,
            `<button class="file-action" data-action="download" data-path="${escapeHtml(entry.path)}">Download</button>`,
            entry.extractable ? `<button class="file-action" data-action="extract" data-path="${escapeHtml(entry.path)}">Unzip</button>` : "",
            `<button class="file-action" data-action="delete" data-path="${escapeHtml(entry.path)}">Delete</button>`,
        ].join("");
        return `
            <tr>
                <td><input type="checkbox" data-path="${escapeHtml(entry.path)}" ${checked}></td>
                <td>
                    <button class="file-name-button" data-action="${entry.kind === "directory" ? "open" : entry.editable ? "edit" : "download"}" data-path="${escapeHtml(entry.path)}">${escapeHtml(entry.name)}</button>
                </td>
                <td><span class="file-type">${escapeHtml(typeLabel)}</span></td>
                <td>${escapeHtml(entry.size_human || "--")}</td>
                <td>${formatDate(entry.modified_at)}</td>
                <td><div class="row-actions">${actions}</div></td>
            </tr>
        `;
    }).join("");
    els.fileTableBody.innerHTML = rows || `<tr><td colspan="6" class="muted">Dieser Ordner ist leer.</td></tr>`;
    els.selectAllCheckbox.checked = filteredEntries().length > 0 && filteredEntries().every((entry) => state.selected.has(entry.path));
}

function handleFileTableClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const { action, path } = button.dataset;
    if (action === "open") return refreshFiles(path);
    if (action === "edit") return openFile(path);
    if (action === "rename") return renameEntry(path);
    if (action === "delete") return deleteEntries([path]);
    if (action === "download") return downloadEntry(path);
    if (action === "extract") return extractArchive(path);
}

function handleFileSelectionChange(event) {
    const input = event.target;
    if (!input.matches("input[type='checkbox'][data-path]")) return;
    if (input.checked) state.selected.add(input.dataset.path);
    else state.selected.delete(input.dataset.path);
    updateSelectionActions();
}

function toggleSelectAll() {
    filteredEntries().forEach((entry) => {
        if (els.selectAllCheckbox.checked) state.selected.add(entry.path);
        else state.selected.delete(entry.path);
    });
    renderFileTable();
    updateSelectionActions();
}

function updateSelectionActions() {
    const disabled = state.selected.size === 0;
    els.bulkDeleteBtn.disabled = disabled;
    els.bulkDownloadBtn.disabled = disabled;
    els.bulkMoveBtn.disabled = disabled;
    els.bulkCopyBtn.disabled = disabled;
}

function navigateUp() {
    if (!state.currentPath) return;
    const parts = state.currentPath.split("/");
    parts.pop();
    refreshFiles(parts.join("/"));
}

async function createEntry(kind) {
    const response = await openModal({
        eyebrow: kind === "file" ? "Neue Datei" : "Neuer Ordner",
        title: kind === "file" ? "Datei anlegen" : "Ordner anlegen",
        description: `Wird in ${state.currentPath || "workspace"} angelegt.`,
        confirmLabel: kind === "file" ? "Datei erstellen" : "Ordner erstellen",
        firstLabel: "Name",
    });
    if (!response) return;
    try {
        const endpoint = kind === "file" ? "/api/files/new-file" : "/api/files/new-folder";
        await api(endpoint, { method: "POST", body: JSON.stringify({ parent_path: state.currentPath, name: response.first }) });
        await refreshFiles(state.currentPath);
        showToast(`${kind === "file" ? "Datei" : "Ordner"} erstellt.`);
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function renameEntry(path) {
    const name = path.split("/").pop() || path;
    const response = await openModal({
        eyebrow: "Rename",
        title: "Eintrag umbenennen",
        description: `Aktuell: ${name}`,
        confirmLabel: "Umbenennen",
        firstLabel: "Neuer Name",
        firstValue: name,
    });
    if (!response) return;
    try {
        await api("/api/files/rename", { method: "POST", body: JSON.stringify({ path, new_name: response.first }) });
        await refreshFiles(state.currentPath);
        showToast("Eintrag umbenannt.");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function deleteEntries(paths) {
    const ok = window.confirm(`Wirklich ${paths.length} Eintraege loeschen?`);
    if (!ok) return;
    try {
        await api("/api/files", { method: "DELETE", body: JSON.stringify({ paths }) });
        if (state.currentFile && paths.includes(state.currentFile)) clearEditor();
        await refreshFiles(state.currentPath);
        showToast("Eintraege geloescht.");
    } catch (error) {
        showToast(error.message, "error");
    }
}

function bulkDelete() {
    deleteEntries([...state.selected]);
}

async function transferSelection(mode) {
    const response = await openModal({
        eyebrow: mode === "move" ? "Move" : "Copy",
        title: mode === "move" ? "Auswahl verschieben" : "Auswahl kopieren",
        description: "Zielpfad relativ zum Workspace, leer fuer Root.",
        confirmLabel: mode === "move" ? "Verschieben" : "Kopieren",
        firstLabel: "Zielordner",
        firstValue: state.currentPath,
    });
    if (!response) return;
    try {
        await api(`/api/files/${mode}`, { method: "POST", body: JSON.stringify({ sources: [...state.selected], destination: response.first || "" }) });
        await refreshFiles(state.currentPath);
        showToast(mode === "move" ? "Auswahl verschoben." : "Auswahl kopiert.");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function handleFileInput(fileList, extractArchives) {
    const files = [...fileList];
    if (!files.length) return;
    const formData = new FormData();
    formData.append("path", state.currentPath);
    formData.append("extract_archives", String(extractArchives));
    files.forEach((file) => formData.append("files", file));
    try {
        const response = await fetch("/api/files/upload", { method: "POST", body: formData });
        if (!response.ok) throw new Error((await response.json()).detail || "Upload fehlgeschlagen.");
        await refreshFiles(state.currentPath);
        showToast(extractArchives ? "ZIP hochgeladen und verarbeitet." : "Dateien hochgeladen.");
    } catch (error) {
        showToast(error.message, "error");
    } finally {
        els.uploadFilesInput.value = "";
        els.uploadArchiveInput.value = "";
    }
}

function bindDropzone() {
    ["dragenter", "dragover"].forEach((eventName) => els.dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        els.dropzone.classList.add("dragover");
    }));
    ["dragleave", "drop"].forEach((eventName) => els.dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        els.dropzone.classList.remove("dragover");
    }));
    els.dropzone.addEventListener("drop", (event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return;
        const hasZip = [...files].some((file) => file.name.toLowerCase().endsWith(".zip"));
        handleFileInput(files, hasZip && window.confirm("ZIP-Dateien nach dem Upload direkt entpacken?"));
    });
}

async function openFile(path) {
    if (isEditorDirty() && !window.confirm("Ungespeicherte Aenderungen verwerfen?")) return;
    try {
        const payload = await api(`/api/files/content?path=${encodeURIComponent(path)}`);
        state.currentFile = payload.path;
        state.originalContent = payload.content;
        els.editorTextarea.value = payload.content;
        els.editorTitle.textContent = payload.name;
        els.editorLanguage.textContent = detectLanguage(payload.path);
        els.editorMeta.textContent = `${payload.path} • ${payload.content.length} Zeichen`;
        els.reloadFileBtn.disabled = false;
        els.saveFileBtn.disabled = false;
        renderEditorDirtyState();
    } catch (error) {
        showToast(error.message, "error");
    }
}

function bindEditor() {
    els.editorTextarea.addEventListener("input", renderEditorDirtyState);
    els.editorTextarea.addEventListener("keydown", (event) => {
        if (event.key === "Tab") {
            event.preventDefault();
            const start = els.editorTextarea.selectionStart;
            const end = els.editorTextarea.selectionEnd;
            const value = els.editorTextarea.value;
            els.editorTextarea.value = `${value.slice(0, start)}    ${value.slice(end)}`;
            els.editorTextarea.selectionStart = els.editorTextarea.selectionEnd = start + 4;
            renderEditorDirtyState();
        }
    });
    els.saveFileBtn.addEventListener("click", saveCurrentFile);
    els.reloadFileBtn.addEventListener("click", () => state.currentFile && openFile(state.currentFile));
}

function isEditorDirty() {
    return state.currentFile && els.editorTextarea.value !== state.originalContent;
}

function renderEditorDirtyState() {
    const dirty = isEditorDirty();
    els.editorDirtyBadge.textContent = dirty ? "Unsaved" : "Saved";
    els.editorDirtyBadge.dataset.dirty = dirty ? "true" : "false";
    if (state.currentFile) els.editorMeta.textContent = `${state.currentFile} • ${els.editorTextarea.value.length} Zeichen`;
}

async function saveCurrentFile() {
    if (!state.currentFile) return;
    try {
        await api("/api/files/content", { method: "PUT", body: JSON.stringify({ path: state.currentFile, content: els.editorTextarea.value }) });
        state.originalContent = els.editorTextarea.value;
        renderEditorDirtyState();
        await refreshFiles(state.currentPath);
        showToast("Datei gespeichert.");
    } catch (error) {
        showToast(error.message, "error");
    }
}

function clearEditor() {
    state.currentFile = null;
    state.originalContent = "";
    els.editorTextarea.value = "";
    els.editorTitle.textContent = "Keine Datei geoeffnet";
    els.editorLanguage.textContent = "text";
    els.editorMeta.textContent = "Keine Datei geladen";
    els.saveFileBtn.disabled = true;
    els.reloadFileBtn.disabled = true;
    renderEditorDirtyState();
}

function bindEnvironment() {
    els.addEnvBtn.addEventListener("click", () => {
        state.envEntries.push({ key: "", value: "", masked: false });
        renderEnvList();
    });
    els.saveEnvBtn.addEventListener("click", saveEnvEntries);
    els.envList.addEventListener("input", (event) => {
        const row = event.target.closest(".env-item");
        if (!row) return;
        const index = Number(row.dataset.index);
        const field = event.target.dataset.field;
        state.envEntries[index][field] = event.target.value;
    });
    els.envList.addEventListener("click", (event) => {
        const row = event.target.closest(".env-item");
        if (!row) return;
        const index = Number(row.dataset.index);
        if (event.target.matches("[data-action='toggle-mask']")) {
            state.envEntries[index].masked = !state.envEntries[index].masked;
            renderEnvList();
        }
        if (event.target.matches("[data-action='remove']")) {
            state.envEntries.splice(index, 1);
            renderEnvList();
        }
    });
}

function renderEnvList() {
    els.envList.innerHTML = state.envEntries.map((entry, index) => `
        <div class="env-item" data-index="${index}">
            <div class="env-row">
                <label><span class="env-key">Key</span><input data-field="key" type="text" value="${escapeHtml(entry.key || "")}" placeholder="DISCORD_TOKEN"></label>
                <label><span class="env-value">Value</span><input data-field="value" type="${entry.masked ? "password" : "text"}" value="${escapeHtml(entry.value || "")}" placeholder="Wert"></label>
                <button class="button subtle" type="button" data-action="toggle-mask">${entry.masked ? "Show" : "Mask"}</button>
                <button class="button danger" type="button" data-action="remove">Delete</button>
            </div>
        </div>
    `).join("") || `<div class="muted">Noch keine Variablen angelegt.</div>`;
}

async function saveEnvEntries() {
    try {
        const entries = state.envEntries.filter((entry) => entry.key.trim()).map((entry) => ({
            key: entry.key.trim(),
            value: entry.value ?? "",
            masked: Boolean(entry.masked),
        }));
        const payload = await api("/api/env", { method: "PUT", body: JSON.stringify({ entries }) });
        state.envEntries = payload.entries;
        renderEnvList();
        showToast(".env gespeichert.");
    } catch (error) {
        showToast(error.message, "error");
    }
}

function bindTasks() {
    els.consoleForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const command = els.consoleInput.value.trim();
        if (!command) return;
        await startTask("/api/tasks/console", { command });
        els.consoleInput.value = "";
    });
    els.taskList.addEventListener("click", (event) => {
        const item = event.target.closest("[data-task-id]");
        if (!item) return;
        state.activeTaskId = item.dataset.taskId;
        renderTasks();
        refreshActiveTask();
    });
}

async function startTask(endpoint, payload) {
    try {
        const task = await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
        state.activeTaskId = task.task_id;
        await refreshTasks();
        showToast(`Task gestartet: ${task.title}`);
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function refreshTasks() {
    try {
        const payload = await api("/api/tasks");
        state.tasks = payload.items;
        if (!state.activeTaskId && state.tasks[0]) state.activeTaskId = state.tasks[0].task_id;
        renderTasks();
        refreshActiveTask();
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function refreshActiveTask() {
    if (!state.activeTaskId) {
        els.taskOutput.textContent = "Noch kein Task ausgewaehlt.";
        return;
    }
    try {
        const payload = await api(`/api/tasks/${state.activeTaskId}`);
        els.taskOutput.textContent = payload.output || "Noch keine Ausgabe.";
        const task = state.tasks.find((entry) => entry.task_id === payload.task_id);
        if (task) Object.assign(task, payload);
        renderTasks();
    } catch (error) {
        showToast(error.message, "error");
    }
}

function renderTasks() {
    els.taskList.innerHTML = state.tasks.map((task) => `
        <button class="task-item ${state.activeTaskId === task.task_id ? "active" : ""}" data-task-id="${task.task_id}">
            <div class="task-title">${escapeHtml(task.title)}</div>
            <div class="task-meta">${escapeHtml(task.status)} • ${escapeHtml(task.duration || "n/a")}</div>
        </button>
    `).join("") || `<div class="muted">Noch keine Tasks gelaufen.</div>`;
}

function bindLogs() {
    els.tabButtons.forEach((button) => button.addEventListener("click", () => switchLogTab(button.dataset.logTab)));
}

function switchLogTab(tab) {
    state.logTab = tab;
    els.tabButtons.forEach((button) => button.classList.toggle("active", button.dataset.logTab === tab));
    els.downloadLogsLink.href = `/api/logs/${tab}/download`;
    els.logOutput.textContent = state.logBuffers[tab].join("\n");
    els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function connectLogSocket(channel) {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${location.host}/ws/logs/${channel}`);
    state.sockets[channel] = socket;
    socket.addEventListener("message", (event) => {
        state.logBuffers[channel].push(event.data);
        if (state.logBuffers[channel].length > 600) state.logBuffers[channel].shift();
        if (state.logTab === channel) switchLogTab(channel);
    });
    socket.addEventListener("close", () => setTimeout(() => connectLogSocket(channel), 2500));
}

async function refreshHistory() {
    try {
        const payload = await api("/api/history");
        els.historyList.innerHTML = payload.items.map((item) => `
            <div class="history-item">
                <div class="history-title">${escapeHtml(item.state)}</div>
                <div class="history-meta">${escapeHtml(item.timestamp || "-")} • Exit ${escapeHtml(String(item.exit_code ?? "-"))}</div>
                <div>${escapeHtml(item.message || "")}</div>
            </div>
        `).join("") || `<div class="muted">Noch keine Ereignisse vorhanden.</div>`;
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function downloadEntry(path) {
    window.open(`/api/files/download?path=${encodeURIComponent(path)}`, "_blank");
}

async function extractArchive(path) {
    try {
        await api("/api/files/extract", { method: "POST", body: JSON.stringify({ path, destination: state.currentPath }) });
        await refreshFiles(state.currentPath);
        showToast("ZIP entpackt.");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function downloadSelection(paths) {
    if (!paths.length) return;
    try {
        const response = await fetch("/api/files/download-selection", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths }),
        });
        if (!response.ok) throw new Error((await response.json()).detail || "Download fehlgeschlagen.");
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "selection.zip";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    } catch (error) {
        showToast(error.message, "error");
    }
}

function detectLanguage(path) {
    if (path.endsWith(".py")) return "python";
    if (path.endsWith(".json")) return "json";
    if (path.endsWith(".env")) return "dotenv";
    if (path.endsWith(".md")) return "markdown";
    if (path.endsWith(".yml") || path.endsWith(".yaml")) return "yaml";
    return "text";
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function formatDate(timestamp) {
    if (!timestamp) return "-";
    return dateFormatter.format(new Date(timestamp * 1000));
}

function bindModal() {
    els.modalCancelBtn.addEventListener("click", closeModal);
}

function openModal({ eyebrow, title, description, confirmLabel, firstLabel, firstValue = "", secondLabel = "", secondValue = "" }) {
    els.modalEyebrow.textContent = eyebrow;
    els.modalTitle.textContent = title;
    els.modalDescription.textContent = description || "";
    els.modalFieldOneLabel.textContent = firstLabel;
    els.modalFieldOneInput.value = firstValue;
    els.modalFieldTwoWrap.classList.toggle("hidden", !secondLabel);
    if (secondLabel) {
        els.modalFieldTwoLabel.textContent = secondLabel;
        els.modalFieldTwoInput.value = secondValue;
    }
    els.modalConfirmBtn.textContent = confirmLabel || "Speichern";
    els.modalShell.classList.remove("hidden");
    els.modalFieldOneInput.focus();
    return new Promise((resolve) => {
        const handleSubmit = (event) => {
            event.preventDefault();
            cleanup();
            resolve({ first: els.modalFieldOneInput.value.trim(), second: els.modalFieldTwoInput.value.trim() });
            closeModal();
        };
        const handleCancel = () => {
            cleanup();
            resolve(null);
            closeModal();
        };
        const cleanup = () => {
            els.modalForm.removeEventListener("submit", handleSubmit);
            els.modalCancelBtn.removeEventListener("click", handleCancel);
        };
        els.modalForm.addEventListener("submit", handleSubmit);
        els.modalCancelBtn.addEventListener("click", handleCancel, { once: true });
    });
}

function closeModal() {
    els.modalShell.classList.add("hidden");
}
