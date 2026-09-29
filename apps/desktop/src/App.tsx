import {
  Activity,
  Check,
  Copy,
  Download,
  FileText,
  Upload,
  Layers3,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, DEFAULT_GATEWAY_URL, IS_TAURI } from "./api";
import type {
  AuditEntry,
  ConnectionTestResult,
  ConnectionTestState,
  CoreRuntimeStatus,
  LogEntry,
  LogLevel,
  McpImportApplyResult,
  McpImportPreview,
  McpImportPreviewCandidate,
  McpImportSourceInfo,
  ProfileApplyFailure,
  ProfileApplyResult,
  ProfileInfo,
  ServerConfigInfo,
  ServerStatus,
  StatusResponse,
  ToolInfo,
  UpdateDownloadEvent,
  UpdateMetadata,
  UpstreamInfo,
} from "./types";
import {
  coreRuntimeLabel,
  environmentToText,
  formatTime,
  headersToText,
  parseEnvironmentText,
  parseHeadersText,
  secretEnvironmentToText,
  serverIconFor,
  statusLabel,
  upstreamStatusLabel,
} from "./lib/format";
import { ProfileEditorModal } from "./components/ProfileEditorModal";
import { ImportConfigModal } from "./components/ImportConfigModal";
import { AddServerModal } from "./components/AddServerModal";
import { ToolTesterModal } from "./components/ToolTesterModal";
import { ToolsSection } from "./components/ToolsSection";
import { LogsSection } from "./components/LogsSection";
import { AuditSection } from "./components/AuditSection";
import { GatewayCard } from "./components/GatewayCard";
import { ServersSection } from "./components/ServersSection";
import { ServerDetailModal } from "./components/ServerDetailModal";
import { DeleteServerConfirm } from "./components/DeleteServerConfirm";
import { RestoreConfirm } from "./components/RestoreConfirm";
import { ProfilesSection } from "./components/ProfilesSection";
import { DeleteProfileConfirm } from "./components/DeleteProfileConfirm";
import { DesktopSettingsSection } from "./components/DesktopSettingsSection";

