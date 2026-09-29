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

      <section className="gatewayCard">
        <div className="cardHeader">
          <div>
            <span className={`statusDot ${gatewayState}`} />
            <span className="statusText">Gateway {statusLabel(gatewayState)}</span>
          </div>
          <button className="ghostButton" onClick={() => void refresh()}>
            <RefreshCw size={15} />
            刷新
          </button>
        </div>

        <div className="endpointRow">
          <span className="endpointLabel">Streamable HTTP</span>
          <code>{gatewayUrl}</code>
          <button className="copyButton" onClick={() => void copyGatewayUrl()}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "已复制" : "复制"}
          </button>
        </div>

        <div className="endpointRow secondary">
          <span className="endpointLabel">
            SSE 兼容
            <small>旧版客户端用这个地址</small>
          </span>
          <code>{gatewaySseUrl}</code>
          <button className="copyButton" onClick={() => void copyGatewaySseUrl()}>
            {sseCopied ? <Check size={15} /> : <Copy size={15} />}
            {sseCopied ? "已复制" : "复制"}
          </button>
        </div>

        <div className="profileQuickSwitch">
          <div>
            <Layers3 size={15} />
            <span>当前场景</span>
            <strong>{activeProfile?.name ?? "手动模式"}</strong>
          </div>
          <select
            value={activeProfileId ?? ""}
            disabled={profileSwitchBusy}
            onChange={(event) => void quickSwitchProfile(event.target.value)}
            aria-label="切换 Profile"
          >
            <option value="">手动模式（无 Profile）</option>
            {profiles.map((profile) => (
              <option value={profile.id} key={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </div>

        <div className="metrics">
          <div>
            <span>已管理 MCP</span>
            <strong>{serverConfigs.length}</strong>
          </div>
          <div>
            <span>运行中</span>
            <strong>{runningCount}</strong>
          </div>
          <div>
            <span>已启用 Tools</span>
            <strong>{enabledToolCount}</strong>
          </div>
          <div>
            <span>Profile</span>
            <strong>{activeProfile?.name ?? "手动模式"}</strong>
          </div>
          <div>
            <span>Core 进程</span>
            <strong>
              {coreRuntimeLabel(coreRuntime)}
              {coreRuntime?.pid ? ` · ${coreRuntime.pid}` : ""}
            </strong>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="sectionTitle">
          <div>
            <h2>MCP 管理</h2>
            <p>配置并连接本机 stdio MCP Server</p>
          </div>
          <div className="sectionActions">
            <button className="secondaryButton" onClick={openImportConfig}>
              <FileText size={14} /> 导入配置
            </button>
            <button className="secondaryButton" onClick={openCreateServer}>
              <Plus size={14} /> 添加 MCP
            </button>
          </div>
        </div>

        {serverConfigs.length === 0 ? (
          <div className="emptyState">
            <Server size={20} />
            <strong>还没有 MCP 配置</strong>
            <span>添加一个 stdio MCP 后即可连接并聚合 Tools。</span>
          </div>
        ) : (
          <div className="configuredServers">
            {serverConfigs.map((server) => {
              const upstream = upstreams.find((item) => item.id === server.id);
              const upstreamStatus = upstream?.status ?? "configured";
              const changing = busy?.startsWith(`${server.id}:`) ?? false;
              const connected = upstreamStatus === "running" || upstreamStatus === "connecting";

              return (
                <article
                  className={`serverCard configuredCard ${server.enabled ? "" : "serverDisabled"}`}
                  key={server.id}
                >
                  <div className="serverIcon">
                    {(() => {
                      const ServerIcon = serverIconFor(server);
                      return <ServerIcon size={19} />;
                    })()}
                  </div>
                  <div className="serverInfo">
                    <div className="serverNameRow">
                      <strong>{server.name}</strong>
                      <span
                        className={`pill ${
                          !server.enabled
                            ? "disabled"
                            : upstreamStatus === "configured"
                              ? "configured"
                              : upstreamStatus
                        }`}
                      >
                        {server.enabled ? upstreamStatusLabel(upstreamStatus) : "已禁用"}
                      </span>
                    </div>
                    <span>
                      {server.transport === "http"
                        ? server.url
                        : `${server.command ?? ""} ${(server.args ?? []).join(" ")}`}
                    </span>
                    <div className="serverMeta">
                      <span>{server.transport.toUpperCase()}</span>
                      <span>{server.alias}</span>
                      <span>{upstream?.toolCount ?? 0} 个工具</span>
                {/* Every header is plaintext config, so surface the count rather
                    than singling out Authorization for a Keychain badge. */}
                {server.transport === "http" &&
                  Object.keys(server.headers ?? {}).length > 0 && (
                    <span>{Object.keys(server.headers ?? {}).length} 个自定义 Header</span>
                  )}
                      <span>{server.cwd || "默认工作目录"}</span>
                      {server.transport === "stdio" && (
                        <span>
                          {Object.keys(server.env ?? {}).length + (server.secretEnvKeys?.length ?? 0)} 个环境变量
                        </span>
                      )}
                      {server.autoStart && <span>自动连接</span>}
                    </div>
                    {upstream?.lastError && <div className="serverError">{upstream.lastError}</div>}
                    {upstream?.nextRetryAt && (
                      <div className="serverReconnect">
                        自动重连 #{upstream.reconnectAttempt} · {formatTime(upstream.nextRetryAt)}
                      </div>
                    )}
                    {upstream && upstream.healthStatus && upstream.healthStatus !== "unknown" && (
                      <div className={`serverHealth ${upstream.healthStatus}`}>
                        健康检查：{upstream.healthStatus === "healthy" ? "正常" : "异常"}
                        {upstream.circuitState === "open" ? " · 熔断中" : upstream.circuitState === "half-open" ? " · 恢复探测" : ""}
                      </div>
                    )}
                  </div>
                  <div className="serverActions">
                    {connected ? (
                      <button
                        className="actionButton"
                        disabled={changing}
                        onClick={() => void upstreamAction(server.id, "disconnect")}
                      >
                        <Square size={14} /> 断开
                      </button>
                    ) : (
                      <button
                        className="actionButton primary"
                        disabled={changing || !server.enabled}
                        onClick={() => void upstreamAction(server.id, "connect")}
                      >
                        <Play size={14} /> 连接
                      </button>
                    )}
                    {upstreamStatus === "running" && (
                      <button
                        className="actionButton"
                        disabled={changing}
                        onClick={() => void upstreamAction(server.id, "refresh-tools")}
                      >
                        <RefreshCw size={14} /> 工具
                      </button>
                    )}
                    <button
                      className={`actionButton settingButton ${server.enabled ? "enabled" : ""}`}
                      disabled={changing}
                      onClick={() => void updateServerSettings(
                        server.id,
                        { enabled: !server.enabled },
                      )}
                    >
                      服务 {server.enabled ? "开" : "关"}
                    </button>
                    <button
                      className={`actionButton settingButton ${server.autoStart ? "enabled" : ""}`}
                      disabled={changing || !server.enabled}
                      onClick={() => void updateServerSettings(
                        server.id,
                        { autoStart: !server.autoStart },
                      )}
                    >
                      自动 {server.autoStart ? "开" : "关"}
                    </button>
                    <button
                      className="actionButton"
                      disabled={changing}
                      onClick={() => setSelectedServerId(server.id)}
                    >
                      <Activity size={14} /> 详情
                    </button>
                    <button
                      className="actionButton iconOnly"
                      disabled={configBusy || changing}
                      onClick={() => openEditServer(server)}
                      aria-label="编辑"
                      title="编辑"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="actionButton danger iconOnly"
                      disabled={configBusy || changing}
                      onClick={() => setDeletingServerId(server.id)}
                      aria-label="删除"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {selectedServerId && (() => {
        const server = serverConfigs.find((item) => item.id === selectedServerId);
        const upstream = upstreams.find((item) => item.id === selectedServerId);
        const serverLogs = logs
          .filter((entry) =>
            entry.source === "upstream" &&
            entry.message.toLowerCase().includes((server?.name ?? "").toLowerCase()),
          )
          .slice(-8)
          .reverse();

        if (!server) return null;

        return (
          <div className="modalBackdrop" role="presentation" onMouseDown={() => setSelectedServerId(null)}>
            <section className="modalCard serverDetailModal" role="dialog" aria-modal="true" aria-label="MCP 详情" onMouseDown={(event) => event.stopPropagation()}>
              <div className="modalHeader">
                <div>
                  <h2>{server.name}</h2>
                  <p>{server.transport.toUpperCase()} · {server.alias}</p>
                </div>
                <button className="iconButton" onClick={() => setSelectedServerId(null)} aria-label="关闭">
                  <X size={17} />
                </button>
              </div>
              <div className="serverDetailGrid">
                <div><span>连接状态</span><strong>{server.enabled ? upstreamStatusLabel(upstream?.status ?? "configured") : "已禁用"}</strong></div>
                <div><span>健康状态</span><strong>{upstream?.healthStatus === "healthy" ? "正常" : upstream?.healthStatus === "unhealthy" ? "异常" : "未知"}</strong></div>
                <div><span>熔断状态</span><strong>{upstream?.circuitState === "open" ? "开启" : upstream?.circuitState === "half-open" ? "恢复探测" : "关闭"}</strong></div>
                <div><span>工具数量</span><strong>{upstream?.toolCount ?? 0}</strong></div>
                <div><span>连续失败</span><strong>{upstream?.consecutiveFailureCount ?? 0}</strong></div>
                <div><span>最近检查</span><strong>{formatTime(upstream?.lastHealthCheckAt ?? null)}</strong></div>
              </div>
              <div className="serverDetailBlock">
                <span>连接配置</span>
                <code>
                  {server.transport === "http"
                    ? server.url
                    : `${server.command ?? ""} ${(server.args ?? []).join(" ")}`.trim()}
                </code>
              </div>
              {upstream?.lastError && (
                <div className="serverDetailError">
                  <strong>最近错误</strong>
                  <span>{upstream.lastError}</span>
                </div>
              )}
              <div className="serverDetailBlock">
                <span>最近运行日志</span>
                {serverLogs.length === 0 ? (
                  <div className="serverDetailEmpty">暂无匹配日志</div>
                ) : (
                  <div className="serverDetailLogs">
                    {serverLogs.map((entry) => (
                      <div key={entry.seq}><time>{formatTime(entry.timestamp)}</time><span>{entry.message}</span></div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        );
      })()}

      {deletingServerId && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setDeletingServerId(null)}>
          <section className="modalCard confirmCard" role="dialog" aria-modal="true" aria-label="删除确认" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <h2>删除 MCP</h2>
                <p>此操作会移除本地配置，不会影响已安装的依赖。</p>
              </div>
              <button className="iconButton" onClick={() => setDeletingServerId(null)} aria-label="关闭">
                <X size={17} />
              </button>
            </div>
            <p className="confirmText">
              确定要删除「{deletingServer?.name ?? "未知 MCP"}」吗？
              {deletingServer && (
                <code className="confirmSubject">
                  {deletingServer.transport === "http"
                    ? deletingServer.url
                    : `${deletingServer.command ?? ""} ${(deletingServer.args ?? []).join(" ")}`}
                </code>
              )}
            </p>
            <div className="modalActions">
              <button className="secondaryButton" onClick={() => setDeletingServerId(null)}>取消</button>
              <button
                className="actionButton danger"
                disabled={configBusy}
                onClick={() => void removeServerConfig(deletingServerId)}
              >
                删除
              </button>
            </div>
          </section>
        </div>
      )}

      {Boolean(restoreCandidate) && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setRestoreCandidate(null)}>
          <section className="modalCard confirmCard" role="dialog" aria-modal="true" aria-label="恢复配置确认" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <h2>恢复配置</h2>
                <p>会覆盖当前 Server、Profile、Tool 策略和 Gateway 配置文件。</p>
              </div>
              <button className="iconButton" onClick={() => setRestoreCandidate(null)} aria-label="关闭">
                <X size={17} />
              </button>
            </div>
            <p className="confirmText">
              确定恢复这个备份吗？Secret 值不会从备份恢复；同一台机器上仍存在的 Keychain Secret 可以继续使用。
            </p>
            <div className="modalActions">
              <button className="secondaryButton" disabled={backupBusy !== null} onClick={() => setRestoreCandidate(null)}>取消</button>
              <button className="actionButton danger" disabled={backupBusy !== null} onClick={() => void restoreConfigurationBackup()}>
                {backupBusy === "restore" ? "恢复中…" : "确认恢复"}
              </button>
            </div>
          </section>
        </div>
      )}

      <section className="section">
        <div className="sectionTitle">
          <div>
            <h2>Profiles</h2>
            <p>按场景保存一组 MCP，激活时精确切换运行集合</p>
          </div>
          <button className="secondaryButton" onClick={openCreateProfile}>
            <Plus size={14} /> 新建 Profile
          </button>
        </div>

        {profiles.length === 0 ? (
          <div className="emptyState compact">
            <Layers3 size={19} />
            <span>还没有 Profile。可以创建“Coding”“Research”等场景。</span>
          </div>
        ) : (
          <div className="profileGrid">
            {profiles.map((profile) => {
              const active = activeProfileId === profile.id;
              const changing = busy?.startsWith(`profile:${profile.id}:`) ?? false;
              const memberServers = profile.serverIds
                .map((id) => serverConfigs.find((server) => server.id === id))
                .filter((server): server is ServerConfigInfo => Boolean(server));
              const runningMembers = profile.serverIds.filter(
                (id) => upstreams.find((upstream) => upstream.id === id)?.status === "running",
              ).length;

              return (
                <article className={`profileCard ${active ? "active" : ""}`} key={profile.id}>
                  <div className="profileHeader">
                    <div>
                      <div className="profileNameRow">
                        <Layers3 size={16} />
                        <strong>{profile.name}</strong>
                        {active && <span className="pill running">当前</span>}
                      </div>
                      <span>{runningMembers}/{profile.serverIds.length} 个成员运行中</span>
                    </div>
                    <div className="profileActions">
                      <button
                        className={`actionButton ${active ? "" : "primary"}`}
                        disabled={changing}
                        onClick={() => void profileAction(
                          profile.id,
                          active ? "deactivate" : "activate",
                        )}
                      >
                        {active ? <Square size={14} /> : <Play size={14} />}
                        {active ? "停用" : "激活"}
                      </button>
                      <button
                        className="actionButton"
                        disabled={profileBusy || changing}
                        onClick={() => openEditProfile(profile)}
                      >
                        <Pencil size={14} /> 编辑
                      </button>
                      <button
                        className="actionButton danger"
                        disabled={profileBusy || changing}
                        onClick={() => setDeletingProfileId(profile.id)}
                      >
                        <Trash2 size={14} /> 删除
                      </button>
                    </div>
                  </div>

                  <div className="profileMembers">
                    {memberServers.length === 0 ? (
                      <span className="profileEmpty">空 Profile：激活后会断开所有 MCP。</span>
                    ) : (
                      memberServers.map((server) => {
                        const running =
                          upstreams.find((upstream) => upstream.id === server.id)?.status === "running";
                        return (
                          <span
                            className={`profileMember ${running ? "running" : ""} ${server.enabled ? "" : "disabled"}`}
                            key={server.id}
                          >
                            {server.name}
                            {!server.enabled ? " · 禁用" : running ? " · 运行中" : ""}
                          </span>
                        );
                      })
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {deletingProfileId && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setDeletingProfileId(null)}>
          <section className="modalCard confirmCard" role="dialog" aria-modal="true" aria-label="删除 Profile 确认" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <h2>删除 Profile</h2>
                <p>此操作会移除场景配置；如果它正在使用，会同时停用该场景。</p>
              </div>
              <button className="iconButton" onClick={() => setDeletingProfileId(null)} aria-label="关闭">
                <X size={17} />
              </button>
            </div>
            <p className="confirmText">
              确定要删除“{profiles.find((profile) => profile.id === deletingProfileId)?.name ?? "当前 Profile"}”吗？
            </p>
            <div className="modalActions">
              <button className="secondaryButton" onClick={() => setDeletingProfileId(null)}>取消</button>
              <button
                className="actionButton danger"
                disabled={profileBusy}
                onClick={() => void removeProfile(deletingProfileId)}
              >
                {profileBusy ? "删除中…" : "删除"}
              </button>
            </div>
          </section>
        </div>
      )}

      <section className="section">
        <div className="sectionTitle">
          <div>
            <h2>Tools</h2>
            <p>只有启用的 Tool 会出现在统一 /mcp 的 tools/list</p>
          </div>
          <div className="toolToolbar">
            <div className="searchWithClear">
              <input
                className="toolSearch"
                value={toolSearch}
                onChange={(event) => setToolSearch(event.target.value)}
                placeholder="搜索工具名、来源或描述..."
              />
              {toolSearch && (
                <button
                  className="iconButton clearSearchButton"
                  onClick={() => setToolSearch("")}
                  aria-label="清空搜索"
                  title="清空搜索"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <span className="toolCount">{filteredTools.length} 个工具</span>
          </div>
        </div>

        {filteredTools.length === 0 ? (
          <div className="emptyState compact">
            <span>{tools.length === 0 ? "连接一个 MCP 后，这里会显示它暴露的 Tools。" : "没有匹配的 Tools。"}</span>
          </div>
        ) : (
          <>
            <div className="toolList">
              {pagedTools.map((tool) => {
                const changing = busy === `tool:${tool.publicName}`;
                return (
                  <article className="toolRow" key={tool.publicName}>
                    <div className="toolInfo">
                      <div>
                        <code>{tool.publicName}</code>
                        <span className="toolSource">{tool.serverAlias}</span>
                      </div>
                      {tool.definition.description && (
                        <p>{tool.definition.description}</p>
                      )}
                    </div>
                    <div className="toolActions">
                      <button
                        className="actionButton"
                        disabled={!tool.enabled || changing}
                        onClick={() => openToolTester(tool)}
                      >
                        测试
                      </button>
                      <button
                        className={`toolToggle ${tool.enabled ? "enabled" : ""}`}
                        disabled={changing}
                        onClick={() => void toggleTool(tool)}
                        aria-pressed={tool.enabled}
                      >
                        {tool.enabled ? "已启用" : "已禁用"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="pagination">
              <button
                className="ghostButton"
                disabled={safeToolPage <= 1}
                onClick={() => setToolPage((page) => page - 1)}
              >
                上一页
              </button>
              <span>
                {safeToolPage} / {totalToolPages}
              </span>
              <button
                className="ghostButton"
                disabled={safeToolPage >= totalToolPages}
                onClick={() => setToolPage((page) => page + 1)}
              >
                下一页
              </button>
            </div>
          </>
        )}
      </section>

      <section className="section logsSection">
        <div className="sectionTitle">
          <div>
            <h2>运行日志</h2>
            <p>{status?.core.logFile ?? "~/Library/Logs/MCP Gate/core.jsonl"}</p>
          </div>
          <div className="logToolbar">
            <input
              className="logSearch"
              value={logQuery}
              onChange={(event) => setLogQuery(event.target.value)}
              placeholder="搜索日志…"
              aria-label="搜索日志"
            />
            <select
              value={logSource}
              onChange={(event) => setLogSource(event.target.value)}
              aria-label="按来源筛选日志"
            >
              <option value="all">全部来源</option>
              {logSources.map((source) => (
                <option value={source} key={source}>
                  {source}
                </option>
              ))}
            </select>
            <select
              value={logLevel}
              onChange={(event) =>
                setLogLevel(event.target.value as typeof logLevel)
              }
              aria-label="按等级筛选日志"
            >
              <option value="all">全部等级</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
              <option value="debug">Debug</option>
            </select>
            <span className="logResultCount">
              {visibleLogs.length}/{logs.length}
            </span>
            <button
              className="ghostButton"
              disabled={visibleLogs.length === 0}
              onClick={() => void copyVisibleLogs()}
            >
              <Copy size={14} /> {logsCopied ? "已复制" : "复制结果"}
            </button>
            <button className="ghostButton" onClick={() => void refresh()}>
              <RefreshCw size={14} /> 刷新
            </button>
          </div>
        </div>

        <div className="logPanelWrap">
          <div className="logPanel" ref={logPanelRef} onScroll={handleLogScroll}>
            {visibleLogs.length === 0 ? (
              <div className="emptyLogs">
                <FileText size={18} /> 暂无日志
              </div>
            ) : (
              visibleLogs.map((entry) => (
                <div className="logRow" key={entry.seq}>
                  <time>{formatTime(entry.timestamp)}</time>
                  <span className={`logLevel ${entry.level}`}>{entry.level.toUpperCase()}</span>
                  <span className="logSource">{entry.source}</span>
                  <span className="logMessage">{entry.message}</span>
                </div>
              ))
            )}
          </div>
          {!logFollow && visibleLogs.length > 0 && (
            <button
              className="logJumpBottom"
              onClick={scrollLogsToBottom}
            >
              回到底部 <RefreshCw size={12} />
            </button>
          )}
        </div>
      </section>

      <section className="section auditSection">
        <div className="sectionTitle">
          <div>
            <h2>Tool 调用审计</h2>
            <p>只记录 Tool、来源、耗时和结果状态，不记录参数或返回值</p>
          </div>
          <span className="sectionCount">{auditEntries.length} 条</span>
        </div>

        <div className="auditList">
          {auditEntries.length === 0 ? (
            <div className="emptyLogs">
              <Activity size={18} /> 暂无 Tool 调用
            </div>
          ) : (
            auditEntries.slice(-80).reverse().map((entry) => (
              <div className="auditRow" key={entry.seq}>
                <time>{formatTime(entry.timestamp)}</time>
                <span className={`auditStatus ${entry.success ? "success" : "failure"}`}>
                  {entry.success ? "成功" : "失败"}
                </span>
                <code>{entry.publicName}</code>
                <span className="auditSource">
                  {entry.source === "tester" ? "测试器" : "Gateway"}
                </span>
                <span className="auditDuration">{entry.durationMs} ms</span>
                {entry.error && (
                  <span className="auditError">{entry.error}</span>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="section">
        <div className="sectionTitle">
          <div>
            <h2>桌面设置</h2>
            <p>窗口关闭后会隐藏到系统托盘，Core 会继续运行。</p>
          </div>
          <Settings2 size={16} />
        </div>

        <div className="settingsList">
          <div className="settingsRow">
            <div>
              <strong>登录时自动启动</strong>
              <span>使用 macOS LaunchAgent 静默启动，并驻留系统托盘。</span>
            </div>
            <button
              className={`toolToggle ${autostartEnabled ? "enabled" : ""}`}
              disabled={!IS_TAURI || autostartBusy || autostartEnabled === null}
              onClick={() => void toggleAutostart()}
              aria-pressed={autostartEnabled === true}
            >
              {!IS_TAURI
                ? "仅桌面版"
                : autostartBusy
                  ? "处理中…"
                  : autostartEnabled
                    ? "已开启"
                    : "已关闭"}
            </button>
          </div>

          <div className="settingsRow">
            <div>
              <strong>MCP 会话生命周期</strong>
              <span>无活动的 Gateway MCP 会话会自动过期。修改后 Core 会自动重启以应用新值。</span>
            </div>
            <select
              className="sessionTimeoutSelect"
              value={status?.core.sessionIdleTimeoutMs
                ? String(Math.round(status.core.sessionIdleTimeoutMs / 60_000))
                : "30"}
              disabled={sessionSettingBusy || !managementConnected}
              onChange={(event) => void updateSessionIdleTimeout(Number(event.target.value))}
              aria-label="设置 MCP 会话生命周期"
            >
              <option value="5">5 分钟</option>
              <option value="15">15 分钟</option>
              <option value="30">30 分钟</option>
              <option value="60">1 小时</option>
              <option value="120">2 小时</option>
              <option value="360">6 小时</option>
              <option value="720">12 小时</option>
              <option value="1440">24 小时</option>
            </select>
          </div>

          <div className="settingsRow">
            <div>
              <strong>系统托盘</strong>
              <span>托盘菜单可打开窗口、重启 Core 或退出 MCP Gate。</span>
            </div>
            <span className="settingsStatus">{IS_TAURI ? "已启用" : "仅桌面版"}</span>
          </div>

          <div className="settingsRow">
            <div>
              <strong>单实例保护</strong>
              <span>重复启动只会唤醒已有窗口，不会重复启动 Tray 或 Core。</span>
            </div>
            <span className="settingsStatus">{IS_TAURI ? "已启用" : "仅桌面版"}</span>
          </div>

          <div className="settingsRow">
            <div>
              <strong>记住窗口位置</strong>
              <span>重新打开 MCP Gate 时恢复上次的窗口大小和位置。</span>
            </div>
            <span className="settingsStatus">{IS_TAURI ? "已启用" : "仅桌面版"}</span>
          </div>

          <div className="settingsRow updateSettingsRow">
            <div>
              <strong>软件更新</strong>
              <span>
                {updateMessage ?? "从 GitHub Release 检查经过签名验证的新版本。"}
              </span>
              {availableUpdate?.notes && (
                <span className="updateNotes">{availableUpdate.notes}</span>
              )}
              {updateError && (
                <span className="updateError">{updateError}</span>
              )}
            </div>
            <div className="settingsActions">
              {availableUpdate && (
                <button
                  className="secondaryButton"
                  disabled={updateBusy !== null}
                  onClick={() => void installAvailableUpdate()}
                >
                  {updateBusy === "installing" ? "安装中…" : "下载并安装"}
                </button>
              )}
              <button
                className="secondaryButton"
                disabled={!IS_TAURI || updateBusy !== null}
                onClick={() => void checkForUpdate()}
              >
                {updateBusy === "checking" ? "检查中…" : "检查更新"}
              </button>
            </div>
          </div>

          <div className="settingsRow">
            <div>
              <strong>诊断快照</strong>
              <span>复制脱敏后的 Core、MCP、Profile、Tool 和最近错误信息。</span>
            </div>
            <button
              className="secondaryButton"
              disabled={diagnosticsBusy || !managementConnected}
              onClick={() => void copyDiagnosticsSnapshot()}
            >
              {diagnosticsBusy
                ? "生成中…"
                : diagnosticsCopied
                  ? "已复制"
                  : "复制诊断信息"}
            </button>
          </div>

          <div className="settingsRow">
            <div>
              <strong>配置备份</strong>
              <span>
                导出 Server、Profile、Tool 策略和 Gateway 配置。备份不会包含 Keychain 中保存的 Secret 值。
                {backupMessage ? ` ${backupMessage}` : ""}
              </span>
            </div>
            <div className="settingsActions">
              <input
                ref={backupInputRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(event) => selectBackupFile(event.target.files?.[0])}
              />
              <button
                className="secondaryButton"
                disabled={backupBusy !== null || !managementConnected}
                onClick={() => void exportConfigurationBackup()}
              >
                <Download size={14} /> {backupBusy === "export" ? "导出中…" : "导出"}
              </button>
              <button
                className="secondaryButton"
                disabled={backupBusy !== null || !managementConnected}
                onClick={() => backupInputRef.current?.click()}
              >
                <Upload size={14} /> 选择恢复文件
              </button>
            </div>
          </div>

          <div className="settingsRow gatewayAccessRow">
            <div>
              <strong>Gateway API Key</strong>
              <span>
                {status?.gateway.authRequired
                  ? status.gateway.authReady
                    ? "已开启；MCP 客户端需要 Authorization: Bearer <key>。"
                    : status.gateway.authError ?? "Keychain 中的 API Key 不可用。"
                  : "默认关闭；开启后统一 /mcp 需要 Bearer Token。"}
              </span>
            </div>
            <div className="settingsActions">
              <button
                className="secondaryButton"
                disabled={gatewayKeyBusy || !managementConnected}
                onClick={() => void rotateGatewayApiKey()}
              >
                {gatewayKeyBusy
                  ? "处理中…"
                  : status?.gateway.authRequired
                    ? "轮换并复制 Key"
                    : "启用并复制 Key"}
              </button>
              {status?.gateway.authRequired && (
                <button
                  className="actionButton danger"
                  disabled={gatewayKeyBusy}
                  onClick={() => void disableGatewayApiKey()}
                >
                  关闭
                </button>
              )}
            </div>
          </div>

          <div className="settingsRow">
            <div>
              <strong>局域网访问</strong>
              <span>
                {status?.gateway.lanEnabled
                  ? `已监听局域网；${status.gateway.lanEndpoints?.join(" · ") || "等待网卡地址"}`
                  : status?.gateway.authRequired && status.gateway.authReady
                    ? "当前仅 localhost。开启后会监听 0.0.0.0，并强制 Bearer API Key。"
                    : "需先启用可用的 Gateway API Key，才能开放局域网访问。"}
              </span>
            </div>
            <button
              className={`toolToggle ${status?.gateway.lanEnabled ? "enabled" : ""}`}
              disabled={
                lanAccessBusy ||
                !managementConnected ||
                (!status?.gateway.lanEnabled &&
                  (!status?.gateway.authRequired || !status?.gateway.authReady))
              }
              onClick={() => void toggleLanAccess()}
              aria-pressed={status?.gateway.lanEnabled === true}
            >
              {lanAccessBusy
                ? "切换中…"
                : status?.gateway.lanEnabled
                  ? "关闭 LAN"
                  : "开启 LAN"}
            </button>
          </div>

          {generatedGatewayKey && (
            <div className="gatewayKeyReveal">
              <div>
                <strong>新 API Key（只显示这一次）</strong>
                <span>
                  {gatewayKeyCopied
                    ? "已复制到剪贴板"
                    : "请立即保存到 MCP Client 配置"}
                </span>
              </div>
              <button
                className="iconButton"
                onClick={() => setGeneratedGatewayKey(null)}
                aria-label="隐藏 API Key"
              >
                <X size={15} />
              </button>
              <code>{generatedGatewayKey}</code>
            </div>
          )}
        </div>
      </section>
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
