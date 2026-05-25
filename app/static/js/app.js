const initial = window.__INITIAL_STATE__ || {};
const page = document.body.dataset.page || initial.page || "dashboard";

const state = {
    page,
    locale: initial.locale || "en",
    translations: initial.translations || {},
    settings: initial.settings || {},
    panelMeta: initial.panelMeta || {},
    gitDeploy: initial.gitDeploy || {},
    backupRetention: initial.backupRetention || { enabled: true, mode: "30d", custom_days: 30 },
    appUpdate: {},
    gitPreview: null,
    servers: initial.servers || [],
    activeServerId: initial.activeServerId || "default",
    envEntries: initial.envEntries || [],
    currentPath: "",
    entries: [],
    selected: new Set(),
    currentFile: null,
    originalContent: "",
    activeTaskId: null,
    activeTaskOutput: "",
    consoleFilter: "all",
    currentDatabaseValue: "",
    isCreatingServer: false,
    tasks: [],
    logTab: "bot",
    logBuffers: { bot: [], system: [] },
    sockets: {},
    backups: [],
    schedules: [],
    metrics: {},
    status: null,
    databases: [],
    activeDatabase: null,
    databaseInspect: null,
    activeDbTable: "",
    databaseRows: null,
};

const els = {};
const dateTimeFormatter = new Intl.DateTimeFormat(state.locale === "de" ? "de-AT" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
});
const normalTourSteps = [
    { page: "home", url: "/", selector: ".home-hero", textKey: "tour.step_home", titleKey: "tour.title_home" },
    { page: "dashboard", url: "/dashboard", selector: ".hero-banner", textKey: "tour.step_dashboard", titleKey: "tour.title_dashboard" },
    { page: "console", url: "/console", selector: "#consoleForm", textKey: "tour.step_console", titleKey: "tour.title_console" },
    { page: "files", url: "/files", selector: "#fileBrowserView", textKey: "tour.step_files", titleKey: "tour.title_files" },
    { page: "settings", url: "/settings", selector: ".page-shell", textKey: "tour.step_settings", titleKey: "tour.title_settings" },
    { page: "startup", url: "/startup", selector: ".page-shell", textKey: "tour.step_startup", titleKey: "tour.title_startup" },
    { page: "activity", url: "/activity", selector: "#logOutput", textKey: "tour.step_activity", titleKey: "tour.title_activity" },
    { page: "dashboard", url: "/dashboard", selector: ".nav-groups", textKey: "tour.step_management", titleKey: "tour.title_management" },
];
const detailedTourSteps = [
    { page: "home", url: "/", selector: ".home-create-card", textKey: "tour.detail_home_create", titleKey: "tour.title_home" },
    { page: "home", url: "/", selector: ".server-grid-home", textKey: "tour.detail_home_open_delete", titleKey: "tour.title_home" },
    { page: "dashboard", url: "/dashboard", selector: ".server-block", textKey: "tour.detail_sidebar_controls", titleKey: "tour.title_sidebar" },
    { page: "dashboard", url: "/dashboard", selector: ".hero-banner", textKey: "tour.detail_dashboard_metrics", titleKey: "tour.title_dashboard" },
    { page: "console", url: "/console", selector: "#consoleForm", textKey: "tour.detail_console_commands", titleKey: "tour.title_console" },
    { page: "console", url: "/console", selector: "#taskList", textKey: "tour.detail_console_tasks", titleKey: "tour.title_console" },
    { page: "files", url: "/files", selector: "#fileBrowserView", textKey: "tour.detail_files_select", titleKey: "tour.title_files" },
    { page: "files", url: "/files", selector: "#fileBrowserView", textKey: "tour.detail_files_upload", titleKey: "tour.title_files" },
    { page: "files", url: "/files", selector: "#fileBrowserView", textKey: "tour.detail_files_actions", titleKey: "tour.title_files" },
    { page: "settings", url: "/settings", selector: ".page-shell", textKey: "tour.detail_settings_meta", titleKey: "tour.title_settings" },
    { page: "activity", url: "/activity", selector: "#logOutput", textKey: "tour.detail_activity_logs", titleKey: "tour.title_activity" },
    { page: "startup", url: "/startup", selector: "#startCommandInput", textKey: "tour.detail_startup_command", titleKey: "tour.title_startup" },
    { page: "startup", url: "/startup", selector: ".page-shell", textKey: "tour.detail_startup_runtime", titleKey: "tour.title_startup" },
    { page: "startup", url: "/startup", selector: "#envList", textKey: "tour.detail_startup_env", titleKey: "tour.title_startup" },
    { page: "startup", url: "/startup", selector: ".page-shell", textKey: "tour.detail_startup_packages", titleKey: "tour.title_startup" },
    { page: "backups", url: "/backups", selector: ".page-shell", textKey: "tour.detail_backups", titleKey: "tour.title_backups" },
    { page: "network", url: "/network", selector: ".page-shell", textKey: "tour.detail_network", titleKey: "tour.title_network" },
    { page: "schedules", url: "/schedules", selector: ".page-shell", textKey: "tour.detail_schedules", titleKey: "tour.title_schedules" },
    { page: "users", url: "/users", selector: ".page-shell", textKey: "tour.detail_users", titleKey: "tour.title_users" },
];
const tourStorageKey = "katabot.panelTour.seen.v3";
const tourStateKey = "katabot.tourActive";
let tourIndex = 0;
let activeTourSteps = normalTourSteps;

document.addEventListener("DOMContentLoaded", () => {
    collectBaseElements();
    localizeModalDefaults();
    bindModal();
    bindAccountMenu();
    bindTour();
    bindGlobalBotControls();
    bindAuthWarningDismiss();
    initializePage();
    bindQuickFocus();
    refreshStatus({ silent: true });
    refreshMetrics({ silent: true });
    refreshAppUpdate({ silent: true });
    window.setInterval(() => refreshStatus({ silent: true }), 5000);
    window.setInterval(() => refreshMetrics({ silent: true }), 10000);
    window.setInterval(() => refreshAppUpdate({ silent: true }), 60 * 60 * 1000);
});

function bindAuthWarningDismiss() {
    const button = byId("dismissAuthWarningBtn");
    const banner = byId("authWarningBanner");
    if (!button || !banner) return;
    button.addEventListener("click", () => {
        banner.classList.add("hidden");
        try {
            window.localStorage?.setItem("katabot.authWarning.dismissed", String(Date.now()));
        } catch {
            // ignore storage failures
        }
    });
    try {
        const stamp = Number(window.localStorage?.getItem("katabot.authWarning.dismissed") || 0);
        if (stamp && Date.now() - stamp < 1000 * 60 * 60 * 24) {
            banner.classList.add("hidden");
        }
    } catch {
        // ignore storage failures
    }
}

function bindAccountMenu() {
    els.accountMoreBtn?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        els.accountMenu?.classList.toggle("hidden");
    });
    els.deleteActiveServerBtn?.addEventListener("click", () => deleteServer(state.activeServerId, state.panelMeta.display_name));
    document.addEventListener("click", (event) => {
        if (!els.accountMenu || els.accountMenu.classList.contains("hidden")) return;
        if (!event.target.closest(".account-menu-wrap")) els.accountMenu.classList.add("hidden");
    });
}

async function deleteServer(serverId, serverName) {
    if (!serverId) return;
    if (!window.confirm(tr("error.delete_server_confirm", { name: serverName || serverId }))) return;
    try {
        const payload = await api(`/api/servers/${encodeURIComponent(serverId)}`, { method: "DELETE" });
        showToastKey("toast.server_deleted");
        window.location.href = payload.active_server_id ? `/?server_id=${encodeURIComponent(payload.active_server_id)}` : "/";
    } catch (error) {
        showToast(error.message, "error");
    }
}

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
        tourModePicker: byId("tourModePicker"),
        tourSkipBtn: byId("tourSkipBtn"),
        spotlightHighlight: byId("spotlightHighlight"),
        spotlightConnector: byId("spotlightConnector"),
        spotlightTooltip: byId("spotlightTooltip"),
        spotlightEyebrow: byId("spotlightEyebrow"),
        spotlightTitle: byId("spotlightTitle"),
        spotlightText: byId("spotlightText"),
        spotlightProgress: byId("spotlightProgress"),
        spotlightCounter: byId("spotlightCounter"),
        spotlightNextBtn: byId("spotlightNextBtn"),
        spotlightSkipBtn: byId("spotlightSkipBtn"),
        accountMoreBtn: byId("accountMoreBtn"),
        accountMenu: byId("accountMenu"),
        deleteActiveServerBtn: byId("deleteActiveServerBtn"),
        globalActionButtons: queryAll("[data-bot-action]"),
        serverAvatar: queryAll(".server-avatar"),
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
    if (page === "databases") bindDatabasesPage();
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
    if (page === "databases") return byId("databaseSearchInput");
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
        serverGitRepoInput: byId("serverGitRepoInput"),
        serverGitBranchInput: byId("serverGitBranchInput"),
        createServerBtn: byId("createServerBtn"),
    });

    els.createServerForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (state.isCreatingServer) return;
        const displayName = (els.serverNameInput?.value || "").trim();
        if (!displayName) {
            showToastKey("home.name_required", {}, "error");
            els.serverNameInput?.focus();
            return;
        }

        setCreateServerLoading(true);
        try {
            const payload = await api("/api/servers", {
                method: "POST",
                body: JSON.stringify({
                    display_name: displayName,
                    description: (els.serverDescriptionInput?.value || "").trim(),
                    git_repo_url: (els.serverGitRepoInput?.value || "").trim(),
                    git_branch: (els.serverGitBranchInput?.value || "main").trim(),
                    git_import_now: true,
                }),
            });
            showToastKey("toast.server_created");
            const targetUrl = "/dashboard";
            if (payload.git_error) {
                openModal({
                    eyebrow: tr("workspace_report.eyebrow"),
                    title: tr("workspace_report.import_failed"),
                    description: payload.git_error,
                    hideFields: true,
                    confirmText: tr("workspace_report.confirm"),
                    cancelText: tr("common.close"),
                    onConfirm: () => true,
                    onClose: () => {
                        window.location.href = targetUrl;
                    },
                });
                return;
            }
            if (shouldShowWorkspaceReport(payload.git_deploy?.workspace_report)) {
                showWorkspaceReportModal(payload.git_deploy.workspace_report, {
                    title: tr("workspace_report.import_done"),
                    onClose: () => {
                        window.location.href = targetUrl;
                    },
                });
                return;
            }
            window.location.href = targetUrl;
        } catch (error) {
            showToast(error.message, "error");
            setCreateServerLoading(false);
        }
    });

    queryAll(".server-delete-btn").forEach((button) => {
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await deleteServer(button.dataset.serverId, button.dataset.serverName);
        });
    });
}

