const initial = window.__INITIAL_STATE__ || {};
const page = document.body.dataset.page || initial.page || "dashboard";

const state = {
    page,
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
const dateTimeFormatter = new Intl.DateTimeFormat("de-AT", { dateStyle: "medium", timeStyle: "short" });


document.addEventListener("DOMContentLoaded", () => {
    collectBaseElements();
    bindModal();
    bindGlobalBotControls();
    initializePage();
    bindQuickFocus();
    refreshStatus({ silent: true });
    window.setInterval(() => refreshStatus({ silent: true }), 5000);
    if (page === "files") {
        window.addEventListener("beforeunload", (event) => {
            if (!isEditorDirty()) return;
            event.preventDefault();
            event.returnValue = "";
        });
    }
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
        globalActionButtons: queryAll("[data-bot-action]"),
        statusBadges: queryAll('[data-status-field="badge"]'),
        statusStateTexts: queryAll('[data-status-field="state_text"]'),
        statusPidTexts: queryAll('[data-status-field="pid"]'),
        statusUptimeTexts: queryAll('[data-status-field="uptime"]'),
        statusExitTexts: queryAll('[data-status-field="exit"]'),
        statusCommandTexts: queryAll('[data-status-field="command"]'),
        statusErrorTexts: queryAll('[data-status-field="error"]'),
        statusErrorInlineTexts: queryAll('[data-status-field="error_inline"]'),
    });
}

function initializePage() {
    if (page === "dashboard" || page === "activity") {
        bindHistoryAndLogs();
        refreshHistory({ silent: true });
        window.setInterval(() => refreshHistory({ silent: true }), 7000);
    }

    if (page === "files") {
        bindFilesPage();
    }

    if (page === "console") {
        bindTaskPage({ withConsoleForm: true });
    }

    if (page === "startup") {
        bindStartupPage();
        bindTaskPage({ withConsoleForm: false });
    }

    if (page === "settings" || page === "environment") {
        bindEnvironmentPage();
    }
}

function bindQuickFocus() {
    els.quickFocusBtn?.addEventListener("click", () => {
        const focusTarget = getQuickFocusTarget();
        focusTarget?.focus();
    });
}

function getQuickFocusTarget() {
    if (page === "files") return byId("fileSearchInput") || byId("editorTextarea");
    if (page === "console") return byId("consoleInput");
    if (page === "startup") return byId("startCommandInput") || byId("packageInput");
    if (page === "settings" || page === "environment") return document.querySelector(".env-key-input") || byId("addEnvBtn");
    return null;
}

function byId(id) {
    return document.getElementById(id);
}

function queryAll(selector) {
    return [...document.querySelectorAll(selector)];
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
    if (response.status === 204) {
        return null;
    }
    const contentType = response.headers.get("content-type") || "";
    return contentType.includes("application/json") ? response.json() : response.text();
}

async function extractError(response) {
    try {
        const payload = await response.json();
        return payload.detail || payload.message || JSON.stringify(payload);
    } catch {
        const text = await response.text();
        return text || "Unbekannter Fehler";
    }
}