export function App() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [serverConfigs, setServerConfigs] = useState<ServerConfigInfo[]>([]);
  const [upstreams, setUpstreams] = useState<UpstreamInfo[]>([]);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [copied, setCopied] = useState(false);
  const [sseCopied, setSseCopied] = useState(false);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [gatewayKeyBusy, setGatewayKeyBusy] = useState(false);
  const [lanAccessBusy, setLanAccessBusy] = useState(false);
  const [generatedGatewayKey, setGeneratedGatewayKey] = useState<string | null>(null);
  const [gatewayKeyCopied, setGatewayKeyCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logLevel, setLogLevel] = useState<"all" | LogLevel>("all");
  const [logSource, setLogSource] = useState("all");
  const [logQuery, setLogQuery] = useState("");
  const [logsCopied, setLogsCopied] = useState(false);
  const [managementConnected, setManagementConnected] = useState(false);
  const [coreRuntime, setCoreRuntime] = useState<CoreRuntimeStatus | null>(null);
  const [coreRestarting, setCoreRestarting] = useState(false);
  const [autostartEnabled, setAutostartEnabled] = useState<boolean | null>(null);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<UpdateMetadata | null>(null);
  const [updateBusy, setUpdateBusy] = useState<"checking" | "installing" | null>(null);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [showAddServer, setShowAddServer] = useState(false);
  const [showImportConfig, setShowImportConfig] = useState(false);
  const [importSources, setImportSources] = useState<McpImportSourceInfo[]>([]);
  const [importSourceId, setImportSourceId] = useState<string | null>(null);
  const [importSourceSnapshot, setImportSourceSnapshot] = useState<McpImportSourceInfo | null>(null);
  const [importConfigText, setImportConfigText] = useState("");
  const [importPreview, setImportPreview] = useState<McpImportPreview | null>(null);
  const [importApplyResult, setImportApplyResult] = useState<McpImportApplyResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileServerIds, setProfileServerIds] = useState<string[]>([]);
  const [profileBusy, setProfileBusy] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [newServerName, setNewServerName] = useState("");
  const [newServerTransport, setNewServerTransport] = useState<"stdio" | "http">("stdio");
  const [newServerCommand, setNewServerCommand] = useState("");
  const [newServerArgs, setNewServerArgs] = useState("");
  const [newServerCwd, setNewServerCwd] = useState("");
  const [deletingServerId, setDeletingServerId] = useState<string | null>(null);
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState<"export" | "restore" | null>(null);
  const [sessionSettingBusy, setSessionSettingBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [restoreCandidate, setRestoreCandidate] = useState<unknown | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const [newServerEnv, setNewServerEnv] = useState("");
  const [newServerSecretEnv, setNewServerSecretEnv] = useState("");
  const [newServerUrl, setNewServerUrl] = useState("");
  const [newServerHeaders, setNewServerHeaders] = useState("");
  const [configBusy, setConfigBusy] = useState(false);
  const [connectionTestBusy, setConnectionTestBusy] = useState(false);
  const [connectionTestState, setConnectionTestState] =
    useState<ConnectionTestState | null>(null);
  const [testTool, setTestTool] = useState<ToolInfo | null>(null);
  const [testToolArgs, setTestToolArgs] = useState("{}");
  const [testToolResult, setTestToolResult] = useState("");
  const [testToolBusy, setTestToolBusy] = useState(false);
  const logPanelRef = useRef<HTMLDivElement | null>(null);
  const logFollowRef = useRef(true);
  const [logFollow, setLogFollow] = useState(true);
  const liveRefreshInFlight = useRef(false);
  const catalogRefreshInFlight = useRef(false);
  const managementConnectedRef = useRef(false);
  const lastLogSeqRef = useRef(0);
  const lastAuditSeqRef = useRef(0);
  const coreStartedAtRef = useRef<string | null>(null);

  const refreshDesktopPreferences = useCallback(async () => {
    if (!IS_TAURI) return;

    try {
      const enabled = await invoke<boolean>("autostart_enabled");
      setAutostartEnabled(enabled);
    } catch {
      setAutostartEnabled(null);
    }
  }, []);

  const refreshCoreRuntime = useCallback(async () => {
    if (!IS_TAURI) return;

    try {
      const runtime = await invoke<CoreRuntimeStatus>("core_runtime_status");
      setCoreRuntime(runtime);
    } catch {
      setCoreRuntime(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [statusResult, configsResult, upstreamsResult, profilesResult, toolsResult, logsResult, auditResult] = await Promise.all([
        api<StatusResponse>("/api/status"),
        api<{ servers: ServerConfigInfo[] }>("/api/server-configs"),
        api<{ upstreams: UpstreamInfo[] }>("/api/upstreams"),
        api<{ profiles: ProfileInfo[]; activeProfileId: string | null }>("/api/profiles"),
        api<{ tools: ToolInfo[] }>("/api/tools"),
        api<{ entries: LogEntry[] }>("/api/logs?limit=500"),
        api<{ entries: AuditEntry[] }>("/api/audit?limit=120"),
      ]);
      setStatus(statusResult);
      setServerConfigs(configsResult.servers);
      setUpstreams(upstreamsResult.upstreams);
      setProfiles(profilesResult.profiles);
      setActiveProfileId(profilesResult.activeProfileId);
      setTools(toolsResult.tools);
      setLogs(logsResult.entries);
      setAuditEntries(auditResult.entries);
      lastLogSeqRef.current = logsResult.entries.at(-1)?.seq ?? 0;
      lastAuditSeqRef.current = auditResult.entries.at(-1)?.seq ?? 0;
      coreStartedAtRef.current = statusResult.core.startedAt;
      managementConnectedRef.current = true;
      setManagementConnected(true);
      setError(null);
    } catch (cause) {
      managementConnectedRef.current = false;
      setManagementConnected(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      void refreshCoreRuntime();
      void refreshDesktopPreferences();
    }
  }, [refreshCoreRuntime, refreshDesktopPreferences]);

  const refreshLiveState = useCallback(async () => {
    if (liveRefreshInFlight.current) return;
    liveRefreshInFlight.current = true;

    if (!managementConnectedRef.current) {
      try {
        await refresh();
      } finally {
        liveRefreshInFlight.current = false;
        void refreshCoreRuntime();
      }
      return;
    }

    try {
      const [statusResult, upstreamsResult] = await Promise.all([
        api<StatusResponse>("/api/status"),
        api<{ upstreams: UpstreamInfo[] }>("/api/upstreams"),
      ]);

      const coreRestarted =
        coreStartedAtRef.current !== null &&
        coreStartedAtRef.current !== statusResult.core.startedAt;

      const [logsResult, auditResult] = await Promise.all([
        api<{ entries: LogEntry[] }>(
          coreRestarted
            ? "/api/logs?limit=500"
            : `/api/logs?after=${lastLogSeqRef.current}&limit=200`,
        ),
        api<{ entries: AuditEntry[] }>(
          coreRestarted
            ? "/api/audit?limit=120"
            : `/api/audit?after=${lastAuditSeqRef.current}&limit=120`,
        ),
      ]);

      setStatus(statusResult);
      setUpstreams(upstreamsResult.upstreams);

      if (coreRestarted) {
        setLogs(logsResult.entries);
        setAuditEntries(auditResult.entries);
      } else {
        if (logsResult.entries.length > 0) {
          setLogs((current) => [...current, ...logsResult.entries].slice(-500));
        }
        if (auditResult.entries.length > 0) {
          setAuditEntries((current) => [...current, ...auditResult.entries].slice(-120));
        }
      }

      lastLogSeqRef.current = logsResult.entries.at(-1)?.seq ?? lastLogSeqRef.current;
      lastAuditSeqRef.current = auditResult.entries.at(-1)?.seq ?? lastAuditSeqRef.current;
      coreStartedAtRef.current = statusResult.core.startedAt;

      setManagementConnected(true);
      setError(null);
    } catch (cause) {
      managementConnectedRef.current = false;
      setManagementConnected(false);
      setError((current) => current ?? (cause instanceof Error ? cause.message : String(cause)));
    } finally {
      liveRefreshInFlight.current = false;
      void refreshCoreRuntime();
    }
  }, [refresh, refreshCoreRuntime]);
  const refreshCatalog = useCallback(async () => {
    if (catalogRefreshInFlight.current) return;
    catalogRefreshInFlight.current = true;

    try {
      const [configsResult, profilesResult, toolsResult] = await Promise.all([
        api<{ servers: ServerConfigInfo[] }>("/api/server-configs"),
        api<{ profiles: ProfileInfo[]; activeProfileId: string | null }>("/api/profiles"),
        api<{ tools: ToolInfo[] }>("/api/tools"),
      ]);
      setServerConfigs(configsResult.servers);
      setProfiles(profilesResult.profiles);
      setActiveProfileId(profilesResult.activeProfileId);
      setTools(toolsResult.tools);
      setError(null);
    } catch (cause) {
      setError((current) => current ?? (cause instanceof Error ? cause.message : String(cause)));
    } finally {
      catalogRefreshInFlight.current = false;
      void refreshDesktopPreferences();
    }
  }, [refreshDesktopPreferences]);

  useEffect(() => {
    void refresh();

    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refreshLiveState();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void refreshLiveState();
      void refreshCatalog();
    };
    const liveTimer = window.setInterval(refreshWhenVisible, 2000);
    const catalogTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshCatalog();
      }
    }, 10_000);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(liveTimer);
      window.clearInterval(catalogTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refresh, refreshCatalog, refreshLiveState]);

  useEffect(() => {
    const el = logPanelRef.current;
    // 只在用户本来就贴着底部时才自动跟随，避免轮询刷新打断回看历史
    if (!el || !logFollowRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [logs, logLevel, logSource, logQuery]);

  function handleLogScroll() {
    const el = logPanelRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    logFollowRef.current = atBottom;
    setLogFollow(atBottom);
  }

  function scrollLogsToBottom() {
    const el = logPanelRef.current;
    if (!el) return;
    logFollowRef.current = true;
    setLogFollow(true);
    el.scrollTop = el.scrollHeight;
  }

  // Esc 关闭最上层弹窗；关闭逻辑与各弹窗的背景点击保持一致
  const anyModalOpen =
    Boolean(testTool) ||
    showProfileEditor ||
    showImportConfig ||
    showAddServer ||
    Boolean(deletingProfileId) ||
    Boolean(deletingServerId) ||
    Boolean(selectedServerId) ||
    Boolean(restoreCandidate);

  useEffect(() => {
    if (!anyModalOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (testTool) {
        setTestTool(null);
      } else if (showProfileEditor) {
        setShowProfileEditor(false);
        setEditingProfileId(null);
      } else if (showImportConfig) {
        if (importBusy) return;
        setShowImportConfig(false);
        setImportPreview(null);
        setImportApplyResult(null);
        setImportSourceId(null);
        setImportSourceSnapshot(null);
      } else if (showAddServer) {
        setShowAddServer(false);
        setEditingServerId(null);
      } else if (deletingProfileId) {
        setDeletingProfileId(null);
      } else if (deletingServerId) {
        setDeletingServerId(null);
      } else if (selectedServerId) {
        setSelectedServerId(null);
      } else if (restoreCandidate) {
        setRestoreCandidate(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    anyModalOpen,
    testTool,
    showProfileEditor,
    showImportConfig,
    importBusy,
    showAddServer,
    deletingProfileId,
    deletingServerId,
    selectedServerId,
    restoreCandidate,
  ]);

  const gatewayUrl = status?.gateway.endpoint ?? DEFAULT_GATEWAY_URL;
  // 旧版 MCP HTTP+SSE 客户端（部分 IDE/客户端仍用 SSE 传输）连接同一聚合 Server 的入口。
  const gatewaySseUrl = gatewayUrl.replace(/\/mcp$/, "/sse");

  const toolPageSize = 10;
  const [toolSearch, setToolSearch] = useState("");
  const [toolPage, setToolPage] = useState(1);
  const filteredTools = useMemo(() => {
    const query = toolSearch.trim().toLowerCase();
    if (!query) return tools;
    return tools.filter(
      (tool) =>
        tool.publicName.toLowerCase().includes(query) ||
        tool.serverAlias.toLowerCase().includes(query) ||
        tool.definition.description?.toLowerCase().includes(query),
    );
  }, [tools, toolSearch]);
  const totalToolPages = Math.max(1, Math.ceil(filteredTools.length / toolPageSize));
  const safeToolPage = Math.min(toolPage, totalToolPages);
  const pagedTools = useMemo(() => {
    const start = (safeToolPage - 1) * toolPageSize;
    return filteredTools.slice(start, start + toolPageSize);
  }, [filteredTools, safeToolPage]);

  useEffect(() => {
    setToolPage(1);
  }, [toolSearch]);

  async function restartManagedCore() {
    if (!IS_TAURI) return;

    setCoreRestarting(true);
    setError(null);
    try {
      const runtime = await invoke<CoreRuntimeStatus>("restart_core");
      setCoreRuntime(runtime);
      await new Promise((resolve) => window.setTimeout(resolve, 600));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCoreRestarting(false);
    }
  }

  async function toggleAutostart() {
    if (!IS_TAURI || autostartBusy || autostartEnabled === null) return;

    setAutostartBusy(true);
    setError(null);
    try {
      const enabled = await invoke<boolean>("set_autostart", {
        enabled: !autostartEnabled,
      });
      setAutostartEnabled(enabled);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAutostartBusy(false);
    }
  }

  async function checkForUpdate() {
    if (!IS_TAURI || updateBusy) return;

    setUpdateBusy("checking");
    setUpdateMessage(null);
    setUpdateError(null);
    try {
      const update = await invoke<UpdateMetadata | null>("check_for_update");
      setAvailableUpdate(update);
      setUpdateMessage(
        update
          ? `发现新版本 ${update.version}，当前版本 ${update.currentVersion}。`
          : "当前已是最新版本。",
      );
    } catch (cause) {
      setUpdateError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUpdateBusy(null);
    }
  }

  async function installAvailableUpdate() {
    if (!IS_TAURI || !availableUpdate || updateBusy) return;

    setUpdateBusy("installing");
    setUpdateMessage(`正在下载并安装 ${availableUpdate.version}…`);
    setUpdateError(null);
    try {
      let downloaded = 0;
      let contentLength: number | null = null;
      const onEvent = new Channel<UpdateDownloadEvent>();
      onEvent.onmessage = (event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength;
          setUpdateMessage(
            contentLength
              ? `正在下载 ${availableUpdate.version}：0%`
              : `正在下载 ${availableUpdate.version}…`,
          );
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setUpdateMessage(
            contentLength
              ? `正在下载 ${availableUpdate.version}：${Math.min(100, Math.round((downloaded / contentLength) * 100))}%`
              : `正在下载 ${availableUpdate.version}：${(downloaded / 1024 / 1024).toFixed(1)} MB`,
          );
        } else {
          setUpdateMessage("下载完成，正在验证并安装…");
        }
      };

      await invoke("install_update", {
        expectedVersion: availableUpdate.version,
        onEvent,
      });
    } catch (cause) {
      setUpdateError(cause instanceof Error ? cause.message : String(cause));
      setUpdateMessage(null);
      setUpdateBusy(null);
    }
  }

  async function copyGatewayUrl() {
    await navigator.clipboard.writeText(gatewayUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  async function copyGatewaySseUrl() {
    await navigator.clipboard.writeText(gatewaySseUrl);
    setSseCopied(true);
    window.setTimeout(() => setSseCopied(false), 1200);
  }

  async function rotateGatewayApiKey() {
    setGatewayKeyBusy(true);
    setError(null);
    try {
      const response = await api<{
        access: { enabled: boolean; ready: boolean; lastError: string | null };
        apiKey: string;
      }>(
        "/api/gateway-access/rotate",
        { method: "POST", body: "{}" },
        15_000,
      );

      setGeneratedGatewayKey(response.apiKey);
      await navigator.clipboard.writeText(response.apiKey);
      setGatewayKeyCopied(true);
      window.setTimeout(() => setGatewayKeyCopied(false), 1600);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setGatewayKeyBusy(false);
    }
  }

  async function toggleLanAccess() {
    const nextEnabled = !Boolean(status?.gateway.lanEnabled);
    setLanAccessBusy(true);
    setError(null);
    try {
      await api(
        "/api/gateway-access/lan",
        {
          method: "POST",
          body: JSON.stringify({ enabled: nextEnabled }),
        },
        20_000,
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
    } finally {
      setLanAccessBusy(false);
    }
  }

  async function updateSessionIdleTimeout(minutes: number) {
    setSessionSettingBusy(true);
    setError(null);
    setBackupMessage(null);
    try {
      await api(
        "/api/session-settings",
        {
          method: "POST",
          body: JSON.stringify({ idleTimeoutMs: minutes * 60_000 }),
        },
        15_000,
      );
      if (IS_TAURI) {
        setBackupMessage("会话生命周期已保存，正在重启 Core…");
        await restartManagedCore();
      } else {
        setBackupMessage("会话生命周期已保存，请重启 Core 后生效。");
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
    } finally {
      setSessionSettingBusy(false);
    }
  }

  async function exportConfigurationBackup() {
    setBackupBusy("export");
    setBackupMessage(null);
    setError(null);
    try {
      const response = await api<{ backup: unknown }>(
        "/api/backup/export",
        undefined,
        15_000,
      );
      const blob = new Blob(
        [JSON.stringify(response.backup, null, 2)],
        { type: "application/json;charset=utf-8" },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `mcp-gate-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setBackupMessage("配置备份已导出。Secret 值不会包含在备份中。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBackupBusy(null);
    }
  }

  function selectBackupFile(file: File | undefined) {
    if (!file) return;
    void file.text()
      .then((raw) => {
        const parsed = JSON.parse(raw) as unknown;
        setRestoreCandidate(parsed);
        setBackupMessage(null);
      })
      .catch((cause) => {
        setError(`备份文件读取失败：${cause instanceof Error ? cause.message : String(cause)}`);
      });
  }

  async function restoreConfigurationBackup() {
    if (!restoreCandidate) return;
    setBackupBusy("restore");
    setError(null);
    try {
      await api(
        "/api/backup/restore",
        {
          method: "POST",
          body: JSON.stringify({ backup: restoreCandidate }),
        },
        20_000,
      );
      setRestoreCandidate(null);
      setBackupMessage(
        IS_TAURI
          ? "配置已恢复，正在重启 Core 使配置生效…"
          : "配置已恢复。请重启 Core 使配置生效。",
      );
      if (IS_TAURI) {
        await restartManagedCore();
      } else {
        await refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBackupBusy(null);
      if (backupInputRef.current) backupInputRef.current.value = "";
    }
  }

  async function disableGatewayApiKey() {
    setGatewayKeyBusy(true);
    setError(null);
    try {
      await api(
        "/api/gateway-access/disable",
        { method: "POST", body: "{}" },
        15_000,
      );
      setGeneratedGatewayKey(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setGatewayKeyBusy(false);
    }
  }

  async function copyDiagnosticsSnapshot() {
    setDiagnosticsBusy(true);
    setError(null);
    try {
      const response = await api<{ snapshot: unknown }>(
        "/api/diagnostics",
        undefined,
        10_000,
      );
      await navigator.clipboard.writeText(
        JSON.stringify(response.snapshot, null, 2),
      );
      setDiagnosticsCopied(true);
      window.setTimeout(() => setDiagnosticsCopied(false), 1600);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDiagnosticsBusy(false);
    }
  }

  async function refreshImportSources() {
    try {
      const response = await api<{ sources: McpImportSourceInfo[] }>(
        "/api/import/mcp-config/sources",
        {
          method: "POST",
          body: "{}",
        },
        10_000,
      );
      setImportSources(response.sources);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function openImportConfig() {
    setImportConfigText("");
    setImportPreview(null);
    setImportApplyResult(null);
    setImportSourceId(null);
    setImportSourceSnapshot(null);
    setShowImportConfig(true);
    void refreshImportSources();
  }

  async function previewImportSource(sourceId: string) {
    setImportBusy(true);
    setError(null);
    setImportApplyResult(null);
    try {
      const response = await api<{
        source: McpImportSourceInfo;
        preview: McpImportPreview;
      }>(
        "/api/import/mcp-config/source-preview",
        {
          method: "POST",
          body: JSON.stringify({ sourceId }),
        },
        15_000,
      );
      setImportConfigText("");
      setImportSourceId(sourceId);
      setImportSourceSnapshot(response.source);
      setImportPreview(response.preview);
      await refreshImportSources();
    } catch (cause) {
      setImportSourceId(null);
      setImportSourceSnapshot(null);
      setImportPreview(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImportBusy(false);
    }
  }

  function parseImportConfig(): unknown {
    if (!importConfigText.trim()) {
      throw new Error("请粘贴 MCP JSON 配置");
    }
    try {
      return JSON.parse(importConfigText) as unknown;
    } catch (cause) {
      throw new Error(
        `JSON 格式错误：${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  async function previewImportConfig() {
    setImportBusy(true);
    setError(null);
    setImportApplyResult(null);
    try {
      const config = parseImportConfig();
      const response = await api<{ preview: McpImportPreview }>(
        "/api/import/mcp-config/preview",
        {
          method: "POST",
          body: JSON.stringify({ config }),
        },
        15_000,
      );
      setImportPreview(response.preview);
    } catch (cause) {
      setImportPreview(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImportBusy(false);
    }
  }

  async function applyImportConfig() {
    setImportBusy(true);
    setError(null);
    try {
      const response = importSourceId
        ? await api<{ result: McpImportApplyResult }>(
            "/api/import/mcp-config/source-apply",
            {
              method: "POST",
              body: JSON.stringify({
                sourceId: importSourceId,
                expectedModifiedAt: importSourceSnapshot?.modifiedAt,
              }),
            },
            60_000,
          )
        : await api<{ result: McpImportApplyResult }>(
            "/api/import/mcp-config/apply",
            {
              method: "POST",
              body: JSON.stringify({ config: parseImportConfig() }),
            },
            60_000,
          );

      setImportApplyResult(response.result);
      await refresh();

      if (
        response.result.failed.length === 0 &&
        response.result.issues.length === 0
      ) {
        setShowImportConfig(false);
        setImportPreview(null);
        setImportApplyResult(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImportBusy(false);
    }
  }

  function openCreateProfile() {
    setEditingProfileId(null);
    setProfileName("");
    setProfileServerIds([]);
    setShowProfileEditor(true);
  }

  function openEditProfile(profile: ProfileInfo) {
    setEditingProfileId(profile.id);
    setProfileName(profile.name);
    setProfileServerIds([...profile.serverIds]);
    setShowProfileEditor(true);
  }

  function toggleProfileServer(serverId: string) {
    setProfileServerIds((current) =>
      current.includes(serverId)
        ? current.filter((id) => id !== serverId)
        : [...current, serverId],
    );
  }

  async function saveProfile() {
    setProfileBusy(true);
    setError(null);
    try {
      const response = await api<{
        activeProfileId?: string | null;
        result?: ProfileApplyResult;
      }>(
        editingProfileId ? `/api/profiles/${editingProfileId}` : "/api/profiles",
        {
          method: "POST",
          body: JSON.stringify({
            name: profileName,
            serverIds: profileServerIds,
          }),
        },
      );

      if (response.activeProfileId !== undefined) {
        setActiveProfileId(response.activeProfileId);
      }
      if (response.result?.failed.length) {
        setError(
          `Profile 已保存，但重算运行集合时有 ${response.result.failed.length} 个 MCP 失败：${response.result.failed
            .map((item) => {
              const server = serverConfigs.find((server) => server.id === item.serverId);
              return `${server?.name ?? item.serverId}: ${item.error}`;
            })
            .join("；")}`,
        );
      }

      setShowProfileEditor(false);
      setEditingProfileId(null);
      setProfileName("");
      setProfileServerIds([]);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setProfileBusy(false);
    }
  }

  async function profileAction(
    profileId: string,
    action: "activate" | "deactivate",
  ) {
    setBusy(`profile:${profileId}:${action}`);
    setError(null);
    try {
      const response = await api<{
        activeProfileId: string | null;
        result: ProfileApplyResult;
      }>(
        `/api/profiles/${profileId}/${action}`,
        {
          method: "POST",
          body: "{}",
        },
        120_000,
      );

      setActiveProfileId(response.activeProfileId);
      if (response.result.failed.length > 0) {
        setError(
          `Profile 已应用，但有 ${response.result.failed.length} 个 MCP 失败：${response.result.failed
            .map((item) => {
              const server = serverConfigs.find((server) => server.id === item.serverId);
              return `${server?.name ?? item.serverId}: ${item.error}`;
            })
            .join("；")}`,
        );
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function quickSwitchProfile(nextProfileId: string) {
    if (busy?.startsWith("profile:")) return;
    if (nextProfileId === activeProfileId) return;

    if (!nextProfileId) {
      if (activeProfileId) {
        await profileAction(activeProfileId, "deactivate");
      }
      return;
    }

    await profileAction(nextProfileId, "activate");
  }

  async function removeProfile(profileId: string) {
    setProfileBusy(true);
    setError(null);
    try {
      const response = await api<{
        activeProfileId: string | null;
        result?: ProfileApplyResult;
      }>(`/api/profiles/${profileId}`, { method: "DELETE" });

      setActiveProfileId(response.activeProfileId);
      if (response.result?.failed.length) {
        setError(
          `Profile 已删除，但停用成员时有 ${response.result.failed.length} 个 MCP 失败。`,
        );
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setProfileBusy(false);
      setDeletingProfileId(null);
    }
  }

  function openCreateServer() {
    setEditingServerId(null);
    setNewServerName("");
    setNewServerTransport("stdio");
    setNewServerCommand("");
    setNewServerArgs("");
    setNewServerCwd("");
    setNewServerEnv("");
    setNewServerSecretEnv("");
    setNewServerUrl("");
    setNewServerHeaders("");
    setConnectionTestState(null);
    setShowAddServer(true);
  }

  function openEditServer(server: ServerConfigInfo) {
    setEditingServerId(server.id);
    setNewServerName(server.name);
    setNewServerTransport(server.transport);
    setNewServerCommand(server.command ?? "");
    setNewServerArgs((server.args ?? []).join("\n"));
    setNewServerCwd(server.cwd ?? "");
    setNewServerEnv(environmentToText(server.env));
    setNewServerSecretEnv(secretEnvironmentToText(server.secretEnvKeys));
    setNewServerUrl(server.url ?? "");
    // Every header is plaintext config, Authorization included, so all of them
    // are editable here rather than hidden behind a separate secret field.
    setNewServerHeaders(headersToText(server.headers));
    setConnectionTestState(null);
    setShowAddServer(true);
  }

  async function testServerConnection() {
    setConnectionTestBusy(true);
    setConnectionTestState(null);

    try {
      const plainEnv =
        newServerTransport === "stdio"
          ? parseEnvironmentText(newServerEnv)
          : {};
      const secretEnv =
        newServerTransport === "stdio"
          ? parseEnvironmentText(newServerSecretEnv)
          : {};
      const secretEnvKeys = Object.keys(secretEnv);

      for (const key of Object.keys(plainEnv)) {
        if (secretEnvKeys.includes(key)) {
          throw new Error(
            `环境变量 ${key} 不能同时是普通变量和 Secret`,
          );
        }
      }

      const response = await api<{ result: ConnectionTestResult }>(
        "/api/server-configs/test-connection",
        {
          method: "POST",
          body: JSON.stringify({
            serverId: editingServerId ?? undefined,
            transport: newServerTransport,
            command:
              newServerTransport === "stdio"
                ? newServerCommand
                : undefined,
            args:
              newServerTransport === "stdio"
                ? newServerArgs
                    .split("\n")
                    .map((value) => value.trim())
                    .filter(Boolean)
                : undefined,
            cwd:
              newServerTransport === "stdio"
                ? newServerCwd.trim() || undefined
                : undefined,
            env: newServerTransport === "stdio" ? plainEnv : undefined,
            secretEnvKeys:
              newServerTransport === "stdio"
                ? secretEnvKeys
                : undefined,
            secretEnv:
              newServerTransport === "stdio"
                ? secretEnv
                : undefined,
            url:
              newServerTransport === "http"
                ? newServerUrl.trim()
                : undefined,
            headers:
              newServerTransport === "http"
                ? parseHeadersText(newServerHeaders)
                : undefined,
          }),
        },
        90_000,
      );

      setConnectionTestState({
        status: "success",
        result: response.result,
      });
    } catch (cause) {
      setConnectionTestState({
        status: "error",
        error: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setConnectionTestBusy(false);
    }
  }

  async function saveServerConfig() {
    setConfigBusy(true);
    setError(null);
    let createdServerId: string | null = null;

    try {
      const plainEnv =
        newServerTransport === "stdio"
          ? parseEnvironmentText(newServerEnv)
          : {};
      const secretEnv =
        newServerTransport === "stdio"
          ? parseEnvironmentText(newServerSecretEnv)
          : {};
      const secretEnvKeys = Object.keys(secretEnv);

      for (const key of Object.keys(plainEnv)) {
        if (secretEnvKeys.includes(key)) {
          throw new Error(`环境变量 ${key} 不能同时是普通变量和 Secret`);
        }
      }

      const response = await api<{ server: ServerConfigInfo }>(
        editingServerId
          ? `/api/server-configs/${editingServerId}`
          : "/api/server-configs",
        {
          method: "POST",
          body: JSON.stringify({
            name: newServerName,
            transport: newServerTransport,
            command: newServerTransport === "stdio" ? newServerCommand : undefined,
            args: newServerTransport === "stdio"
              ? newServerArgs.split("\n").map((value) => value.trim()).filter(Boolean)
              : undefined,
            cwd: newServerTransport === "stdio" ? (newServerCwd.trim() || undefined) : undefined,
            url: newServerTransport === "http" ? newServerUrl.trim() : undefined,
            headers:
              newServerTransport === "http"
                ? parseHeadersText(newServerHeaders)
                : undefined,
          }),
        },
      );

      if (!editingServerId) {
        createdServerId = response.server.id;
      }

      if (newServerTransport === "stdio") {
        await api<{ server: ServerConfigInfo }>(
          `/api/server-configs/${response.server.id}/environment`,
          {
            method: "POST",
            body: JSON.stringify({
              env: plainEnv,
              secretEnvKeys,
              secretEnv,
            }),
          },
        );
      }

      setShowAddServer(false);
      setEditingServerId(null);
      setNewServerName("");
      setNewServerTransport("stdio");
      setNewServerCommand("");
      setNewServerArgs("");
      setNewServerCwd("");
      setNewServerEnv("");
      setNewServerSecretEnv("");
      setNewServerUrl("");
      setNewServerHeaders("");
      setConnectionTestState(null);
      await refresh();
    } catch (cause) {
      if (createdServerId) {
        await api(`/api/server-configs/${createdServerId}`, {
          method: "DELETE",
        }).catch(() => undefined);
      }
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
    } finally {
      setConfigBusy(false);
    }
  }

  async function upstreamAction(
    serverId: string,
    action: "connect" | "disconnect" | "refresh-tools",
  ) {
    setBusy(`${serverId}:${action}`);
    setError(null);
    try {
      await api(
        `/api/upstreams/${serverId}/${action}`,
        {
          method: "POST",
          body: "{}",
        },
        action === "connect" ? 65_000 : 15_000,
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function updateServerSettings(
    serverId: string,
    patch: { enabled?: boolean; autoStart?: boolean },
  ) {
    setBusy(`${serverId}:settings`);
    setError(null);
    try {
      await api(
        `/api/server-configs/${serverId}/settings`,
        {
          method: "POST",
          body: JSON.stringify(patch),
        },
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function removeServerConfig(serverId: string) {
    setConfigBusy(true);
    setError(null);
    try {
      await api(`/api/server-configs/${serverId}`, { method: "DELETE" });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConfigBusy(false);
      setDeletingServerId(null);
    }
  }

  function openToolTester(tool: ToolInfo) {
    setTestTool(tool);
    setTestToolArgs("{}");
    setTestToolResult("");
  }

  async function runToolTest() {
    if (!testTool) return;

    setTestToolBusy(true);
    setTestToolResult("");
    setError(null);

    try {
      const args = JSON.parse(testToolArgs) as unknown;
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        throw new Error("参数必须是 JSON 对象");
      }

      const response = await api<{ result: unknown }>(
        `/api/tools/${testTool.publicName}/call`,
        {
          method: "POST",
          body: JSON.stringify({ arguments: args }),
        },
        65_000,
      );

      setTestToolResult(JSON.stringify(response.result, null, 2));
      await refresh();
    } catch (cause) {
      setTestToolResult(
        JSON.stringify(
          {
            error: cause instanceof Error ? cause.message : String(cause),
          },
          null,
          2,
        ),
      );
    } finally {
      setTestToolBusy(false);
    }
  }

  async function toggleTool(tool: ToolInfo) {
    setBusy(`tool:${tool.publicName}`);
    setError(null);
    try {
      await api(
        `/api/tools/${tool.publicName}/${tool.enabled ? "disable" : "enable"}`,
        { method: "POST", body: "{}" },
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  const gatewayState = managementConnected ? (status?.gateway.status ?? "stopped") : "error";
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null;
  const profileSwitchBusy = busy?.startsWith("profile:") ?? false;
  const runningCount = upstreams.filter((upstream) => upstream.status === "running").length;
  const enabledToolCount = tools.filter((tool) => tool.enabled).length;
  const deletingServer = deletingServerId
    ? serverConfigs.find((item) => item.id === deletingServerId) ?? null
    : null;
  const logSources = useMemo(
    () =>
      [...new Set(logs.map((entry) => entry.source))]
        .sort((a, b) => a.localeCompare(b)),
    [logs],
  );

  const visibleLogs = useMemo(() => {
    const query = logQuery.trim().toLowerCase();

    return logs.filter((entry) => {
      if (logLevel !== "all" && entry.level !== logLevel) return false;
      if (logSource !== "all" && entry.source !== logSource) return false;
      if (!query) return true;

      return (
        entry.message.toLowerCase().includes(query) ||
        entry.source.toLowerCase().includes(query) ||
        entry.level.toLowerCase().includes(query)
      );
    });
  }, [logs, logLevel, logSource, logQuery]);

  async function copyVisibleLogs() {
    const text = visibleLogs
      .map(
        (entry) =>
          `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.source} ${entry.message}`,
      )
      .join("\n");

    await navigator.clipboard.writeText(text);
    setLogsCopied(true);
    window.setTimeout(() => setLogsCopied(false), 1400);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">LOCAL MCP GATEWAY</div>
          <h1>MCP Gate</h1>
        </div>
      </header>

      {error && (
        <div className="errorBanner">
          <strong>运行异常</strong>
          <span>{error}</span>
          <div className="errorActions">
            {IS_TAURI && (
              <button
                disabled={coreRestarting}
                onClick={() => void restartManagedCore()}
              >
                {coreRestarting ? "重启中…" : "重启 Core"}
              </button>
            )}
            <button onClick={() => void refresh()}>重试</button>
          </div>
        </div>
      )}

      <GatewayCard activeProfile={activeProfile} activeProfileId={activeProfileId} copied={copied} copyGatewaySseUrl={copyGatewaySseUrl} copyGatewayUrl={copyGatewayUrl} coreRuntime={coreRuntime} enabledToolCount={enabledToolCount} gatewaySseUrl={gatewaySseUrl} gatewayState={gatewayState} gatewayUrl={gatewayUrl} profileSwitchBusy={profileSwitchBusy} profiles={profiles} quickSwitchProfile={quickSwitchProfile} refresh={refresh} runningCount={runningCount} serverConfigs={serverConfigs} sseCopied={sseCopied} />
      <ServersSection busy={busy} configBusy={configBusy} openCreateServer={openCreateServer} openEditServer={openEditServer} openImportConfig={openImportConfig} refresh={refresh} serverConfigs={serverConfigs} setDeletingServerId={setDeletingServerId} setSelectedServerId={setSelectedServerId} status={status} tools={tools} updateServerSettings={updateServerSettings} upstreamAction={upstreamAction} upstreams={upstreams} />
      {selectedServerId && (
        <ServerDetailModal logs={logs} selectedServerId={selectedServerId} serverConfigs={serverConfigs} setSelectedServerId={setSelectedServerId} status={status} upstreams={upstreams} />
      )}
      {deletingServerId && deletingServer && (
        <DeleteServerConfirm configBusy={configBusy} deletingServerId={deletingServerId} deletingServer={deletingServer} removeServerConfig={removeServerConfig} setDeletingServerId={setDeletingServerId} />
      )}
      {Boolean(restoreCandidate) && (
        <RestoreConfirm backupBusy={backupBusy} restoreCandidate={restoreCandidate} restoreConfigurationBackup={restoreConfigurationBackup} setRestoreCandidate={setRestoreCandidate} />
      )}
      <ProfilesSection activeProfileId={activeProfileId} busy={busy} openCreateProfile={openCreateProfile} openEditProfile={openEditProfile} profileAction={profileAction} profileBusy={profileBusy} profiles={profiles} serverConfigs={serverConfigs} setDeletingProfileId={setDeletingProfileId} status={status} upstreams={upstreams} />
      {deletingProfileId && (
        <DeleteProfileConfirm deletingProfileId={deletingProfileId} profileBusy={profileBusy} profiles={profiles} removeProfile={removeProfile} setDeletingProfileId={setDeletingProfileId} />
      )}







      <ToolsSection tools={tools} busy={busy} openToolTester={openToolTester} toggleTool={toggleTool} toolSearch={toolSearch} setToolSearch={setToolSearch} toolPage={toolPage} setToolPage={setToolPage} filteredTools={filteredTools} totalToolPages={totalToolPages} safeToolPage={safeToolPage} pagedTools={pagedTools} />
      <LogsSection logs={logs} error={error} status={status} refresh={refresh} logLevel={logLevel} setLogLevel={setLogLevel} logSource={logSource} setLogSource={setLogSource} logQuery={logQuery} setLogQuery={setLogQuery} logSources={logSources} visibleLogs={visibleLogs} logFollow={logFollow} setLogFollow={setLogFollow} logsCopied={logsCopied} copyVisibleLogs={copyVisibleLogs} logPanelRef={logPanelRef} handleLogScroll={handleLogScroll} scrollLogsToBottom={scrollLogsToBottom} />
      <AuditSection auditEntries={auditEntries} error={error} />



      <DesktopSettingsSection autostartBusy={autostartBusy} autostartEnabled={autostartEnabled} availableUpdate={availableUpdate} backupBusy={backupBusy} backupInputRef={backupInputRef} backupMessage={backupMessage} checkForUpdate={checkForUpdate} copyDiagnosticsSnapshot={copyDiagnosticsSnapshot} diagnosticsBusy={diagnosticsBusy} diagnosticsCopied={diagnosticsCopied} disableGatewayApiKey={disableGatewayApiKey} exportConfigurationBackup={exportConfigurationBackup} generatedGatewayKey={generatedGatewayKey} gatewayKeyBusy={gatewayKeyBusy} gatewayKeyCopied={gatewayKeyCopied} installAvailableUpdate={installAvailableUpdate} lanAccessBusy={lanAccessBusy} managementConnected={managementConnected} rotateGatewayApiKey={rotateGatewayApiKey} selectBackupFile={selectBackupFile} sessionSettingBusy={sessionSettingBusy} setGeneratedGatewayKey={setGeneratedGatewayKey} setRestoreCandidate={setRestoreCandidate} status={status} toggleAutostart={toggleAutostart} toggleLanAccess={toggleLanAccess} updateBusy={updateBusy} updateError={updateError} updateMessage={updateMessage} updateSessionIdleTimeout={updateSessionIdleTimeout} />
      {showProfileEditor && (
        <ProfileEditorModal
          editingProfileId={editingProfileId}
          profileBusy={profileBusy}
          profileName={profileName}
          profileServerIds={profileServerIds}
          saveProfile={saveProfile}
          serverConfigs={serverConfigs}
          setEditingProfileId={setEditingProfileId}
          setProfileName={setProfileName}
          setProfileServerIds={setProfileServerIds}
          setShowProfileEditor={setShowProfileEditor}
          status={status}
          toggleProfileServer={toggleProfileServer}
          upstreams={upstreams}
        />
      )}
      {showImportConfig && (
        <ImportConfigModal
          applyImportConfig={applyImportConfig}
          importApplyResult={importApplyResult}
          importBusy={importBusy}
          importConfigText={importConfigText}
          importPreview={importPreview}
          importSourceId={importSourceId}
          importSources={importSources}
          previewImportConfig={previewImportConfig}
          previewImportSource={previewImportSource}
          refreshImportSources={refreshImportSources}
          setImportApplyResult={setImportApplyResult}
          setImportConfigText={setImportConfigText}
          setImportPreview={setImportPreview}
          setImportSourceId={setImportSourceId}
          setImportSourceSnapshot={setImportSourceSnapshot}
          setShowImportConfig={setShowImportConfig}
        />
      )}
      {showAddServer && (
        <AddServerModal
          configBusy={configBusy}
          connectionTestState={connectionTestState}
          setConnectionTestState={setConnectionTestState}
          connectionTestBusy={connectionTestBusy}
          editingServerId={editingServerId}
          newServerArgs={newServerArgs}
          newServerCommand={newServerCommand}
          newServerCwd={newServerCwd}
          newServerEnv={newServerEnv}
          newServerHeaders={newServerHeaders}
          newServerName={newServerName}
          newServerSecretEnv={newServerSecretEnv}
          newServerTransport={newServerTransport}
          newServerUrl={newServerUrl}
          saveServerConfig={saveServerConfig}
          setEditingServerId={setEditingServerId}
          setNewServerArgs={setNewServerArgs}
          setNewServerCommand={setNewServerCommand}
          setNewServerCwd={setNewServerCwd}
          setNewServerEnv={setNewServerEnv}
          setNewServerHeaders={setNewServerHeaders}
          setNewServerName={setNewServerName}
          setNewServerSecretEnv={setNewServerSecretEnv}
          setNewServerTransport={setNewServerTransport}
          setNewServerUrl={setNewServerUrl}
          setShowAddServer={setShowAddServer}
          status={status}
          testServerConnection={testServerConnection}
        />
      )}
      {testTool && (
        <ToolTesterModal
          runToolTest={runToolTest}
          setTestTool={setTestTool}
          setTestToolArgs={setTestToolArgs}
          testTool={testTool}
          testToolArgs={testToolArgs}
          testToolBusy={testToolBusy}
          testToolResult={testToolResult}
        />
      )}





      <footer>
        <span><Activity size={12} /> Profiles</span>
        <span>统一 /mcp · Profiles · Recovery · Secure Secrets</span>
      </footer>
    </main>
  );
}