function setCreateServerLoading(isLoading) {
    state.isCreatingServer = isLoading;
    if (els.createServerBtn) {
        els.createServerBtn.disabled = isLoading;
        els.createServerBtn.classList.toggle("is-loading", isLoading);
        const label = els.createServerBtn.querySelector(".btn-label");
        if (label) label.textContent = isLoading ? tr("home.creating") : tr("home.create");
    }
    els.serverNameInput?.toggleAttribute("disabled", isLoading);
    els.serverDescriptionInput?.toggleAttribute("disabled", isLoading);
    els.serverGitRepoInput?.toggleAttribute("disabled", isLoading);
    els.serverGitBranchInput?.toggleAttribute("disabled", isLoading);
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

    const target = withServerParam(path);
    if (state.activeServerId) headers["X-Server-Id"] = state.activeServerId;
    const response = await fetch(target, { ...options, headers });
    if (!response.ok) {
        throw new Error(await extractError(response));
    }
    if (response.status === 204) return null;
    const contentType = response.headers.get("content-type") || "";
    return contentType.includes("application/json") ? response.json() : response.text();
}

function withServerParam(path) {
    if (!path.startsWith("/api/") || path.startsWith("/api/servers")) return path;
    const [base, hash = ""] = path.split("#");
    const [pathname, query = ""] = base.split("?");
    const params = new URLSearchParams(query);
    if (state.activeServerId) params.set("server_id", state.activeServerId);
    const nextQuery = params.toString();
    return `${pathname}${nextQuery ? `?${nextQuery}` : ""}${hash ? `#${hash}` : ""}`;
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

    // Set immediate loading states in UI
    if (action === "start" || action === "restart") {
        els.serverAvatar?.forEach((el) => {
            el.className = "server-avatar is-starting";
        });
        const startBtn = document.querySelector(".action-start");
        if (startBtn) {
            startBtn.classList.remove("is-running");
            startBtn.classList.add("is-starting");
        }
    } else if (action === "stop") {
        els.serverAvatar?.forEach((el) => {
            el.className = "server-avatar is-stopping";
        });
    }

    try {
        await api(`/api/bot/${action}`, { method: "POST" });
        await refreshStatus({ silent: true });
        if (els.taskList && els.taskOutput) {
            state.activeTaskId = null;
            await refreshTasks({ silent: true });
        }
        if (page === "dashboard" || page === "activity") {
            await refreshHistory({ silent: true });
        }
        showToastKey(messageKey || "toast.bot_started");
    } catch (error) {
        showToast(error.message, "error");
        await refreshStatus({ silent: true });
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

    // Update server-avatar class based on state
    els.serverAvatar?.forEach((el) => {
        el.className = `server-avatar is-${payload.state}`;
    });

    // Update action-start button class based on state
    const startBtn = document.querySelector(".action-start");
    if (startBtn) {
        startBtn.classList.remove("is-starting");
        if (payload.state === "running") {
            startBtn.classList.add("is-running");
        } else {
            startBtn.classList.remove("is-running");
        }
    }
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
    setText(els.metricCpuPrimary, `${formatPercent(payload.bot_cpu_percent, 2)}%`);
    setText(els.metricCpuSecondary, tr(`status.${currentState}`));
    setText(els.metricMemoryPrimary, payload.bot_memory_used_human || tr("common.none"));
    setText(els.metricMemorySecondary, payload.memory_total_bytes ? `${tr("dashboard.host_memory")}: ${formatUsage(payload.memory_used_human, payload.memory_total_human)}` : tr("common.none"));
    setText(els.metricDiskPrimary, payload.workspace_used_human || tr("common.none"));
    setText(els.metricDiskSecondary, `${tr("dashboard.host_disk")}: ${formatUsage(payload.disk_used_human, payload.disk_total_human)}`);
}

function formatPercent(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return (0).toFixed(digits);
    return number.toFixed(digits);
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
        checkAppUpdateBtn: byId("checkAppUpdateBtn"),
        appUpdateImage: byId("appUpdateImage"),
        appUpdateCurrentTag: byId("appUpdateCurrentTag"),
        appUpdateLatestTag: byId("appUpdateLatestTag"),
        appUpdateMessage: byId("appUpdateMessage"),
        appUpdateReleaseWrap: byId("appUpdateReleaseWrap"),
        appUpdateReleaseNotes: byId("appUpdateReleaseNotes"),
        appUpdateReleaseLink: byId("appUpdateReleaseLink"),
        gitRepoInput: byId("gitRepoInput"),
        gitBranchInput: byId("gitBranchInput"),
        gitAutoUpdateInput: byId("gitAutoUpdateInput"),
        gitInstallDepsInput: byId("gitInstallDepsInput"),
        gitRestartInput: byId("gitRestartInput"),
        gitKeepUserDataInput: byId("gitKeepUserDataInput"),
        gitProtectedSection: byId("gitProtectedSection"),
        gitProtectedList: byId("gitProtectedList"),
        gitProtectedEmpty: byId("gitProtectedEmpty"),
        refreshProtectedBtn: byId("refreshProtectedBtn"),
        gitExtraPatternSection: byId("gitExtraPatternSection"),
        gitExtraPatternInput: byId("gitExtraPatternInput"),
        addExtraPatternBtn: byId("addExtraPatternBtn"),
        gitExtraPatternList: byId("gitExtraPatternList"),
        gitStatusText: byId("gitStatusText"),
        gitLocalCommitText: byId("gitLocalCommitText"),
        gitRemoteCommitText: byId("gitRemoteCommitText"),
        gitMessageText: byId("gitMessageText"),
        saveGitBtn: byId("saveGitBtn"),
        checkGitBtn: byId("checkGitBtn"),
        importGitBtn: byId("importGitBtn"),
        updateGitBtn: byId("updateGitBtn"),
        previewGitBtn: byId("previewGitBtn"),
        gitPreviewBox: byId("gitPreviewBox"),
        gitPreviewMessage: byId("gitPreviewMessage"),
        gitPreviewGrid: byId("gitPreviewGrid"),
        gitHistoryBody: byId("gitHistoryBody"),
    });
    els.savePanelBtn?.addEventListener("click", savePanelMeta);
    els.checkAppUpdateBtn?.addEventListener("click", () => refreshAppUpdate({ silent: false }));
    bindGitDeployButtons();
    applyGitDeployToForm();
    refreshAppUpdate({ silent: true });
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
        state.servers = state.servers.map((server) => (
            server.server_id === state.activeServerId
                ? { ...server, display_name: payload.display_name, description: payload.description }
                : server
        ));
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

async function refreshAppUpdate({ silent = false } = {}) {
    try {
        const payload = await api("/api/app-update");
        state.appUpdate = payload;
        if (els.appUpdateImage) els.appUpdateImage.textContent = payload.image || "-";
        if (els.appUpdateCurrentTag) els.appUpdateCurrentTag.textContent = payload.current_tag || "-";
        if (els.appUpdateLatestTag) els.appUpdateLatestTag.textContent = payload.latest_tag || (payload.current_tag || "-");
        if (els.appUpdateMessage) els.appUpdateMessage.textContent = payload.message || tr("common.none");
        if (els.appUpdateReleaseWrap && els.appUpdateReleaseNotes && els.appUpdateReleaseLink) {
            const hasNotes = Boolean(payload.latest_release_notes || payload.latest_release_url);
            els.appUpdateReleaseWrap.classList.toggle("hidden", !hasNotes);
            els.appUpdateReleaseNotes.textContent = payload.latest_release_notes || "";
            if (payload.latest_release_url) {
                els.appUpdateReleaseLink.href = payload.latest_release_url;
                els.appUpdateReleaseLink.classList.remove("hidden");
            } else {
                els.appUpdateReleaseLink.classList.add("hidden");
            }
        }
        applyTopbarUpdateIndicator(payload);
        if (!silent) showToast(payload.update_available ? tr("app_update.available") : tr("app_update.current"));
    } catch (error) {
        if (!silent) showToast(error.message, "error");
    }
}