function showToast(message, type = "info") {
    if (!els.toastStack) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type === "error" ? "is-error" : ""}`.trim();
    toast.textContent = message;
    els.toastStack.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4200);
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
    const messages = {
        start: "Bot wurde gestartet.",
        stop: "Bot wurde gestoppt.",
        restart: "Bot wurde neu gestartet.",
    };

    try {
        await api(`/api/bot/${action}`, { method: "POST" });
        await refreshStatus({ silent: true });
        await refreshHistory({ silent: true });
        showToast(messages[action] || "Aktion ausgeführt.");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function refreshStatus({ silent = false } = {}) {
    try {
        const payload = await api("/api/status");
        renderStatus(payload);
    } catch (error) {
        if (!silent) {
            showToast(error.message, "error");
        }
    }
}

function renderStatus(payload) {
    const labelMap = {
        running: { text: "Bot läuft", badge: "Läuft", className: "is-running" },
        stopped: { text: "Bot gestoppt", badge: "Gestoppt", className: "is-stopped" },
        crashed: { text: "Bot abgestürzt", badge: "Abgestürzt", className: "is-crashed" },
    };
    const current = labelMap[payload.state] || { text: "Status unbekannt", badge: "Unbekannt", className: "is-unknown" };

    setText(els.statusStateTexts, current.text);
    setText(els.statusPidTexts, payload.pid ?? "-");
    setText(els.statusUptimeTexts, payload.uptime_human || "-");
    setText(els.statusExitTexts, payload.last_exit_code ?? "-");
    setText(els.statusCommandTexts, payload.last_command || state.settings.start_command || "python bot.py");
    setText(els.statusErrorTexts, payload.last_error || "");
    setText(els.statusErrorInlineTexts, payload.last_error || "Kein Fehler");

    els.statusBadges.forEach((badge) => {
        badge.textContent = current.badge;
        badge.className = `status-badge ${current.className}`;
    });

    if (payload.last_command) {
        state.settings.start_command = payload.last_command;
    }
}

function bindStartupPage() {
    Object.assign(els, {
        startCommandInput: byId("startCommandInput"),
        autoRestartInput: byId("autoRestartInput"),
        useVenvInput: byId("useVenvInput"),
        restartDelayInput: byId("restartDelayInput"),
        saveSettingsBtn: byId("saveSettingsBtn"),
        installDepsBtn: byId("installDepsBtn"),
        packageInput: byId("packageInput"),
        installPackageBtn: byId("installPackageBtn"),
    });

    applySettingsToForm();

    els.saveSettingsBtn?.addEventListener("click", saveSettings);
    els.installDepsBtn?.addEventListener("click", () => startTask("/api/tasks/install-deps", {}));
    els.installPackageBtn?.addEventListener("click", () => {
        const packageName = els.packageInput?.value.trim() || "";
        if (!packageName) {
            showToast("Bitte zuerst einen Paketnamen eingeben.", "error");
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
}

async function saveSettings() {
    try {
        const payload = {
            start_command: els.startCommandInput?.value.trim() || "python bot.py",
            auto_restart: Boolean(els.autoRestartInput?.checked),
            use_virtualenv: Boolean(els.useVenvInput?.checked),
            restart_delay_seconds: Number(els.restartDelayInput?.value || 5),
        };
        state.settings = await api("/api/settings", {
            method: "PUT",
            body: JSON.stringify(payload),
        });
        applySettingsToForm();
        await refreshStatus({ silent: true });
        showToast("Einstellungen gespeichert.");
    } catch (error) {
        showToast(error.message, "error");
    }
}

function bindFilesPage() {
    Object.assign(els, {
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
        editorLanguage: byId("editorLanguage"),
        editorDirtyBadge: byId("editorDirtyBadge"),
        editorTextarea: byId("editorTextarea"),
        editorMeta: byId("editorMeta"),
        reloadFileBtn: byId("reloadFileBtn"),
        saveFileBtn: byId("saveFileBtn"),
    });

    clearEditor();
    refreshFiles("");

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
    els.reloadFileBtn?.addEventListener("click", () => state.currentFile && openFile(state.currentFile));
    els.saveFileBtn?.addEventListener("click", saveCurrentFile);
    els.editorTextarea?.addEventListener("input", renderEditorDirtyState);
    els.editorTextarea?.addEventListener("keydown", handleEditorTabKey);

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
        : `<tr><td colspan="6"><div class="empty-state">Dieser Ordner ist aktuell leer.</div></td></tr>`;

    if (els.selectAllCheckbox) {
        els.selectAllCheckbox.checked = entries.length > 0 && entries.every((entry) => state.selected.has(entry.path));
    }
}

function renderFileRow(entry) {
    const checked = state.selected.has(entry.path) ? "checked" : "";
    const kindLabel = entry.kind === "directory" ? "Ordner" : entry.extension || "Datei";
    const primaryAction = entry.kind === "directory" ? "open" : entry.editable ? "edit" : "download";
    const primaryLabel = entry.kind === "directory" ? "Öffnen" : entry.editable ? "Bearbeiten" : "Herunterladen";
    const actionButtons = [
        `<button class="file-action-link" type="button" data-action="${primaryAction}" data-path="${escapeHtml(entry.path)}">${primaryLabel}</button>`,
        `<button class="file-action-link" type="button" data-action="rename" data-path="${escapeHtml(entry.path)}">Umbenennen</button>`,
        `<button class="file-action-link" type="button" data-action="download" data-path="${escapeHtml(entry.path)}">Download</button>`,
        entry.extractable ? `<button class="file-action-link" type="button" data-action="extract" data-path="${escapeHtml(entry.path)}">Entpacken</button>` : "",
        `<button class="file-action-link" type="button" data-action="delete" data-path="${escapeHtml(entry.path)}">Löschen</button>`,
    ].join("");

    return `
        <tr>
            <td><input type="checkbox" data-path="${escapeHtml(entry.path)}" ${checked} aria-label="${escapeHtml(entry.name)} auswählen"></td>
            <td><button class="file-name-button" type="button" data-action="${primaryAction}" data-path="${escapeHtml(entry.path)}">${escapeHtml(entry.name)}</button></td>
            <td><span class="file-type">${escapeHtml(kindLabel)}</span></td>
            <td>${escapeHtml(entry.size_human || "-")}</td>
            <td>${formatUnixDate(entry.modified_at)}</td>
            <td><div class="file-row-actions">${actionButtons}</div></td>
        </tr>
    `;
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

async function createEntry(kind) {
    const response = await openModal({
        eyebrow: kind === "file" ? "Neue Datei" : "Neuer Ordner",
        title: kind === "file" ? "Datei anlegen" : "Ordner anlegen",
        description: `Wird im Pfad ${state.currentPath || "workspace"} erstellt.`,
        confirmLabel: kind === "file" ? "Datei erstellen" : "Ordner erstellen",
        firstLabel: "Name",
    });

    if (!response) return;
    try {
        await api(kind === "file" ? "/api/files/new-file" : "/api/files/new-folder", {
            method: "POST",
            body: JSON.stringify({ parent_path: state.currentPath, name: response.first }),
        });
        await refreshFiles(state.currentPath);
        showToast(kind === "file" ? "Datei wurde erstellt." : "Ordner wurde erstellt.");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function renameEntry(path) {
    const currentName = path.split("/").pop() || path;
    const response = await openModal({
        eyebrow: "Umbenennen",
        title: "Eintrag umbenennen",
        description: `Aktueller Name: ${currentName}`,
        confirmLabel: "Umbenennen",
        firstLabel: "Neuer Name",
        firstValue: currentName,
    });

    if (!response) return;
    try {
        await api("/api/files/rename", {
            method: "POST",
            body: JSON.stringify({ path, new_name: response.first }),
        });
        await refreshFiles(state.currentPath);
        showToast("Eintrag wurde umbenannt.");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function deleteEntries(paths) {
    if (!paths.length) return;
    const confirmed = window.confirm(`Wirklich ${paths.length} ausgewählte Einträge löschen?`);
    if (!confirmed) return;

    try {
        await api("/api/files", {
            method: "DELETE",
            body: JSON.stringify({ paths }),
        });
        if (state.currentFile && paths.includes(state.currentFile)) {
            clearEditor();
        }
        await refreshFiles(state.currentPath);
        showToast("Auswahl wurde gelöscht.");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function transferSelection(mode) {
    if (!state.selected.size) return;
    const response = await openModal({
        eyebrow: mode === "move" ? "Verschieben" : "Kopieren",
        title: mode === "move" ? "Auswahl verschieben" : "Auswahl kopieren",
        description: "Zielpfad relativ zum Workspace. Leer lassen für das Root-Verzeichnis.",
        confirmLabel: mode === "move" ? "Verschieben" : "Kopieren",
        firstLabel: "Zielordner",
        firstValue: state.currentPath,
    });

    if (!response) return;
    try {
        await api(`/api/files/${mode}`, {
            method: "POST",
            body: JSON.stringify({ sources: [...state.selected], destination: response.first || "" }),
        });
        await refreshFiles(state.currentPath);
        showToast(mode === "move" ? "Auswahl wurde verschoben." : "Auswahl wurde kopiert.");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function handleUpload(fileList, extractArchives) {
    const files = [...(fileList || [])];
    if (!files.length) return;

    const formData = new FormData();
    formData.append("path", state.currentPath);
    formData.append("extract_archives", String(extractArchives));
    files.forEach((file) => formData.append("files", file));

    try {
        await api("/api/files/upload", { method: "POST", body: formData });
        await refreshFiles(state.currentPath);
        showToast(extractArchives ? "ZIP-Dateien wurden hochgeladen und verarbeitet." : "Dateien wurden hochgeladen.");
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

    ["dragleave", "drop"].forEach((eventName) => {
        els.dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            els.dropzone.classList.remove("is-dragover");
        });
    });

    els.dropzone.addEventListener("drop", (event) => {
        const files = [...(event.dataTransfer?.files || [])];
        if (!files.length) return;
        const containsZip = files.some((file) => file.name.toLowerCase().endsWith(".zip"));
        const extractArchives = containsZip ? window.confirm("Sollen ZIP-Dateien direkt nach dem Upload entpackt werden?") : false;
        handleUpload(files, extractArchives);
    });
}

async function openFile(path) {
    if (isEditorDirty() && !window.confirm("Ungespeicherte Änderungen verwerfen?")) {
        return;
    }

    try {
        const payload = await api(`/api/files/content?path=${encodeURIComponent(path)}`);
        state.currentFile = payload.path;
        state.originalContent = payload.content;
        if (els.editorTextarea) els.editorTextarea.value = payload.content;
        if (els.editorTitle) els.editorTitle.textContent = payload.name;
        if (els.editorLanguage) els.editorLanguage.textContent = detectLanguage(payload.path);
        if (els.editorMeta) els.editorMeta.textContent = `${payload.path} • ${payload.content.length} Zeichen`;
        if (els.reloadFileBtn) els.reloadFileBtn.disabled = false;
        if (els.saveFileBtn) els.saveFileBtn.disabled = false;
        renderEditorDirtyState();
    } catch (error) {
        showToast(error.message, "error");
    }
}

function handleEditorTabKey(event) {
    if (event.key !== "Tab" || !els.editorTextarea) return;
    event.preventDefault();
    const start = els.editorTextarea.selectionStart;
    const end = els.editorTextarea.selectionEnd;
    const value = els.editorTextarea.value;
    els.editorTextarea.value = `${value.slice(0, start)}    ${value.slice(end)}`;
    els.editorTextarea.selectionStart = els.editorTextarea.selectionEnd = start + 4;
    renderEditorDirtyState();
}

function isEditorDirty() {
    return Boolean(state.currentFile && els.editorTextarea && els.editorTextarea.value !== state.originalContent);
}

function renderEditorDirtyState() {
    if (!els.editorDirtyBadge) return;
    const dirty = isEditorDirty();
    els.editorDirtyBadge.textContent = dirty ? "Ungespeichert" : "Gespeichert";
    els.editorDirtyBadge.dataset.dirty = dirty ? "true" : "false";
    if (els.editorMeta && state.currentFile && els.editorTextarea) {
        els.editorMeta.textContent = `${state.currentFile} • ${els.editorTextarea.value.length} Zeichen`;
    }
}

async function saveCurrentFile() {
    if (!state.currentFile || !els.editorTextarea) return;
    try {
        await api("/api/files/content", {
            method: "PUT",
            body: JSON.stringify({ path: state.currentFile, content: els.editorTextarea.value }),
        });
        state.originalContent = els.editorTextarea.value;
        renderEditorDirtyState();
        await refreshFiles(state.currentPath);
        showToast("Datei wurde gespeichert.");
    } catch (error) {
        showToast(error.message, "error");
    }
}

function clearEditor() {
    if (els.editorTextarea) els.editorTextarea.value = "";
    if (els.editorTitle) els.editorTitle.textContent = "Keine Datei geöffnet";
    if (els.editorLanguage) els.editorLanguage.textContent = "Text";
    if (els.editorMeta) els.editorMeta.textContent = "Noch keine Datei geladen.";
    if (els.reloadFileBtn) els.reloadFileBtn.disabled = true;
    if (els.saveFileBtn) els.saveFileBtn.disabled = true;
    state.currentFile = null;
    state.originalContent = "";
    renderEditorDirtyState();
}

async function downloadEntry(path) {
    window.open(`/api/files/download?path=${encodeURIComponent(path)}`, "_blank", "noopener");
}

async function extractArchive(path) {
    try {
        await api("/api/files/extract", {
            method: "POST",
            body: JSON.stringify({ path, destination: state.currentPath }),
        });
        await refreshFiles(state.currentPath);
        showToast("Archiv wurde entpackt.");
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
        if (!response.ok) {
            throw new Error(await extractError(response));
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "auswahl.zip";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
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
        els.envList.innerHTML = `<div class="empty-state">Noch keine Variablen angelegt.</div>`;
        return;
    }

    els.envList.innerHTML = state.envEntries
        .map((entry, index) => `
            <div class="env-item" data-index="${index}">
                <div class="env-row">
                    <label class="field-block">
                        <span>Schlüssel</span>
                        <input data-field="key" type="text" value="${escapeHtml(entry.key || "")}" placeholder="DISCORD_TOKEN">
                    </label>
                    <label class="field-block">
                        <span>Wert</span>
                        <input data-field="value" type="${entry.masked ? "password" : "text"}" value="${escapeHtml(entry.value || "")}" placeholder="Wert eingeben">
                    </label>
                    <button class="secondary-button" type="button" data-action="toggle-mask">${entry.masked ? "Anzeigen" : "Maskieren"}</button>
                    <button class="danger-button" type="button" data-action="remove">Löschen</button>
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
        showToast(".env wurde gespeichert.");
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
            if (!command) return;
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
        showToast(`Task gestartet: ${task.title}`);
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function refreshTasks({ silent = false } = {}) {
    if (!els.taskList || !els.taskOutput) return;
    try {
        const payload = await api("/api/tasks");
        state.tasks = payload.items || [];
        if (!state.activeTaskId && state.tasks[0]) {
            state.activeTaskId = state.tasks[0].task_id;
        }
        renderTasks();
        await refreshActiveTask({ silent: true });
    } catch (error) {
        if (!silent) {
            showToast(error.message, "error");
        }
    }
}

