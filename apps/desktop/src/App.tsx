import {
  Activity,
  Check,
  Copy,
  FileText,
  Layers3,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:24888/mcp";
const MANAGEMENT_URL = "http://127.0.0.1:24889";
const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let managementTokenPromise: Promise<string | null> | null = null;

async function getManagementToken(): Promise<string | null> {
  if (!IS_TAURI) {
    const token = import.meta.env.VITE_MCP_GATE_MANAGEMENT_TOKEN;
    return typeof token === "string" && token.trim() ? token.trim() : null;
  }

  managementTokenPromise ??= invoke<string>("management_token")
    .then((token) => token.trim() || null)
    .catch(() => null);
  return managementTokenPromise;
}

type ServerStatus = "starting" | "running" | "stopping" | "stopped" | "error";
type LogLevel = "debug" | "info" | "warn" | "error";

interface UpstreamInfo {
  id: string;
  name: string;
  alias: string;
  transport: "stdio" | "http";
  status: "configured" | "connecting" | "running" | "stopping" | "stopped" | "error";
  toolCount: number;
  lastError: string | null;
  reconnectAttempt: number;
  nextRetryAt: string | null;
}

interface ServerConfigInfo {
  id: string;
  name: string;
  alias: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  secretEnvKeys?: string[];
  url?: string;
  hasAuthorization?: boolean;
  enabled: boolean;
  autoStart: boolean;
}

interface ProfileInfo {
  id: string;
  name: string;
  serverIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface ProfileApplyFailure {
  serverId: string;
  error: string;
}

interface ProfileApplyResult {
  connected: string[];
  disconnected: string[];
  alreadyRunning: string[];
  failed: ProfileApplyFailure[];
}

interface McpImportSourceInfo {
  id: string;
  label: string;
  displayPath: string;
  exists: boolean;
  size: number | null;
  modifiedAt: string | null;
}

interface McpImportIssue {
  sourceName?: string;
  message: string;
}

interface McpImportPreviewCandidate {
  sourceName: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  plainEnvKeys: string[];
  secretEnvKeys: string[];
  hasAuthorization: boolean;
  warnings: string[];
}

interface McpImportPreview {
  candidates: McpImportPreviewCandidate[];
  issues: McpImportIssue[];
}

interface McpImportApplyResult {
  imported: Array<{
    sourceName: string;
    serverId: string;
    name: string;
  }>;
  skipped: Array<{
    sourceName: string;
    reason: string;
  }>;
  failed: Array<{
    sourceName: string;
    error: string;
  }>;
  issues: McpImportIssue[];
}

interface ToolInfo {
  publicName: string;
  serverId: string;
  serverAlias: string;
  originalName: string;
  enabled: boolean;
  definition: {
    name: string;
    description?: string;
    inputSchema?: unknown;
  };
}

interface LogEntry {
  seq: number;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
}

interface AuditEntry {
  seq: number;
  timestamp: string;
  source: "gateway" | "tester";
  publicName: string;
  serverId: string;
  serverAlias: string;
  originalName: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

interface CoreRuntimeStatus {
  reachable: boolean;
  managed: boolean;
  pid: number | null;
  launchMode:
    | "none"
    | "external"
    | "managed-node"
    | "managed-bundled-node"
    | "managed-executable";
}

interface UpdateMetadata {
  version: string;
  currentVersion: string;
  notes: string | null;
  pubDate: string | null;
}

interface ConnectionTestResult {
  transport: "stdio" | "http";
  toolCount: number;
  toolNames: string[];
  durationMs: number;
}

type ConnectionTestState =
  | { status: "success"; result: ConnectionTestResult }
  | { status: "error"; error: string };

interface StatusResponse {
  core: {
    version: string;
    startedAt: string;
    logFile: string;
  };
  gateway: {
    endpoint: string;
    healthEndpoint: string;
    status: ServerStatus;
    toolCount: number;
    lastError: string | null;
    authRequired?: boolean;
    authReady?: boolean;
    authError?: string | null;
    lanEnabled?: boolean;
    lanEndpoints?: string[];
  };
}

async function api<T>(path: string, init?: RequestInit, timeoutMs = 4000): Promise<T> {
  const headers = new Headers(init?.headers);
  const managementToken = await getManagementToken();
  if (managementToken) {
    headers.set("X-MCP-Gate-Token", managementToken);
  }
  headers.set("X-MCP-Gate-Client", "desktop");
  if (init?.method && init.method !== "GET") {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${MANAGEMENT_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });

    const body = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      throw new Error(body.error ?? `HTTP ${response.status}`);
    }
    return body;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function upstreamStatusLabel(status: UpstreamInfo["status"]): string {
  switch (status) {
    case "configured":
      return "已配置";
    case "connecting":
      return "连接中";
    case "running":
      return "运行中";
    case "stopping":
      return "断开中";
    case "error":
      return "异常";
    default:
      return "已断开";
  }
}

function statusLabel(status: ServerStatus): string {
  switch (status) {
    case "running":
      return "运行中";
    case "starting":
      return "启动中";
    case "stopping":
      return "停止中";
    case "error":
      return "异常";
    default:
      return "已停止";
  }
}

function coreRuntimeLabel(status: CoreRuntimeStatus | null): string {
  if (!IS_TAURI) return "Web 模式";
  if (!status) return "检测中";
  if (status.managed) {
    if (status.launchMode === "managed-bundled-node") {
      return "内置 Core Runtime";
    }
    return status.launchMode === "managed-executable"
      ? "桌面托管 Sidecar"
      : "桌面托管 Node";
  }
  if (status.reachable) return "外部 Core";
  return "未运行";
}

function environmentToText(values: Record<string, string> | undefined): string {
  return Object.entries(values ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function secretEnvironmentToText(keys: string[] | undefined): string {
  return [...(keys ?? [])]
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}=`)
    .join("\n");
}

function parseEnvironmentText(text: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error(`环境变量格式错误：${line}`);
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`环境变量名无效：${key}`);
    }
    result[key] = value;
  }

  return result;
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

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
  const [newServerEnv, setNewServerEnv] = useState("");
  const [newServerSecretEnv, setNewServerSecretEnv] = useState("");
  const [newServerUrl, setNewServerUrl] = useState("");
  const [newServerAuthorization, setNewServerAuthorization] = useState("");
  const [clearServerAuthorization, setClearServerAuthorization] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const [connectionTestBusy, setConnectionTestBusy] = useState(false);
  const [connectionTestState, setConnectionTestState] =
    useState<ConnectionTestState | null>(null);
  const [testTool, setTestTool] = useState<ToolInfo | null>(null);
  const [testToolArgs, setTestToolArgs] = useState("{}");
  const [testToolResult, setTestToolResult] = useState("");
  const [testToolBusy, setTestToolBusy] = useState(false);
  const logPanelRef = useRef<HTMLDivElement | null>(null);

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
      setManagementConnected(true);
      setError(null);
    } catch (cause) {
      setManagementConnected(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      void refreshCoreRuntime();
      void refreshDesktopPreferences();
    }
  }, [refreshCoreRuntime, refreshDesktopPreferences]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const el = logPanelRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs, logLevel, logSource, logQuery]);

  const gatewayUrl = status?.gateway.endpoint ?? DEFAULT_GATEWAY_URL;

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
    setError(null);
    try {
      const update = await invoke<UpdateMetadata | null>("check_for_update");
      setAvailableUpdate(update);
      setUpdateMessage(
        update
          ? `发现新版本 ${update.version}，当前版本 ${update.currentVersion}。`
          : "当前已是最新版本。",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUpdateBusy(null);
    }
  }

  async function installAvailableUpdate() {
    if (!IS_TAURI || !availableUpdate || updateBusy) return;

    setUpdateBusy("installing");
    setUpdateMessage(`正在下载并安装 ${availableUpdate.version}…`);
    setError(null);
    try {
      await invoke("install_update");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setUpdateMessage(null);
      setUpdateBusy(null);
    }
  }

  async function copyGatewayUrl() {
    await navigator.clipboard.writeText(gatewayUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
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
    setNewServerAuthorization("");
    setClearServerAuthorization(false);
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
    setNewServerAuthorization("");
    setClearServerAuthorization(false);
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
            authorization:
              newServerTransport === "http" &&
              newServerAuthorization.trim()
                ? newServerAuthorization.trim()
                : undefined,
            clearAuthorization:
              newServerTransport === "http" &&
              clearServerAuthorization,
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
            authorization:
              newServerTransport === "http" && newServerAuthorization.trim()
                ? newServerAuthorization.trim()
                : undefined,
            clearAuthorization:
              newServerTransport === "http" && clearServerAuthorization,
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
      setNewServerAuthorization("");
      setClearServerAuthorization(false);
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
          <code>{gatewayUrl}</code>
          <button className="copyButton" onClick={() => void copyGatewayUrl()}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "已复制" : "复制"}
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
            <Terminal size={20} />
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
                    <Terminal size={19} />
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
                      {server.transport === "http" && server.hasAuthorization && (
                        <span>Keychain 鉴权</span>
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
                      disabled={configBusy || changing}
                      onClick={() => openEditServer(server)}
                    >
                      <Pencil size={14} /> 编辑
                    </button>
                    <button
                      className="actionButton danger"
                      disabled={configBusy || changing}
                      onClick={() => setDeletingServerId(server.id)}
                    >
                      <Trash2 size={14} /> 删除
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

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
            <p className="confirmText">确定要删除这个 MCP 吗？</p>
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
                        onClick={() => void removeProfile(profile.id)}
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

        <div className="logPanel" ref={logPanelRef}>
          {visibleLogs.length === 0 ? (
            <div className="emptyLogs">
              <FileText size={18} /> 暂无日志
            </div>
          ) : (
            visibleLogs.slice(-120).map((entry) => (
              <div className="logRow" key={entry.seq}>
                <time>{formatTime(entry.timestamp)}</time>
                <span className={`logLevel ${entry.level}`}>{entry.level.toUpperCase()}</span>
                <span className="logSource">{entry.source}</span>
                <span className="logMessage">{entry.message}</span>
              </div>
            ))
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
        <div className="modalBackdrop" role="presentation" onMouseDown={() => {
          setShowProfileEditor(false);
          setEditingProfileId(null);
        }}>
          <section
            className="modalCard"
            role="dialog"
            aria-modal="true"
            aria-label={editingProfileId ? "编辑 Profile" : "新建 Profile"}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <h2>{editingProfileId ? "编辑 Profile" : "新建 Profile"}</h2>
                <p>
                  激活后，只保留选中的 MCP 运行；编辑当前 Profile 并保存时也会立即按新成员重算运行集合。
                </p>
              </div>
              <button
                className="iconButton"
                onClick={() => {
                  setShowProfileEditor(false);
                  setEditingProfileId(null);
                }}
                aria-label="关闭"
              >
                <X size={17} />
              </button>
            </div>

            <label className="field">
              <span>名称</span>
              <input
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                placeholder="例如 Coding"
              />
            </label>

            <div className="profilePicker">
              <div className="profilePickerToolbar">
                <span className="profilePickerTitle">MCP 成员</span>
                <div>
                  <button
                    type="button"
                    className="profilePickerButton"
                    onClick={() =>
                      setProfileServerIds(
                        upstreams
                          .filter((upstream) => upstream.status === "running")
                          .map((upstream) => upstream.id),
                      )
                    }
                  >
                    使用当前运行集合
                  </button>
                  <button
                    type="button"
                    className="profilePickerButton"
                    onClick={() =>
                      setProfileServerIds(
                        serverConfigs
                          .filter((server) => server.enabled)
                          .map((server) => server.id),
                      )
                    }
                  >
                    全选已启用
                  </button>
                  <button
                    type="button"
                    className="profilePickerButton"
                    onClick={() => setProfileServerIds([])}
                  >
                    清空
                  </button>
                </div>
              </div>
              {serverConfigs.length === 0 ? (
                <div className="emptyState compact">
                  <span>先添加 MCP，再创建 Profile。</span>
                </div>
              ) : (
                serverConfigs.map((server) => (
                  <label className="profilePickerRow" key={server.id}>
                    <input
                      type="checkbox"
                      checked={profileServerIds.includes(server.id)}
                      onChange={() => toggleProfileServer(server.id)}
                    />
                    <div>
                      <strong>{server.name}</strong>
                      <span>
                        {server.transport.toUpperCase()} · {server.alias}
                        {!server.enabled ? " · 已禁用" : ""}
                      </span>
                    </div>
                  </label>
                ))
              )}
            </div>

            <div className="modalActions">
              <button
                className="secondaryButton"
                onClick={() => {
                  setShowProfileEditor(false);
                  setEditingProfileId(null);
                }}
              >
                取消
              </button>
              <button
                className="actionButton primary"
                disabled={profileBusy || !profileName.trim()}
                onClick={() => void saveProfile()}
              >
                {profileBusy ? "保存中…" : editingProfileId ? "保存修改" : "创建 Profile"}
              </button>
            </div>
          </section>
        </div>
      )}

      {showImportConfig && (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={() => {
            if (importBusy) return;
            setShowImportConfig(false);
            setImportPreview(null);
            setImportApplyResult(null);
            setImportSourceId(null);
            setImportSourceSnapshot(null);
          }}
        >
          <section
            className="modalCard importConfigCard"
            role="dialog"
            aria-modal="true"
            aria-label="导入 MCP 配置"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <h2>导入 MCP 配置</h2>
                <p>
                  支持 Claude / Cursor 风格 mcpServers JSON。先预览，再写入 Registry 和 Keychain。
                </p>
              </div>
              <button
                className="iconButton"
                disabled={importBusy}
                onClick={() => {
                  setShowImportConfig(false);
                  setImportPreview(null);
                  setImportApplyResult(null);
                }}
                aria-label="关闭"
              >
                <X size={17} />
              </button>
            </div>

            <div className="importSources">
              <div className="importSourcesHeader">
                <div>
                  <strong>本机配置</strong>
                  <span>Core 直接读取，原始 JSON 和 Secret 不会发给 WebView</span>
                </div>
                <button
                  type="button"
                  className="profilePickerButton"
                  disabled={importBusy}
                  onClick={() => void refreshImportSources()}
                >
                  刷新检测
                </button>
              </div>

              {importSources.map((source) => (
                <button
                  type="button"
                  className={`importSourceRow ${importSourceId === source.id ? "selected" : ""}`}
                  key={source.id}
                  disabled={importBusy || !source.exists}
                  onClick={() => void previewImportSource(source.id)}
                >
                  <div>
                    <strong>{source.label}</strong>
                    <code>{source.displayPath}</code>
                  </div>
                  <span className={source.exists ? "sourceFound" : "sourceMissing"}>
                    {source.exists ? "预览" : "未发现"}
                  </span>
                </button>
              ))}
            </div>

            <div className="importDivider"><span>或粘贴 JSON</span></div>

            <label className="field">
              <span>JSON 配置</span>
              <textarea
                className="importConfigText"
                value={importConfigText}
                onChange={(event) => {
                  setImportConfigText(event.target.value);
                  setImportPreview(null);
                  setImportApplyResult(null);
                  setImportSourceId(null);
                  setImportSourceSnapshot(null);
                }}
                rows={10}
                spellCheck={false}
                placeholder={'{\n  "mcpServers": {\n    "github": {\n      "command": "npx",\n      "args": ["-y", "server-package"],\n      "env": { "GITHUB_TOKEN": "..." }\n    }\n  }\n}'}
              />
              <small>
                Preview 不回显 Secret 值；敏感 env 和 HTTP Authorization 在导入时写入 macOS Keychain。
              </small>
            </label>

            {importPreview && (
              <div className="importPreview">
                <div className="importPreviewHeader">
                  <strong>{importPreview.candidates.length} 个可导入</strong>
                  <span>{importPreview.issues.length} 个问题</span>
                </div>

                {importPreview.candidates.map((candidate) => (
                  <div className="importCandidate" key={candidate.sourceName}>
                    <div className="importCandidateHeader">
                      <strong>{candidate.name}</strong>
                      <span className="toolSource">{candidate.transport.toUpperCase()}</span>
                    </div>
                    <code>
                      {candidate.transport === "stdio"
                        ? `${candidate.command ?? ""} ${(candidate.args ?? []).join(" ")}`
                        : candidate.url}
                    </code>
                    <div className="importMeta">
                      {candidate.plainEnvKeys.length > 0 && (
                        <span>Env: {candidate.plainEnvKeys.join(", ")}</span>
                      )}
                      {candidate.secretEnvKeys.length > 0 && (
                        <span>Keychain: {candidate.secretEnvKeys.join(", ")}</span>
                      )}
                      {candidate.hasAuthorization && <span>Authorization → Keychain</span>}
                    </div>
                    {candidate.warnings.map((warning) => (
                      <div className="importWarning" key={warning}>{warning}</div>
                    ))}
                  </div>
                ))}

                {importPreview.issues.map((issue, index) => (
                  <div
                    className="importIssue"
                    key={`${issue.sourceName ?? "config"}:${index}`}
                  >
                    <strong>{issue.sourceName ?? "配置"}</strong>
                    <span>{issue.message}</span>
                  </div>
                ))}
              </div>
            )}

            {importApplyResult && (
              <div className="importResult">
                <strong>导入结果</strong>
                <span>
                  已导入 {importApplyResult.imported.length} ·
                  跳过 {importApplyResult.skipped.length} ·
                  失败 {importApplyResult.failed.length}
                </span>
                {importApplyResult.failed.map((item) => (
                  <div className="importIssue" key={`failed:${item.sourceName}`}>
                    <strong>{item.sourceName}</strong>
                    <span>{item.error}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="modalActions">
              <button
                className="secondaryButton"
                disabled={importBusy}
                onClick={() => {
                  setShowImportConfig(false);
                  setImportPreview(null);
                  setImportApplyResult(null);
                }}
              >
                关闭
              </button>
              <button
                className="secondaryButton"
                disabled={importBusy || !importConfigText.trim() || Boolean(importSourceId)}
                onClick={() => void previewImportConfig()}
              >
                {importBusy ? "处理中…" : "预览"}
              </button>
              <button
                className="actionButton primary"
                disabled={
                  importBusy ||
                  !importPreview ||
                  importPreview.candidates.length === 0
                }
                onClick={() => void applyImportConfig()}
              >
                {importBusy
                  ? "导入中…"
                  : `导入 ${importPreview?.candidates.length ?? 0} 个`}
              </button>
            </div>
          </section>
        </div>
      )}

      {showAddServer && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => {
          if (connectionTestBusy || configBusy) return;
          setShowAddServer(false);
          setEditingServerId(null);
          setConnectionTestState(null);
        }}>
          <section className="modalCard" role="dialog" aria-modal="true" aria-label={editingServerId ? "编辑 MCP" : "添加 MCP"} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <h2>{editingServerId ? "编辑 MCP" : "添加 MCP"}</h2>
                <p>{editingServerId ? "保存时会先断开当前连接，alias 保持不变。" : "支持 stdio 与 HTTP MCP；HTTP 凭据写入 macOS Keychain。"}</p>
              </div>
              <button
                className="iconButton"
                disabled={connectionTestBusy || configBusy}
                onClick={() => {
                  setShowAddServer(false);
                  setEditingServerId(null);
                  setConnectionTestState(null);
                }}
                aria-label="关闭"
              >
                <X size={17} />
              </button>
            </div>
            <label className="field">
              <span>名称</span>
              <input value={newServerName} onChange={(event) => setNewServerName(event.target.value)} placeholder="例如 GitHub" />
            </label>
            <label className="field">
              <span>类型</span>
              <select
                value={newServerTransport}
                onChange={(event) => setNewServerTransport(event.target.value as "stdio" | "http")}
              >
                <option value="stdio">本地命令（stdio）</option>
                <option value="http">远端 MCP（HTTP）</option>
              </select>
            </label>
            {newServerTransport === "stdio" ? (
              <>
            <label className="field">
              <span>命令</span>
              <input value={newServerCommand} onChange={(event) => setNewServerCommand(event.target.value)} placeholder="例如 npx" />
            </label>
            <label className="field">
              <span>参数（每行一个）</span>
              <textarea value={newServerArgs} onChange={(event) => setNewServerArgs(event.target.value)} rows={4} placeholder={"-y\n@modelcontextprotocol/server-github"} />
            </label>
            <label className="field">
              <span>工作目录（可选）</span>
              <input value={newServerCwd} onChange={(event) => setNewServerCwd(event.target.value)} placeholder="/Users/me/project" />
            </label>
            <label className="field">
              <span>环境变量（每行 KEY=VALUE）</span>
              <textarea
                value={newServerEnv}
                onChange={(event) => setNewServerEnv(event.target.value)}
                rows={3}
                placeholder={"API_URL=https://example.com\nMODE=production"}
                spellCheck={false}
              />
              <small>普通变量会保存在 servers.json；SDK 仍会自动继承 HOME、PATH、SHELL 等安全默认环境。</small>
            </label>
            <label className="field">
              <span>Secret 环境变量（每行 KEY=VALUE）</span>
              <textarea
                value={newServerSecretEnv}
                onChange={(event) => setNewServerSecretEnv(event.target.value)}
                rows={3}
                placeholder={"GITHUB_TOKEN=...\nAPI_KEY=..."}
                spellCheck={false}
              />
              <small>Secret 只写入 macOS Keychain。编辑已有 Secret 时保留 KEY= 空值即可保持原值；删除整行会清除它。</small>
            </label>
              </>
            ) : (
              <>
                <label className="field">
                  <span>MCP URL</span>
                  <input
                    value={newServerUrl}
                    onChange={(event) => setNewServerUrl(event.target.value)}
                    placeholder="https://example.com/mcp"
                  />
                </label>
                <label className="field">
                  <span>Authorization（可选）</span>
                  <input
                    type="password"
                    value={newServerAuthorization}
                    onChange={(event) => setNewServerAuthorization(event.target.value)}
                    placeholder={
                      editingServerId &&
                      serverConfigs.find((item) => item.id === editingServerId)?.hasAuthorization
                        ? "已保存在 Keychain，留空保持不变"
                        : "Bearer ..."
                    }
                    autoComplete="off"
                  />
                  <small>只写入 macOS Keychain，不会保存到 servers.json 或回传到 UI。</small>
                </label>
                {editingServerId &&
                  serverConfigs.find((item) => item.id === editingServerId)?.hasAuthorization && (
                    <label className="checkField">
                      <input
                        type="checkbox"
                        checked={clearServerAuthorization}
                        onChange={(event) => setClearServerAuthorization(event.target.checked)}
                      />
                      <span>清除已保存的 Authorization</span>
                    </label>
                  )}
              </>
            )}
            {connectionTestState && (
              <div
                className={`connectionTestResult ${connectionTestState.status}`}
                role="status"
              >
                {connectionTestState.status === "success" ? (
                  <>
                    <div className="connectionTestSummary">
                      <strong>连接成功</strong>
                      <span>
                        {connectionTestState.result.toolCount} 个 Tools ·
                        {" "}
                        {connectionTestState.result.durationMs} ms
                      </span>
                    </div>
                    {connectionTestState.result.toolNames.length > 0 && (
                      <div className="connectionTestTools">
                        {connectionTestState.result.toolNames
                          .slice(0, 12)
                          .map((toolName) => (
                            <code key={toolName}>{toolName}</code>
                          ))}
                        {connectionTestState.result.toolNames.length > 12 && (
                          <span>
                            +{connectionTestState.result.toolNames.length - 12}
                          </span>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <strong>连接失败</strong>
                    <span>{connectionTestState.error}</span>
                  </>
                )}
                <small>
                  这是临时连接测试，不会保存配置；修改表单后请重新测试。
                </small>
              </div>
            )}

            <div className="modalActions">
              <button
                className="secondaryButton"
                disabled={connectionTestBusy || configBusy}
                onClick={() => {
                  setShowAddServer(false);
                  setEditingServerId(null);
                  setConnectionTestState(null);
                }}
              >
                取消
              </button>
              <button
                className="secondaryButton"
                disabled={
                  connectionTestBusy ||
                  configBusy ||
                  (newServerTransport === "stdio"
                    ? !newServerCommand.trim()
                    : !newServerUrl.trim())
                }
                onClick={() => void testServerConnection()}
              >
                {connectionTestBusy ? "测试中…" : "测试连接"}
              </button>
              <button
                className="actionButton primary"
                disabled={
                  configBusy ||
                  connectionTestBusy ||
                  !newServerName.trim() ||
                  (newServerTransport === "stdio"
                    ? !newServerCommand.trim()
                    : !newServerUrl.trim())
                }
                onClick={() => void saveServerConfig()}
              >
                {configBusy ? "保存中…" : editingServerId ? "保存修改" : "保存配置"}
              </button>
            </div>
          </section>
        </div>
      )}

      {testTool && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setTestTool(null)}>
          <section
            className="modalCard toolTesterCard"
            role="dialog"
            aria-modal="true"
            aria-label="Tool 测试器"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <h2>Tool 测试器</h2>
                <p><code>{testTool.publicName}</code> · 调用可能产生真实副作用，请确认参数。</p>
              </div>
              <button className="iconButton" onClick={() => setTestTool(null)} aria-label="关闭">
                <X size={17} />
              </button>
            </div>
            <label className="field">
              <span>Arguments JSON</span>
              <textarea
                value={testToolArgs}
                onChange={(event) => setTestToolArgs(event.target.value)}
                rows={7}
                spellCheck={false}
              />
            </label>
            {testToolResult && (
              <label className="field">
                <span>Result</span>
                <pre className="toolResult">{testToolResult}</pre>
              </label>
            )}
            <div className="modalActions">
              <button className="secondaryButton" onClick={() => setTestTool(null)}>关闭</button>
              <button
                className="actionButton primary"
                disabled={testToolBusy}
                onClick={() => void runToolTest()}
              >
                {testToolBusy ? "运行中…" : "运行 Tool"}
              </button>
            </div>
          </section>
        </div>
      )}

      <footer>
        <span><Activity size={12} /> Profiles</span>
        <span>统一 /mcp · Profiles · Recovery · Secure Secrets</span>
      </footer>
    </main>
  );
}