function applyTopbarUpdateIndicator(payload) {
    const banner = byId("topbarUpdateIndicator");
    const link = byId("topbarUpdateLink");
    if (!banner || !link) return;
    if (payload && payload.update_available) {
        link.textContent = tr("app_update.banner", { version: payload.latest_tag || "" });
        if (payload.latest_release_url) link.href = payload.latest_release_url;
        banner.classList.remove("hidden");
    } else {
        banner.classList.add("hidden");
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
        retentionEnabledInput: byId("retentionEnabledInput"),
        retentionModeInput: byId("retentionModeInput"),
        retentionCustomInput: byId("retentionCustomInput"),
        retentionCustomField: byId("retentionCustomField"),
        saveRetentionBtn: byId("saveRetentionBtn"),
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
            window.open(withServerParam(`/api/backups/${encodeURIComponent(name)}/download`), "_blank", "noopener");
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

    applyRetentionToForm();
    els.retentionModeInput?.addEventListener("change", updateRetentionCustomVisibility);
    els.saveRetentionBtn?.addEventListener("click", saveBackupRetention);

    refreshBackups();
}

function applyRetentionToForm() {
    const payload = state.backupRetention || { enabled: true, mode: "30d", custom_days: 30 };
    if (els.retentionEnabledInput) els.retentionEnabledInput.checked = payload.enabled !== false;
    if (els.retentionModeInput) els.retentionModeInput.value = payload.mode || "30d";
    if (els.retentionCustomInput) els.retentionCustomInput.value = String(payload.custom_days || 30);
    updateRetentionCustomVisibility();
}

function updateRetentionCustomVisibility() {
    if (!els.retentionCustomField) return;
    const isCustom = (els.retentionModeInput?.value || "30d") === "custom";
    els.retentionCustomField.classList.toggle("hidden", !isCustom);
}

async function saveBackupRetention() {
    try {
        const payload = await api("/api/backups/retention", {
            method: "PUT",
            body: JSON.stringify({
                enabled: Boolean(els.retentionEnabledInput?.checked),
                mode: els.retentionModeInput?.value || "30d",
                custom_days: Number(els.retentionCustomInput?.value || 30),
            }),
        });
        state.backupRetention = payload;
        applyRetentionToForm();
        showToastKey("backups.retention_saved");
        await refreshBackups();
    } catch (error) {
        showToast(error.message, "error");
    }
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
    Object.assign(els, {
        consoleFilterButtons: queryAll("[data-console-filter]"),
    });
    els.consoleFilterButtons?.forEach((button) => {
        button.addEventListener("click", () => {
            state.consoleFilter = button.dataset.consoleFilter || "all";
            updateConsoleFilterButtons();
            renderTaskOutput();
        });
    });
    updateConsoleFilterButtons();
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
        gitRepoInput: byId("gitRepoInput"),
        gitBranchInput: byId("gitBranchInput"),
        gitAutoUpdateInput: byId("gitAutoUpdateInput"),
        gitInstallDepsInput: byId("gitInstallDepsInput"),
        gitRestartInput: byId("gitRestartInput"),
        gitKeepUserDataInput: byId("gitKeepUserDataInput"),
        gitProtectedSection: byId("gitProtectedSection"),
        gitProtectedList: byId("gitProtectedList"),
        gitProtectedEmpty: byId("gitProtectedEmpty"),
        refreshProtectedBtn: byId("refreshProtectedBtn"),
        gitExtraPatternSection: byId("gitExtraPatternSection"),
        gitExtraPatternInput: byId("gitExtraPatternInput"),
        addExtraPatternBtn: byId("addExtraPatternBtn"),
        gitExtraPatternList: byId("gitExtraPatternList"),
        gitStatusText: byId("gitStatusText"),
        gitLocalCommitText: byId("gitLocalCommitText"),
        gitRemoteCommitText: byId("gitRemoteCommitText"),
        gitMessageText: byId("gitMessageText"),
        saveGitBtn: byId("saveGitBtn"),
        checkGitBtn: byId("checkGitBtn"),
        importGitBtn: byId("importGitBtn"),
        updateGitBtn: byId("updateGitBtn"),
        previewGitBtn: byId("previewGitBtn"),
        gitPreviewBox: byId("gitPreviewBox"),
        gitPreviewMessage: byId("gitPreviewMessage"),
        gitPreviewGrid: byId("gitPreviewGrid"),
        gitHistoryBody: byId("gitHistoryBody"),
    });

    applySettingsToForm();
    applyGitDeployToForm();
    bindEnvironmentPage();
    bindTaskPage({ withConsoleForm: false });

    els.saveSettingsBtn?.addEventListener("click", saveSettings);
    els.refreshStartupBtn?.addEventListener("click", refreshStartupPage);
    els.installDepsBtn?.addEventListener("click", () => startTask("/api/tasks/install-deps", {}));
    bindGitDeployButtons();
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

function bindGitDeployButtons() {
    els.saveGitBtn?.addEventListener("click", () => saveGitDeploy({ silent: false }));
    els.checkGitBtn?.addEventListener("click", async () => {
        if (!(await saveGitDeploy({ silent: true }))) return;
        await runGitAction("/api/git-deploy/check", "toast.git_checked");
    });
    els.importGitBtn?.addEventListener("click", async () => {
        if (!(await saveGitDeploy({ silent: true }))) return;
        if (!window.confirm(tr("git.import_confirm"))) return;
        await runGitAction("/api/git-deploy/import", "toast.git_imported");
        await refreshFilesIfVisible();
    });
    els.updateGitBtn?.addEventListener("click", async () => {
        if (!(await saveGitDeploy({ silent: true }))) return;
        if (!window.confirm(tr("git.update_confirm"))) return;
        await runGitAction("/api/git-deploy/update", "toast.git_updated");
        await refreshFilesIfVisible();
    });
    els.refreshProtectedBtn?.addEventListener("click", () => refreshGitDeploy({ silent: false }));
    els.gitKeepUserDataInput?.addEventListener("change", () => updateProtectedSectionDisabled());
    els.previewGitBtn?.addEventListener("click", previewGitUpdate);
    els.addExtraPatternBtn?.addEventListener("click", addExtraPattern);
    els.gitExtraPatternInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            addExtraPattern();
        }
    });
    els.gitHistoryBody?.addEventListener("click", handleHistoryClick);
}