function renderTasks() {
    if (!els.taskList) return;
    if (!state.tasks.length) {
        els.taskList.innerHTML = `<div class="empty-state">Bisher wurden noch keine Tasks ausgeführt.</div>`;
        return;
    }

    els.taskList.innerHTML = state.tasks
        .map((task) => `
            <button class="task-item ${state.activeTaskId === task.task_id ? "is-active" : ""}" type="button" data-task-id="${task.task_id}">
                <div class="task-title">${escapeHtml(task.title)}</div>
                <div class="task-meta">${escapeHtml(renderTaskStatus(task.status))} • ${escapeHtml(task.duration || "-")}</div>
            </button>
        `)
        .join("");
}

async function refreshActiveTask({ silent = false } = {}) {
    if (!els.taskOutput) return;
    if (!state.activeTaskId) {
        els.taskOutput.textContent = "Noch kein Task ausgewählt.";
        return;
    }

    try {
        const payload = await api(`/api/tasks/${state.activeTaskId}`);
        els.taskOutput.textContent = payload.output || "Noch keine Ausgabe vorhanden.";
        const index = state.tasks.findIndex((task) => task.task_id === payload.task_id);
        if (index >= 0) {
            state.tasks[index] = { ...state.tasks[index], ...payload };
            renderTasks();
        }
    } catch (error) {
        if (!silent) {
            showToast(error.message, "error");
        }
    }
}
function bindHistoryAndLogs() {
    Object.assign(els, {
        historyList: byId("historyList"),
        logOutput: byId("logOutput"),
        dashboardLogPreview: byId("dashboardLogPreview"),
        logTabs: queryAll(".tab-button[data-log-tab]"),
        downloadLogsLink: byId("downloadLogsLink"),
    });

    els.logTabs.forEach((button) => {
        button.addEventListener("click", () => switchLogTab(button.dataset.logTab));
    });

    connectLogSocket("bot");
    connectLogSocket("system");
    renderLogSurfaces();
}