async function addExtraPattern() {
    const value = (els.gitExtraPatternInput?.value || "").trim();
    if (!value) return;
    try {
        state.gitDeploy = await api("/api/git-deploy/protected", {
            method: "POST",
            body: JSON.stringify({ pattern: value }),
        });
        if (els.gitExtraPatternInput) els.gitExtraPatternInput.value = "";
        applyGitDeployToForm();
        showToastKey("toast.git_pattern_added");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function removeExtraPattern(pattern) {
    if (!pattern) return;
    try {
        state.gitDeploy = await api(`/api/git-deploy/protected?pattern=${encodeURIComponent(pattern)}`, {
            method: "DELETE",
        });
        applyGitDeployToForm();
        showToastKey("toast.git_pattern_removed");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function previewGitUpdate() {
    if (!els.gitPreviewBox) return;
    if (!(await saveGitDeploy({ silent: true }))) return;
    els.gitPreviewBox.classList.remove("hidden");
    if (els.gitPreviewMessage) els.gitPreviewMessage.textContent = tr("git.preview_loading");
    if (els.gitPreviewGrid) els.gitPreviewGrid.innerHTML = "";
    try {
        const payload = await api("/api/git-deploy/preview", { method: "POST" });
        state.gitPreview = payload;
        renderGitPreview(payload);
    } catch (error) {
        if (els.gitPreviewMessage) els.gitPreviewMessage.textContent = error.message || tr("git.preview_loading");
    }
}

function renderGitPreview(payload) {
    if (!els.gitPreviewGrid || !els.gitPreviewMessage) return;
    const totals = payload.totals || { added: 0, modified: 0, removed: 0, kept: 0 };
    const noChanges = totals.added + totals.modified + totals.removed === 0;
    els.gitPreviewMessage.textContent = noChanges
        ? tr("git.preview_clean")
        : `${tr("git.local_commit")}: ${shortCommit(payload.local_commit)} → ${shortCommit(payload.remote_commit)}`;
    const buckets = [
        { key: "added", label: tr("git.preview_added", { count: totals.added }), entries: payload.added || [] },
        { key: "modified", label: tr("git.preview_modified", { count: totals.modified }), entries: payload.modified || [] },
        { key: "removed", label: tr("git.preview_removed", { count: totals.removed }), entries: payload.removed || [] },
        { key: "kept", label: tr("git.preview_kept", { count: totals.kept }), entries: payload.kept || [] },
    ];
    els.gitPreviewGrid.innerHTML = buckets
        .map((bucket) => {
            const items = bucket.entries
                .slice(0, 200)
                .map((entry) => {
                    const path = entry.path || "";
                    const protectedTag = entry.protected
                        ? `<span class="tag is-protected">${escapeHtml(tr("git.protect_file"))}</span>`
                        : "";
                    return `<li><code>${escapeHtml(path)}</code>${protectedTag}</li>`;
                })
                .join("");
            return `<div class="git-preview-bucket git-preview-${bucket.key}"><h4>${escapeHtml(bucket.label)}</h4><ul>${items || "<li class=\"surface-note\">—</li>"}</ul></div>`;
        })
        .join("");
}

function applyGitDeployToForm() {
    const payload = state.gitDeploy || {};
    if (els.gitRepoInput) els.gitRepoInput.value = payload.repo_url || "";
    if (els.gitBranchInput) els.gitBranchInput.value = payload.branch || "main";
    if (els.gitAutoUpdateInput) els.gitAutoUpdateInput.checked = Boolean(payload.auto_update);
    if (els.gitInstallDepsInput) els.gitInstallDepsInput.checked = payload.install_requirements !== false;
    if (els.gitRestartInput) els.gitRestartInput.checked = payload.restart_after_update !== false;
    if (els.gitKeepUserDataInput) els.gitKeepUserDataInput.checked = payload.keep_user_data !== false;
    if (els.gitStatusText) els.gitStatusText.textContent = renderGitStatus(payload.status);
    if (els.gitLocalCommitText) els.gitLocalCommitText.textContent = shortCommit(payload.last_commit);
    if (els.gitRemoteCommitText) els.gitRemoteCommitText.textContent = shortCommit(payload.last_remote_commit);
    if (els.gitMessageText) els.gitMessageText.textContent = payload.message || tr("common.none");
    renderProtectedPaths();
    renderExtraPatterns();
    renderGitHistory();
    updateProtectedSectionDisabled();
}

function renderExtraPatterns() {
    if (!els.gitExtraPatternList) return;
    const extras = Array.isArray(state.gitDeploy?.extra_protected_paths) ? state.gitDeploy.extra_protected_paths : [];
    if (!extras.length) {
        els.gitExtraPatternList.innerHTML = `<li class="surface-note">${escapeHtml(tr("git.protected_extra_empty"))}</li>`;
        return;
    }
    els.gitExtraPatternList.innerHTML = extras
        .map((pattern) => {
            const safe = escapeHtml(pattern);
            return `<li><code>${safe}</code><button type="button" class="btn btn-secondary btn-sm" data-action="remove-pattern" data-pattern="${safe}">${escapeHtml(tr("git.protected_remove"))}</button></li>`;
        })
        .join("");
    els.gitExtraPatternList.querySelectorAll('[data-action="remove-pattern"]').forEach((button) => {
        button.addEventListener("click", () => removeExtraPattern(button.dataset.pattern));
    });
}

function renderGitHistory() {
    if (!els.gitHistoryBody) return;
    const history = Array.isArray(state.gitDeploy?.history) ? state.gitDeploy.history : [];
    if (!history.length) {
        els.gitHistoryBody.innerHTML = `<tr><td colspan="5"><div class="empty-state">${escapeHtml(tr("git.history_empty"))}</div></td></tr>`;
        return;
    }
    els.gitHistoryBody.innerHTML = history
        .map((entry) => {
            const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString(state.locale === "de" ? "de-AT" : "en-GB") : "-";
            const action = tr(`git.action_${entry.action}`) || entry.action;
            const summary = tr("git.history_summary", {
                added: entry.added || 0,
                modified: entry.modified || 0,
                removed: entry.removed || 0,
                kept: entry.kept || 0,
            });
            const commit = `${shortCommit(entry.from_commit)} → ${shortCommit(entry.to_commit)}`;
            const rollbackBtn = entry.backup_name
                ? `<button class="file-action-link" type="button" data-action="rollback" data-backup="${escapeHtml(entry.backup_name)}">${escapeHtml(tr("git.history_rollback"))}</button>`
                : "";
            return `<tr><td>${escapeHtml(ts)}</td><td>${escapeHtml(action)}</td><td>${escapeHtml(summary)}</td><td><code>${escapeHtml(commit)}</code></td><td>${rollbackBtn}</td></tr>`;
        })
        .join("");
}

async function handleHistoryClick(event) {
    const button = event.target.closest('button[data-action="rollback"]');
    if (!button) return;
    const backup = button.dataset.backup;
    if (!backup) return;
    if (!window.confirm(tr("git.history_rollback_confirm", { backup }))) return;
    try {
        state.gitDeploy = await api("/api/git-deploy/rollback", {
            method: "POST",
            body: JSON.stringify({ backup_name: backup }),
        });
        applyGitDeployToForm();
        showToastKey("toast.git_rolled_back");
    } catch (error) {
        showToast(error.message, "error");
    }
}

function renderProtectedPaths() {
    if (!els.gitProtectedList) return;
    const payload = state.gitDeploy || {};
    const entries = Array.isArray(payload.workspace_entries) ? payload.workspace_entries : [];
    const defaults = new Set((payload.default_protected_paths || []).map((value) => String(value)));
    const stored = Array.isArray(payload.protected_paths) ? payload.protected_paths.map((value) => String(value)) : [];
    const initialized = Boolean(payload.last_commit) || stored.length > 0;
    const selected = new Set(stored);
    if (!initialized) {
        defaults.forEach((value) => selected.add(value));
    }

    const fragment = document.createDocumentFragment();
    entries.forEach((entry) => {
        const label = document.createElement("label");
        label.className = "checkbox-field";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = entry.name;
        input.checked = selected.has(entry.name);
        input.dataset.role = "protected-path";
        label.appendChild(input);
        const span = document.createElement("span");
        const suffix = entry.kind === "directory" ? "/" : "";
        span.textContent = `${entry.name}${suffix}`;
        label.appendChild(span);
        fragment.appendChild(label);
    });
    els.gitProtectedList.replaceChildren();
    if (entries.length === 0) {
        const note = document.createElement("p");
        note.className = "surface-note";
        note.id = "gitProtectedEmpty";
        note.textContent = tr("git.protected_paths_empty");
        els.gitProtectedList.appendChild(note);
        els.gitProtectedEmpty = note;
    } else {
        els.gitProtectedList.appendChild(fragment);
    }
}

function collectProtectedPaths() {
    const inputs = els.gitProtectedList?.querySelectorAll('input[data-role="protected-path"]') || [];
    const stored = Array.isArray(state.gitDeploy?.protected_paths) ? state.gitDeploy.protected_paths.map((value) => String(value)) : [];
    if (!inputs.length) return stored;
    return Array.from(inputs).filter((input) => input.checked).map((input) => input.value);
}

function updateProtectedSectionDisabled() {
    const enabled = Boolean(els.gitKeepUserDataInput?.checked);
    [els.gitProtectedSection, els.gitExtraPatternSection].forEach((section) => {
        if (!section) return;
        section.classList.toggle("is-disabled", !enabled);
        section.setAttribute("aria-disabled", enabled ? "false" : "true");
    });
    const inputs = els.gitProtectedList?.querySelectorAll('input[data-role="protected-path"]') || [];
    inputs.forEach((input) => {
        input.disabled = !enabled;
    });
    if (els.refreshProtectedBtn) els.refreshProtectedBtn.disabled = !enabled;
    if (els.addExtraPatternBtn) els.addExtraPatternBtn.disabled = !enabled;
    if (els.gitExtraPatternInput) els.gitExtraPatternInput.disabled = !enabled;
}

function renderGitStatus(status) {
    const mapping = {
        not_configured: tr("git.status_not_configured"),
        configured: tr("git.status_configured"),
        not_imported: tr("git.status_not_imported"),
        up_to_date: tr("git.status_up_to_date"),
        update_available: tr("git.status_update_available"),
        imported: tr("git.status_imported"),
        updated: tr("git.status_updated"),
    };
    return mapping[status] || status || tr("common.none");
}

function shortCommit(value) {
    return value ? String(value).slice(0, 12) : "-";
}

async function saveGitDeploy({ silent = false } = {}) {
    try {
        state.gitDeploy = await api("/api/git-deploy", {
            method: "PUT",
            body: JSON.stringify({
                repo_url: (els.gitRepoInput?.value || "").trim(),
                branch: (els.gitBranchInput?.value || "main").trim(),
                auto_update: Boolean(els.gitAutoUpdateInput?.checked),
                install_requirements: Boolean(els.gitInstallDepsInput?.checked),
                restart_after_update: Boolean(els.gitRestartInput?.checked),
                keep_user_data: Boolean(els.gitKeepUserDataInput?.checked),
                protected_paths: collectProtectedPaths(),
                extra_protected_paths: Array.isArray(state.gitDeploy?.extra_protected_paths)
                    ? state.gitDeploy.extra_protected_paths
                    : [],
            }),
        });
        applyGitDeployToForm();
        if (!silent) showToastKey("toast.git_saved");
        return true;
    } catch (error) {
        showToast(error.message, "error");
        return false;
    }
}

async function refreshGitDeploy({ silent = true } = {}) {
    try {
        state.gitDeploy = await api("/api/git-deploy");
        applyGitDeployToForm();
    } catch (error) {
        if (!silent) showToast(error.message, "error");
    }
}

async function runGitAction(path, toastKey) {
    try {
        state.gitDeploy = await api(path, { method: "POST" });
        applyGitDeployToForm();
        await Promise.all([refreshStatus({ silent: true }), refreshTasks({ silent: true })]);
        showToastKey(toastKey);
        if (shouldShowWorkspaceReport(state.gitDeploy.workspace_report)) {
            showWorkspaceReportModal(state.gitDeploy.workspace_report, { title: tr("workspace_report.import_done") });
        }
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function refreshFilesIfVisible() {
    if (page === "files") await refreshFiles(state.currentPath);
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
        state.gitDeploy = await api("/api/git-deploy");
        state.settings = settings;
        state.envEntries = envPayload.entries || [];
        state.tasks = taskPayload.items || [];
        applySettingsToForm();
        applyGitDeployToForm();
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
        state.activeTaskOutput = "";
        renderTaskOutput();
        return;
    }
    try {
        const payload = await api(`/api/tasks/${state.activeTaskId}`);
        state.activeTaskOutput = payload.output || "";
        renderTaskOutput(payload);
        const index = state.tasks.findIndex((task) => task.task_id === payload.task_id);
        if (index >= 0) {
            state.tasks[index] = { ...state.tasks[index], ...payload };
            renderTasks();
        }
    } catch (error) {
        if (!silent) showToast(error.message, "error");
    }
}

function updateConsoleFilterButtons() {
    els.consoleFilterButtons?.forEach((button) => {
        button.classList.toggle("is-active", (button.dataset.consoleFilter || "all") === state.consoleFilter);
    });
}

function renderTaskOutput(task = null) {
    if (!els.taskOutput) return;
    const output = state.activeTaskOutput || "";
    if (!output) {
        renderTerminalOutput(els.taskOutput, tr("error.task_empty"));
        return;
    }
    const filtered = filterConsoleOutput(output, state.consoleFilter, task);
    renderTerminalOutput(els.taskOutput, filtered || tr("console.filter_empty"));
}

function filterConsoleOutput(output, filter, task = null) {
    if (!filter || filter === "all") return output;
    const lines = output.split(/\r?\n/);
    const commandText = (task?.command || []).join(" ");
    const patterns = {
        errors: /(error|exception|traceback|failed|fatal|fehler)/i,
        warnings: /(warn|warning|deprecated|achtung)/i,
        success: /(success|done|installed|ok|erfolgreich)/i,
        commands: /(command|running|executing|^\s*[>$#]|befehl)/i,
        system: /(task|status|exit|started|finished|process|system|pid|runtime)/i,
    };
    return lines
        .filter((line) => {
            if (filter === "commands" && commandText && line.includes(commandText)) return true;
            return patterns[filter]?.test(line);
        })
        .join("\n")
        .trim();
}

function shouldShowWorkspaceReport(report) {
    return Boolean(report && ((report.missing || []).length || (report.warnings || []).length));
}

function showWorkspaceReportModal(report, { title, onClose } = {}) {
    const missing = report?.missing || [];
    const warnings = report?.warnings || [];
    const lines = [];
    if (missing.length) lines.push(`${tr("workspace_report.missing")}: ${missing.join(", ")}`);
    warnings.forEach((warning) => lines.push(warning));
    openModal({
        eyebrow: tr("workspace_report.eyebrow"),
        title: title || tr("workspace_report.title"),
        description: lines.join("\n") || tr("workspace_report.ok"),
        hideFields: true,
        confirmText: tr("workspace_report.confirm"),
        cancelText: tr("common.close"),
        onConfirm: () => true,
        onClose,
    });
}

function bindDatabasesPage() {
    Object.assign(els, {
        refreshDatabasesBtn: byId("refreshDatabasesBtn"),
        databaseSearchInput: byId("databaseSearchInput"),
        databaseList: byId("databaseList"),
        databasePathLabel: byId("databasePathLabel"),
        databaseTitle: byId("databaseTitle"),
        databaseMeta: byId("databaseMeta"),
        databaseTableSelect: byId("databaseTableSelect"),
        databaseTableTabs: byId("databaseTableTabs"),
        reloadTableBtn: byId("reloadTableBtn"),
        databaseTableWrap: byId("databaseTableWrap"),
        databaseQueryForm: byId("databaseQueryForm"),
        databaseQueryInput: byId("databaseQueryInput"),
        runDatabaseQueryBtn: byId("runDatabaseQueryBtn"),
        databaseQueryResult: byId("databaseQueryResult"),
        databaseValueModal: byId("databaseValueModal"),
        databaseValueTitle: byId("databaseValueTitle"),
        databaseValueContent: byId("databaseValueContent"),
        databaseValueCloseBtn: byId("databaseValueCloseBtn"),
        databaseValueDoneBtn: byId("databaseValueDoneBtn"),
        databaseValueCopyBtn: byId("databaseValueCopyBtn"),
        databaseRowModal: byId("databaseRowModal"),
        databaseRowTitle: byId("databaseRowTitle"),
        databaseRowForm: byId("databaseRowForm"),
        databaseRowFields: byId("databaseRowFields"),
        databaseRowCloseBtn: byId("databaseRowCloseBtn"),
        databaseRowCancelBtn: byId("databaseRowCancelBtn"),
    });

    els.refreshDatabasesBtn?.addEventListener("click", () => refreshDatabases());
    els.databaseSearchInput?.addEventListener("input", renderDatabaseList);
    els.databaseList?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-db-path]");
        if (button) openDatabase(button.dataset.dbPath);
    });
    els.databaseTableTabs?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-db-table]");
        if (button) openDatabaseTable(button.dataset.dbTable);
    });
    els.databaseTableSelect?.addEventListener("change", () => openDatabaseTable(els.databaseTableSelect.value));
    els.reloadTableBtn?.addEventListener("click", () => openDatabaseTable(state.activeDbTable));
    els.databaseTableWrap?.addEventListener("change", handleDatabaseCellChange);
    els.databaseTableWrap?.addEventListener("click", handleDatabaseTableClick);
    els.databaseQueryForm?.addEventListener("submit", runDatabaseQuery);
    els.databaseValueCloseBtn?.addEventListener("click", closeDatabaseValueModal);
    els.databaseValueDoneBtn?.addEventListener("click", closeDatabaseValueModal);
    els.databaseValueModal?.addEventListener("click", (event) => {
        if (event.target === els.databaseValueModal) closeDatabaseValueModal();
    });
    els.databaseValueCopyBtn?.addEventListener("click", copyDatabaseValue);
    els.databaseRowCloseBtn?.addEventListener("click", closeDatabaseRowModal);
    els.databaseRowCancelBtn?.addEventListener("click", closeDatabaseRowModal);
    els.databaseRowModal?.addEventListener("click", (event) => {
        if (event.target === els.databaseRowModal) closeDatabaseRowModal();
    });
    els.databaseRowForm?.addEventListener("submit", createDatabaseRow);
    refreshDatabases();
}

async function refreshDatabases() {
    try {
        const payload = await api("/api/databases");
        state.databases = payload.items || [];
        renderDatabaseList();
        if (state.activeDatabase && !state.databases.some((item) => item.path === state.activeDatabase)) {
            clearDatabaseView();
        }
    } catch (error) {
        showToast(error.message, "error");
    }
}

function renderDatabaseList() {
    if (!els.databaseList) return;
    const query = (els.databaseSearchInput?.value || "").trim().toLowerCase();
    const items = state.databases.filter((item) => !query || item.path.toLowerCase().includes(query));
    els.databaseList.innerHTML = items.length
        ? items.map((item) => `
            <button class="database-list-item ${state.activeDatabase === item.path ? "is-active" : ""}" type="button" data-db-path="${escapeHtml(item.path)}">
                <strong>${escapeHtml(item.name)}</strong>
                <span>${escapeHtml(item.path)}</span>
                <small>${escapeHtml(item.size_human || "-")} · ${escapeHtml(formatUnixDate(item.modified_at))}</small>
            </button>
        `).join("")
        : `<div class="empty-state">${escapeHtml(tr("databases.empty"))}</div>`;
}

async function openDatabase(path) {
    if (!path) return;
    try {
        const payload = await api(`/api/databases/inspect?path=${encodeURIComponent(path)}`);
        state.activeDatabase = payload.path;
        state.databaseInspect = payload;
        state.activeDbTable = payload.tables?.[0]?.name || "";
        if (els.databasePathLabel) els.databasePathLabel.textContent = payload.path || "/";
        if (els.databaseTitle) els.databaseTitle.textContent = payload.name || payload.path || tr("databases.select_title");
        if (els.databaseMeta) {
            els.databaseMeta.textContent = payload.tables?.length
                ? tr("databases.table_summary", { count: payload.tables.length })
                : tr("databases.no_tables");
        }
        renderDatabaseList();
        renderDatabaseTableSelect();
        renderDatabaseTableTabs();
        setDatabaseControlsEnabled(true);
        if (state.activeDbTable) await openDatabaseTable(state.activeDbTable);
        else renderDatabaseTableEmpty(tr("databases.no_tables"));
    } catch (error) {
        showToast(error.message, "error");
    }
}

function renderDatabaseTableSelect() {
    if (!els.databaseTableSelect) return;
    const tables = state.databaseInspect?.tables || [];
    els.databaseTableSelect.innerHTML = tables.map((table) => `
        <option value="${escapeHtml(table.name)}">${escapeHtml(table.name)} (${escapeHtml(table.type)})</option>
    `).join("");
    els.databaseTableSelect.value = state.activeDbTable || "";
    els.databaseTableSelect.disabled = !tables.length;
}

function renderDatabaseTableTabs() {
    if (!els.databaseTableTabs) return;
    const tables = state.databaseInspect?.tables || [];
    els.databaseTableTabs.innerHTML = tables.length
        ? tables.map((table) => `
            <button class="database-table-chip ${state.activeDbTable === table.name ? "is-active" : ""}" type="button" data-db-table="${escapeHtml(table.name)}">
                <span>${escapeHtml(table.name)}</span>
                <small>${escapeHtml(table.type)}</small>
            </button>
        `).join("")
        : "";
}

async function openDatabaseTable(tableName) {
    if (!state.activeDatabase || !tableName) return;
    state.activeDbTable = tableName;
    if (els.databaseTableSelect) els.databaseTableSelect.value = tableName;
    renderDatabaseTableTabs();
    try {
        const payload = await api(`/api/databases/table?path=${encodeURIComponent(state.activeDatabase)}&table=${encodeURIComponent(tableName)}&limit=100`);
        state.databaseRows = payload;
        renderDatabaseRows(payload);
    } catch (error) {
        showToast(error.message, "error");
    }
}

function renderDatabaseRows(payload) {
    if (!els.databaseTableWrap) return;
    const columns = payload.columns || [];
    const rows = payload.rows || [];
    const tableMeta = (state.databaseInspect?.tables || []).find((item) => item.name === payload.table);
    if (!columns.length) {
        renderDatabaseTableEmpty(tr("databases.no_tables"));
        return;
    }
    const countText = tr("databases.rows", { count: payload.total ?? rows.length });
    const readonlyText = tableMeta?.editable ? "" : `<p class="surface-note">${escapeHtml(tr("databases.readonly"))}</p>`;
    const emptyRows = `<tr><td colspan="${columns.length + 1}"><div class="empty-state database-table-empty">${escapeHtml(tr("databases.table_empty"))}</div></td></tr>`;
    const actionHeader = tableMeta?.editable ? `<th>${escapeHtml(tr("common.edit"))}</th>` : "";
    const actionColspan = columns.length + (tableMeta?.editable ? 2 : 1);
    els.databaseTableWrap.innerHTML = `
        <div class="database-table-meta">
            <div>
                <strong>${escapeHtml(payload.table)}</strong>
                <span>${escapeHtml(tableMeta?.type || "table")}</span>
            </div>
            <div class="toolbar-actions database-table-actions">
                <span>${escapeHtml(countText)}</span>
                ${tableMeta?.editable ? `<button class="btn btn-secondary" type="button" data-db-action="add-row">${escapeHtml(tr("databases.add_row"))}</button>` : ""}
                <button class="btn btn-secondary" type="button" data-db-action="export-csv">${escapeHtml(tr("databases.export_csv"))}</button>
            </div>
        </div>
        ${readonlyText}
        <p class="surface-note database-scroll-hint">${escapeHtml(tr("databases.scroll_hint"))}</p>
        <div class="table-wrap database-scroll-table">
            <table class="data-table database-data-table">
                <thead>
                    <tr>
                        <th>rowid</th>
                        ${columns.map((column) => `<th>${escapeHtml(column.name)}<small>${escapeHtml(column.type || "")}</small></th>`).join("")}
                        ${actionHeader}
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            <td><span class="code-pill">${escapeHtml(row.__rowid__)}</span></td>
                            ${columns.map((column) => renderDatabaseCell(row, column, Boolean(tableMeta?.editable))).join("")}
                            ${tableMeta?.editable ? `<td><button class="file-action-link danger-link" type="button" data-db-action="delete-row" data-rowid="${escapeHtml(row.__rowid__)}">${escapeHtml(tr("databases.delete_row"))}</button></td>` : ""}
                        </tr>
                    `).join("") || emptyRows.replace(`colspan="${columns.length + 1}"`, `colspan="${actionColspan}"`)}
                </tbody>
            </table>
        </div>
    `;
}

function renderDatabaseCell(row, column, editable) {
    const value = row[column.name];
    const text = value === null || value === undefined ? "" : String(value);
    if (!editable || column.primary_key) {
        const display = value === null || value === undefined ? tr("databases.null_value") : compactDatabaseValue(text);
        return `<td title="${escapeHtml(text)}">${renderDatabaseValueButton(display, text, column.name)}</td>`;
    }
    return `
        <td>
            <div class="database-cell-editor">
                <input class="database-cell-input" type="text"
                value="${escapeHtml(text)}"
                data-rowid="${escapeHtml(row.__rowid__)}"
                data-column="${escapeHtml(column.name)}"
                data-original="${escapeHtml(text)}">
                ${renderDatabaseValueButton("...", text, column.name, true)}
            </div>
        </td>
    `;
}

function renderDatabaseValueButton(display, value, column, iconOnly = false) {
    const text = value === null || value === undefined ? "" : String(value);
    const looksUseful = text.length > 80 || /^[\[{]/.test(text.trim());
    if (!looksUseful) return escapeHtml(display);
    return `<button class="database-value-link ${iconOnly ? "is-icon" : ""}" type="button" data-db-action="view-value" data-column="${escapeHtml(column)}" data-value="${escapeHtml(text)}">${escapeHtml(iconOnly ? tr("databases.view_value") : display)}</button>`;
}

function compactDatabaseValue(value) {
    const text = String(value).replace(/\s+/g, " ").trim();
    return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

async function handleDatabaseCellChange(event) {
    const input = event.target.closest(".database-cell-input");
    if (!input || !state.activeDatabase || !state.activeDbTable) return;
    if (input.value === input.dataset.original) return;
    try {
        const payload = await api("/api/databases/cell", {
            method: "PUT",
            body: JSON.stringify({
                path: state.activeDatabase,
                table: state.activeDbTable,
                rowid: Number(input.dataset.rowid),
                column: input.dataset.column,
                value: input.value,
            }),
        });
        state.databaseRows = payload;
        input.dataset.original = input.value;
        showToastKey("databases.saved");
    } catch (error) {
        input.value = input.dataset.original || "";
        showToast(error.message, "error");
    }
}

function handleDatabaseTableClick(event) {
    const target = event.target.closest("[data-db-action]");
    if (!target) return;
    const action = target.dataset.dbAction;
    if (action === "add-row") {
        openDatabaseRowModal();
    } else if (action === "delete-row") {
        deleteDatabaseRow(target.dataset.rowid);
    } else if (action === "export-csv") {
        exportDatabaseCsv();
    } else if (action === "view-value") {
        openDatabaseValueModal(target.dataset.value || "", target.dataset.column || "");
    }
}

function openDatabaseRowModal() {
    const tableMeta = (state.databaseInspect?.tables || []).find((item) => item.name === state.activeDbTable);
    if (!tableMeta?.editable || !els.databaseRowModal || !els.databaseRowFields) return;
    const editableColumns = (state.databaseRows?.columns || []).filter((column) => !column.primary_key);
    els.databaseRowTitle.textContent = `${tr("databases.add_row")}: ${state.activeDbTable}`;
    els.databaseRowFields.innerHTML = editableColumns.map((column) => `
        <label class="field">
            <span>${escapeHtml(column.name)}${column.notnull ? " *" : ""}</span>
            <textarea rows="2" data-column="${escapeHtml(column.name)}" placeholder="${escapeHtml(column.type || "")}"></textarea>
        </label>
    `).join("");
    els.databaseRowModal.classList.remove("hidden");
}

function closeDatabaseRowModal() {
    els.databaseRowModal?.classList.add("hidden");
    els.databaseRowForm?.reset();
}

async function createDatabaseRow(event) {
    event.preventDefault();
    if (!state.activeDatabase || !state.activeDbTable || !els.databaseRowFields) return;
    const values = {};
    els.databaseRowFields.querySelectorAll("[data-column]").forEach((input) => {
        values[input.dataset.column] = input.value;
    });
    try {
        const payload = await api("/api/databases/row", {
            method: "POST",
            body: JSON.stringify({ path: state.activeDatabase, table: state.activeDbTable, values }),
        });
        state.databaseRows = payload;
        closeDatabaseRowModal();
        renderDatabaseRows(payload);
        showToastKey("databases.row_added");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function deleteDatabaseRow(rowid) {
    if (!state.activeDatabase || !state.activeDbTable || !rowid) return;
    if (!window.confirm(tr("databases.delete_row_confirm"))) return;
    try {
        const payload = await api("/api/databases/row", {
            method: "DELETE",
            body: JSON.stringify({ path: state.activeDatabase, table: state.activeDbTable, rowid: Number(rowid) }),
        });
        state.databaseRows = payload;
        renderDatabaseRows(payload);
        showToastKey("databases.row_deleted");
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function exportDatabaseCsv() {
    if (!state.activeDatabase || !state.activeDbTable) return;
    try {
        const payload = await api(`/api/databases/export?path=${encodeURIComponent(state.activeDatabase)}&table=${encodeURIComponent(state.activeDbTable)}`);
        const blob = new Blob([payload.content || ""], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = payload.filename || `${state.activeDbTable}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showToastKey("databases.csv_exported");
    } catch (error) {
        showToast(error.message, "error");
    }
}

function openDatabaseValueModal(value, column) {
    state.currentDatabaseValue = value || "";
    if (els.databaseValueTitle) els.databaseValueTitle.textContent = column || tr("databases.cell_value");
    if (els.databaseValueContent) els.databaseValueContent.textContent = prettyDatabaseValue(state.currentDatabaseValue);
    els.databaseValueModal?.classList.remove("hidden");
}

function closeDatabaseValueModal() {
    els.databaseValueModal?.classList.add("hidden");
}

async function copyDatabaseValue() {
    try {
        await navigator.clipboard.writeText(state.currentDatabaseValue || "");
        showToastKey("databases.copied");
    } catch (error) {
        showToast(error.message, "error");
    }
}

function prettyDatabaseValue(value) {
    const text = String(value ?? "");
    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
        return text;
    }
}

async function runDatabaseQuery(event) {
    event.preventDefault();
    if (!state.activeDatabase) return;
    const sql = (els.databaseQueryInput?.value || "").trim();
    if (!sql) return;
    try {
        const payload = await api("/api/databases/query", {
            method: "POST",
            body: JSON.stringify({ path: state.activeDatabase, sql }),
        });
        renderDatabaseQueryResult(payload);
    } catch (error) {
        showToast(error.message, "error");
    }
}

function renderDatabaseQueryResult(payload) {
    if (!els.databaseQueryResult) return;
    const columns = payload.columns || [];
    const rows = payload.rows || [];
    if (!columns.length) {
        els.databaseQueryResult.innerHTML = `<div class="empty-state">${escapeHtml(tr("databases.query_empty"))}</div>`;
        return;
    }
    els.databaseQueryResult.innerHTML = `
        <div class="table-wrap database-scroll-table">
            <table class="data-table database-data-table">
                <thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
                <tbody>
                    ${rows.map((row) => `<tr>${columns.map((column) => `<td title="${escapeHtml(row[column] ?? "")}">${escapeHtml(compactDatabaseValue(row[column] ?? ""))}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${columns.length}"><div class="empty-state database-table-empty">${escapeHtml(tr("databases.table_empty"))}</div></td></tr>`}
                </tbody>
            </table>
        </div>
        ${payload.truncated ? `<p class="surface-note">500 rows shown.</p>` : ""}
    `;
}

function renderDatabaseTableEmpty(message) {
    if (els.databaseTableWrap) els.databaseTableWrap.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function clearDatabaseView() {
    state.activeDatabase = null;
    state.databaseInspect = null;
    state.activeDbTable = "";
    state.databaseRows = null;
    if (els.databasePathLabel) els.databasePathLabel.textContent = tr("databases.no_selection");
    if (els.databaseTitle) els.databaseTitle.textContent = tr("databases.select_title");
    if (els.databaseMeta) els.databaseMeta.textContent = tr("databases.select_hint");
    if (els.databaseTableSelect) els.databaseTableSelect.innerHTML = "";
    if (els.databaseTableTabs) els.databaseTableTabs.innerHTML = "";
    renderDatabaseTableEmpty(tr("databases.empty"));
    setDatabaseControlsEnabled(false);
}

function setDatabaseControlsEnabled(enabled) {
    if (els.databaseTableSelect) els.databaseTableSelect.disabled = !enabled || !(state.databaseInspect?.tables || []).length;
    if (els.reloadTableBtn) els.reloadTableBtn.disabled = !enabled;
    if (els.databaseQueryInput) els.databaseQueryInput.disabled = !enabled;
    if (els.runDatabaseQueryBtn) els.runDatabaseQueryBtn.disabled = !enabled;
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
    refreshGitDeploy({ silent: true });
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
    const isProtected = isPathProtected(entry.path);
    const protectAction = isProtected ? "unprotect" : "protect";
    const protectLabel = isProtected ? tr("git.unprotect_file") : tr("git.protect_file");
    const protectButton = `<button class="file-action-link${isProtected ? " is-protected" : ""}" type="button" data-action="${protectAction}" data-path="${escapeHtml(entry.path)}">${escapeHtml(protectLabel)}</button>`;

    const actionButtons = [
        `<button class="file-action-link" type="button" data-action="${primaryAction}" data-path="${escapeHtml(entry.path)}">${escapeHtml(primaryLabel)}</button>`,
        `<button class="file-action-link" type="button" data-action="rename" data-path="${escapeHtml(entry.path)}">${escapeHtml(tr("files.rename"))}</button>`,
        `<button class="file-action-link" type="button" data-action="download" data-path="${escapeHtml(entry.path)}">${escapeHtml(tr("files.download"))}</button>`,
        protectButton,
        entry.extractable ? `<button class="file-action-link" type="button" data-action="extract" data-path="${escapeHtml(entry.path)}">${escapeHtml(tr("files.extract"))}</button>` : "",
        `<button class="file-action-link" type="button" data-action="delete" data-path="${escapeHtml(entry.path)}">${escapeHtml(tr("common.delete"))}</button>`,
    ].join("");

    return `
        <tr${isProtected ? ' class="row-protected"' : ""}>
            <td><input type="checkbox" data-path="${escapeHtml(entry.path)}" ${checked}></td>
            <td>
                <div class="file-name-cell">
                    <span class="file-icon file-icon-emoji" title="${escapeHtml(fileIcon.label)}" aria-hidden="true">${fileIcon.symbol}</span>
                    <button class="file-link" type="button" data-action="${primaryAction}" data-path="${escapeHtml(entry.path)}">${escapeHtml(entry.name)}</button>
                    ${isProtected ? '<span class="tag is-protected" aria-hidden="true">🔒</span>' : ""}
                </div>
            </td>
            <td>${escapeHtml(kindLabel)}</td>
            <td>${escapeHtml(entry.size_human || "-")}</td>
            <td>${escapeHtml(formatUnixDate(entry.modified_at))}</td>
            <td><div class="file-actions">${actionButtons}</div></td>
        </tr>
    `;
}

function isPathProtected(relativePath) {
    if (!relativePath) return false;
    const dir = relativePath.includes("/") ? relativePath.split("/", 1)[0] : relativePath;
    const protectedSet = new Set([
        ...(state.gitDeploy?.protected_paths || []),
        ...(state.gitDeploy?.extra_protected_paths || []),
    ]);
    if (protectedSet.has(relativePath)) return true;
    if (protectedSet.has(dir)) return true;
    for (const pattern of protectedSet) {
        if (typeof pattern !== "string") continue;
        if (pattern.includes("*") || pattern.includes("?")) {
            if (matchGlob(pattern, relativePath)) return true;
        }
    }
    return false;
}

function matchGlob(pattern, value) {
    const escapeRegex = (s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    let regex = "";
    let index = 0;
    while (index < pattern.length) {
        const ch = pattern[index];
        if (ch === "*") {
            if (pattern.slice(index, index + 2) === "**") {
                regex += ".*";
                index += 2;
                if (pattern[index] === "/") index += 1;
                continue;
            }
            regex += "[^/]*";
        } else if (ch === "?") {
            regex += "[^/]";
        } else {
            regex += escapeRegex(ch);
        }
        index += 1;
    }
    return new RegExp("^" + regex + "$").test(value);
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
    if (action === "protect") toggleProtectFile(path, true);
    if (action === "unprotect") toggleProtectFile(path, false);
}

async function toggleProtectFile(relativePath, protect) {
    if (!relativePath) return;
    try {
        if (protect) {
            state.gitDeploy = await api("/api/git-deploy/protected", {
                method: "POST",
                body: JSON.stringify({ pattern: relativePath }),
            });
            showToastKey("toast.git_protect_added");
        } else {
            state.gitDeploy = await api(`/api/git-deploy/protected?pattern=${encodeURIComponent(relativePath)}`, {
                method: "DELETE",
            });
            showToastKey("toast.git_protect_removed");
        }
        renderFileTable();
    } catch (error) {
        showToast(error.message, "error");
    }
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
    window.open(withServerParam(`/api/files/download?path=${encodeURIComponent(path)}`), "_blank", "noopener");
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
        const response = await fetch(withServerParam("/api/files/download-selection"), {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Server-Id": state.activeServerId },
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
    if (!els.tourShell) return;

    els.mascotHelpBtn?.addEventListener("click", () => openTour({ force: true }));
    els.tourModePicker?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-tour-mode]");
        if (!button) return;
        startTourMode(button.dataset.tourMode === "detailed" ? "detailed" : "normal");
    });
    els.tourSkipBtn?.addEventListener("click", () => closeTour({ remember: true }));
    els.tourShell.addEventListener("click", (event) => {
        if (event.target === els.tourShell) closeTour({ remember: true });
    });

    els.spotlightNextBtn?.addEventListener("click", advanceSpotlightTour);
    els.spotlightSkipBtn?.addEventListener("click", () => closeTour({ remember: true }));

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeTour({ remember: true });
    });

    const savedState = loadTourState();
    if (savedState) {
        activeTourSteps = savedState.mode === "detailed" ? detailedTourSteps : normalTourSteps;
        tourIndex = savedState.index;
        clearTourState();
        window.setTimeout(() => showSpotlightStep(), 600);
    } else if (!hasSeenTour()) {
        window.setTimeout(() => openTour(), 700);
    }
}

function hasSeenTour() {
    try { return window.localStorage.getItem(tourStorageKey) === "1"; }
    catch { return true; }
}

function rememberTour() {
    try { window.localStorage.setItem(tourStorageKey, "1"); }
    catch { /* ignore */ }
}

function saveTourState(mode, index) {
    try { window.localStorage.setItem(tourStateKey, JSON.stringify({ mode, index })); }
    catch { /* ignore */ }
}

function loadTourState() {
    try {
        const raw = window.localStorage.getItem(tourStateKey);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch { return null; }
}

function clearTourState() {
    try { window.localStorage.removeItem(tourStateKey); }
    catch { /* ignore */ }
}

function openTour({ force = false } = {}) {
    if (!els.tourShell) return;
    if (!force && hasSeenTour()) return;
    els.tourShell.classList.remove("hidden");
    window.setTimeout(() => els.tourModePicker?.querySelector("button")?.focus(), 0);
}

function closeTour({ remember = false } = {}) {
    if (remember) rememberTour();
    clearTourState();
    els.tourShell?.classList.add("hidden");
    hideSpotlight();
}

function startTourMode(mode) {
    activeTourSteps = mode === "detailed" ? detailedTourSteps : normalTourSteps;
    tourIndex = 0;
    els.tourShell?.classList.add("hidden");

    const step = activeTourSteps[tourIndex];
    if (step && step.page !== page) {
        saveTourState(mode, tourIndex);
        window.location.href = step.url;
        return;
    }
    showSpotlightStep();
}

function advanceSpotlightTour() {
    tourIndex += 1;
    if (tourIndex >= activeTourSteps.length) {
        closeTour({ remember: true });
        return;
    }
    const step = activeTourSteps[tourIndex];
    if (step.page !== page) {
        const mode = activeTourSteps === detailedTourSteps ? "detailed" : "normal";
        saveTourState(mode, tourIndex);
        window.location.href = step.url;
        return;
    }
    showSpotlightStep();
}

function showSpotlightStep() {
    const step = activeTourSteps[tourIndex];
    if (!step) { closeTour({ remember: true }); return; }

    const target = document.querySelector(step.selector) || document.querySelector(".page-shell");
    if (!target) { closeTour({ remember: true }); return; }

    target.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => positionSpotlight(target, step), 350);
}

function positionSpotlight(target, step) {
    const rect = target.getBoundingClientRect();
    const pad = 10;

    // Highlight
    const hl = els.spotlightHighlight;
    if (hl) {
        hl.style.left = (rect.left - pad) + "px";
        hl.style.top = (rect.top - pad) + "px";
        hl.style.width = (rect.width + pad * 2) + "px";
        hl.style.height = (rect.height + pad * 2) + "px";
        hl.classList.remove("hidden");
    }

    // Tooltip content
    if (els.spotlightEyebrow) els.spotlightEyebrow.textContent = tr("tour.eyebrow");
    if (els.spotlightTitle) els.spotlightTitle.textContent = tr(step.titleKey || "tour.eyebrow");
    if (els.spotlightText) els.spotlightText.textContent = tr(step.textKey);
    if (els.spotlightCounter) els.spotlightCounter.textContent = `${tourIndex + 1} / ${activeTourSteps.length}`;
    if (els.spotlightNextBtn) els.spotlightNextBtn.textContent = tourIndex >= activeTourSteps.length - 1 ? tr("tour.finish") : tr("tour.next");

    // Progress dots
    if (els.spotlightProgress) {
        els.spotlightProgress.innerHTML = activeTourSteps
            .map((_, i) => `<span class="${i === tourIndex ? "is-active" : i < tourIndex ? "is-done" : ""}"></span>`)
            .join("");
    }

    // Position tooltip
    const tt = els.spotlightTooltip;
    if (tt) {
        tt.classList.remove("hidden");
        const ttW = 380;
        const ttH = tt.offsetHeight || 260;
        let ttLeft, ttTop;
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceRight = window.innerWidth - rect.right;

        if (spaceRight > ttW + 60) {
            ttLeft = rect.right + 40;
            ttTop = Math.max(20, rect.top + rect.height / 2 - ttH / 2);
        } else if (rect.left > ttW + 60) {
            ttLeft = rect.left - ttW - 40;
            ttTop = Math.max(20, rect.top + rect.height / 2 - ttH / 2);
        } else if (spaceBelow > ttH + 60) {
            ttLeft = Math.max(20, rect.left + rect.width / 2 - ttW / 2);
            ttTop = rect.bottom + 40;
        } else {
            ttLeft = Math.max(20, rect.left + rect.width / 2 - ttW / 2);
            ttTop = Math.max(20, rect.top - ttH - 40);
        }

        ttTop = Math.min(ttTop, window.innerHeight - ttH - 20);
        ttLeft = Math.min(ttLeft, window.innerWidth - ttW - 20);
        tt.style.left = ttLeft + "px";
        tt.style.top = ttTop + "px";

        // Connector line
        const cn = els.spotlightConnector;
        if (cn) {
            const hlCx = rect.left + rect.width / 2;
            const hlCy = rect.top + rect.height / 2;
            const ttCx = ttLeft + ttW / 2;
            const ttCy = ttTop + (tt.offsetHeight || ttH) / 2;
            const dx = ttCx - hlCx;
            const dy = ttCy - hlCy;
            const len = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * (180 / Math.PI) - 90;

            cn.style.left = hlCx + "px";
            cn.style.top = hlCy + "px";
            cn.style.height = len + "px";
            cn.style.transformOrigin = "top center";
            cn.style.transform = `translateX(-50%) rotate(${angle}deg)`;
            cn.classList.remove("hidden");
        }
    }
}

function hideSpotlight() {
    els.spotlightHighlight?.classList.add("hidden");
    els.spotlightConnector?.classList.add("hidden");
    els.spotlightTooltip?.classList.add("hidden");
}

function switchLogTab(tab) {
    state.logTab = tab === "system" ? "system" : "bot";
    renderLogSurfaces();
}

function connectLogSocket(channel) {
    if (state.sockets[channel]) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams();
    if (state.activeServerId) params.set("server_id", state.activeServerId);
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/logs/${channel}?${params.toString()}`);
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
        renderTerminalOutput(els.logOutput, buffer.length ? buffer.join("\n") : tr("activity.waiting"));
    }

    if (els.downloadLogsLink) {
        els.downloadLogsLink.href = withServerParam(`/api/logs/${state.logTab}/download`);
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
    if (els.modalFieldOneWrap) els.modalFieldOneWrap.classList.toggle("hidden", Boolean(config.hideFields));
    if (els.modalFieldOneLabel) els.modalFieldOneLabel.textContent = config.fieldOneLabel || tr("modal.name");
    if (els.modalFieldOneInput) {
        els.modalFieldOneInput.value = config.fieldOneValue || "";
        els.modalFieldOneInput.placeholder = config.fieldOnePlaceholder || "";
    }
    if (els.modalFieldTwoWrap) els.modalFieldTwoWrap.classList.toggle("hidden", Boolean(config.hideFields) || !config.fieldTwoLabel);
    if (els.modalFieldTwoLabel) els.modalFieldTwoLabel.textContent = config.fieldTwoLabel || "";
    if (els.modalFieldTwoInput) {
        els.modalFieldTwoInput.value = config.fieldTwoValue || "";
        els.modalFieldTwoInput.placeholder = config.fieldTwoPlaceholder || "";
    }
    if (els.modalConfirmBtn) els.modalConfirmBtn.textContent = config.confirmText || tr("common.save");
    if (els.modalSecondaryBtn) els.modalSecondaryBtn.textContent = config.cancelText || tr("schedules.cancel");
    els.modalShell?.classList.remove("hidden");
    window.setTimeout(() => (config.hideFields ? els.modalConfirmBtn : els.modalFieldOneInput)?.focus(), 0);
}