function switchLogTab(tab) {
    state.logTab = tab;
    els.logTabs.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.logTab === tab);
    });
    if (els.downloadLogsLink) {
        els.downloadLogsLink.href = `/api/logs/${tab}/download`;
    }
    renderLogSurfaces();
}

function connectLogSocket(channel) {
    if (state.sockets[channel]) return;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws/logs/${channel}`);
    state.sockets[channel] = socket;

    socket.addEventListener("message", (event) => {
        state.logBuffers[channel].push(event.data);
        if (state.logBuffers[channel].length > 700) {
            state.logBuffers[channel].shift();
        }
        renderLogSurfaces();
    });

    socket.addEventListener("close", () => {
        state.sockets[channel] = null;
        window.setTimeout(() => connectLogSocket(channel), 2500);
    });
}

function renderLogSurfaces() {
    if (els.logOutput) {
        els.logOutput.textContent = state.logBuffers[state.logTab].join("\n") || "Warte auf Log-Ausgabe …";
        els.logOutput.scrollTop = els.logOutput.scrollHeight;
    }
    if (els.dashboardLogPreview) {
        const preview = state.logBuffers.bot.slice(-28).join("\n");
        els.dashboardLogPreview.textContent = preview || "Warte auf Bot-Logs …";
        els.dashboardLogPreview.scrollTop = els.dashboardLogPreview.scrollHeight;
    }
}

async function refreshHistory({ silent = false } = {}) {
    if (!els.historyList) return;
    try {
        const payload = await api("/api/history");
        renderHistory(payload.items || []);
    } catch (error) {
        if (!silent) {
            showToast(error.message, "error");
        }
    }
}

function renderHistory(items) {
    if (!els.historyList) return;
    if (!items.length) {
        els.historyList.innerHTML = `<div class="empty-state">Noch keine Prozessereignisse vorhanden.</div>`;
        return;
    }

    els.historyList.innerHTML = items
        .map((item) => `
            <article class="history-item">
                <div class="history-title">${escapeHtml(renderProcessState(item.state))}</div>
                <div class="history-meta">${escapeHtml(formatIsoDate(item.timestamp))} • Exit-Code: ${escapeHtml(String(item.exit_code ?? "-"))}</div>
                <p>${escapeHtml(item.message || "")}</p>
            </article>
        `)
        .join("");
}

function bindModal() {
    if (!els.modalShell || !els.modalForm) return;
    [els.modalCancelBtn, els.modalSecondaryBtn].forEach((button) => {
        button?.addEventListener("click", closeModal);
    });
}

function openModal({
    eyebrow = "Aktion",
    title = "Dialog",
    description = "",
    confirmLabel = "Speichern",
    firstLabel = "Wert",
    firstValue = "",
    secondLabel = "",
    secondValue = "",
}) {
    if (!els.modalShell || !els.modalForm) return Promise.resolve(null);

    els.modalEyebrow.textContent = eyebrow;
    els.modalTitle.textContent = title;
    els.modalDescription.textContent = description;
    els.modalFieldOneLabel.textContent = firstLabel;
    els.modalFieldOneInput.value = firstValue;
    els.modalFieldTwoWrap.classList.toggle("hidden", !secondLabel);
    els.modalFieldTwoLabel.textContent = secondLabel || "Wert";
    els.modalFieldTwoInput.value = secondValue;
    els.modalConfirmBtn.textContent = confirmLabel;
    els.modalShell.classList.remove("hidden");
    els.modalFieldOneInput.focus();

    return new Promise((resolve) => {
        const handleSubmit = (event) => {
            event.preventDefault();
            cleanup();
            closeModal();
            resolve({
                first: els.modalFieldOneInput.value.trim(),
                second: els.modalFieldTwoInput.value.trim(),
            });
        };

        const handleCancel = () => {
            cleanup();
            closeModal();
            resolve(null);
        };

        const handleEscape = (event) => {
            if (event.key === "Escape") {
                handleCancel();
            }
        };

        const cleanup = () => {
            els.modalForm.removeEventListener("submit", handleSubmit);
            document.removeEventListener("keydown", handleEscape);
            [els.modalCancelBtn, els.modalSecondaryBtn].forEach((button) => {
                button?.removeEventListener("click", handleCancel);
            });
        };

        els.modalForm.addEventListener("submit", handleSubmit);
        document.addEventListener("keydown", handleEscape);
        [els.modalCancelBtn, els.modalSecondaryBtn].forEach((button) => {
            button?.addEventListener("click", handleCancel, { once: true });
        });
    });
}

function closeModal() {
    els.modalShell?.classList.add("hidden");
}

function renderTaskStatus(status) {
    const labels = {
        pending: "Wartet",
        running: "Läuft",
        success: "Erfolgreich",
        failed: "Fehlgeschlagen",
    };
    return labels[status] || status || "Unbekannt";
}

function renderProcessState(status) {
    const labels = {
        running: "Gestartet",
        stopped: "Gestoppt",
        crashed: "Abgestürzt",
    };
    return labels[status] || status || "Unbekannt";
}

function detectLanguage(path) {
    if (path.endsWith(".py")) return "Python";
    if (path.endsWith(".json")) return "JSON";
    if (path.endsWith(".env")) return "dotenv";
    if (path.endsWith(".md")) return "Markdown";
    if (path.endsWith(".yml") || path.endsWith(".yaml")) return "YAML";
    if (path.endsWith(".toml")) return "TOML";
    return "Text";
}

function formatUnixDate(value) {
    if (!value) return "-";
    return dateTimeFormatter.format(new Date(value * 1000));
}

function formatIsoDate(value) {
    if (!value) return "-";
    return dateTimeFormatter.format(new Date(value));
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}