function closeModal() {
    const onClose = activeModal?.onClose;
    activeModal = null;
    els.modalShell?.classList.add("hidden");
    els.modalForm?.reset();
    els.modalFieldOneWrap?.classList.remove("hidden");
    els.modalFieldTwoWrap?.classList.add("hidden");
    onClose?.();
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

function renderTerminalOutput(node, text) {
    if (!node) return;
    const lines = String(text ?? "").split(/\r?\n/);
    node.innerHTML = lines
        .map((line) => `<span class="terminal-line ${terminalLineClass(line)}">${escapeHtml(line || " ")}</span>`)
        .join("\n");
}

function terminalLineClass(line) {
    const value = String(line || "");
    if (/^\s*[>$#]/.test(value) || /^\$\s/.test(value)) return "terminal-line-command";
    if (/(traceback|exception|fatal|failed|error|fehler|fehlgeschlagen|crashed|abgestuerzt|abgestürzt)/i.test(value)) {
        return "terminal-line-error";
    }
    if (/(warn|warning|deprecated|achtung)/i.test(value)) return "terminal-line-warning";
    if (/(success|done|installed|ok|erfolgreich|gestartet|started|finished|beendet)/i.test(value)) {
        return "terminal-line-success";
    }
    if (/(task|status|system|pid|runtime|prozess|process|console-task)/i.test(value)) return "terminal-line-system";
    if (/^[\w.-]+@[\w.-]+[~:/\w.-]*[$#]/.test(value)) return "terminal-line-prompt";
    return "terminal-line-plain";
}
