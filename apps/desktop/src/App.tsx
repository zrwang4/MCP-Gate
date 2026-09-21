import {
  Activity,
  Check,
  Copy,
  FileText,
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
}

interface ServerConfigInfo {
  id: string;
  name: string;
  alias: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  hasAuthorization?: boolean;
  enabled: boolean;
  autoStart: boolean;
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
  };
}

async function api<T>(path: string, init?: RequestInit, timeoutMs = 4000): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.method && init.method !== "GET") {
    headers.set("X-MCP-Gate-Client", "desktop");
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
  const [serverConfigs, setServerConfigs] = useState<ServerConfigInfo[]>([]);
  const [upstreams, setUpstreams] = useState<UpstreamInfo[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logLevel, setLogLevel] = useState<"all" | LogLevel>("all");
  const [managementConnected, setManagementConnected] = useState(false);
  const [coreRuntime, setCoreRuntime] = useState<CoreRuntimeStatus | null>(null);
  const [coreRestarting, setCoreRestarting] = useState(false);
  const [autostartEnabled, setAutostartEnabled] = useState<boolean | null>(null);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [showAddServer, setShowAddServer] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [newServerName, setNewServerName] = useState("");
  const [newServerTransport, setNewServerTransport] = useState<"stdio" | "http">("stdio");
  const [newServerCommand, setNewServerCommand] = useState("");
  const [newServerArgs, setNewServerArgs] = useState("");
  const [newServerCwd, setNewServerCwd] = useState("");
  const [newServerUrl, setNewServerUrl] = useState("");
  const [newServerAuthorization, setNewServerAuthorization] = useState("");
  const [clearServerAuthorization, setClearServerAuthorization] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
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
      const [statusResult, configsResult, upstreamsResult, toolsResult, logsResult] = await Promise.all([
        api<StatusResponse>("/api/status"),
        api<{ servers: ServerConfigInfo[] }>("/api/server-configs"),
        api<{ upstreams: UpstreamInfo[] }>("/api/upstreams"),
        api<{ tools: ToolInfo[] }>("/api/tools"),
        api<{ entries: LogEntry[] }>("/api/logs?limit=250"),
      ]);
      setStatus(statusResult);
      setServerConfigs(configsResult.servers);
      setUpstreams(upstreamsResult.upstreams);
      setTools(toolsResult.tools);
      setLogs(logsResult.entries);
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
  }, [logs, logLevel]);

  const gatewayUrl = status?.gateway.endpoint ?? DEFAULT_GATEWAY_URL;

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

  async function copyGatewayUrl() {
    await navigator.clipboard.writeText(gatewayUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  function openCreateServer() {
    setEditingServerId(null);
    setNewServerName("");
    setNewServerTransport("stdio");
    setNewServerCommand("");
    setNewServerArgs("");
    setNewServerCwd("");
    setNewServerUrl("");
    setNewServerAuthorization("");
    setClearServerAuthorization(false);
    setShowAddServer(true);
  }

  function openEditServer(server: ServerConfigInfo) {
    setEditingServerId(server.id);
    setNewServerName(server.name);
    setNewServerTransport(server.transport);
    setNewServerCommand(server.command ?? "");
    setNewServerArgs((server.args ?? []).join("\n"));
    setNewServerCwd(server.cwd ?? "");
    setNewServerUrl(server.url ?? "");
    setNewServerAuthorization("");
    setClearServerAuthorization(false);
    setShowAddServer(true);
  }

  async function saveServerConfig() {
    setConfigBusy(true);
    setError(null);
    try {
      await api(editingServerId ? `/api/server-configs/${editingServerId}` : "/api/server-configs", {
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
      });
      setShowAddServer(false);
      setEditingServerId(null);
      setNewServerName("");
      setNewServerTransport("stdio");
      setNewServerCommand("");
      setNewServerArgs("");
      setNewServerCwd("");
      setNewServerUrl("");
      setNewServerAuthorization("");
      setClearServerAuthorization(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
  const runningCount = upstreams.filter((upstream) => upstream.status === "running").length;
  const enabledToolCount = tools.filter((tool) => tool.enabled).length;
  const visibleLogs = useMemo(
    () => (logLevel === "all" ? logs : logs.filter((entry) => entry.level === logLevel)),
    [logs, logLevel],
  );

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
          <button className="secondaryButton" onClick={openCreateServer}>
            <Plus size={14} /> 添加 MCP
          </button>
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
                <article className="serverCard configuredCard" key={server.id}>
                  <div className="serverIcon">
                    <Terminal size={19} />
                  </div>
                  <div className="serverInfo">
                    <div className="serverNameRow">
                      <strong>{server.name}</strong>
                      <span className={`pill ${upstreamStatus === "configured" ? "configured" : upstreamStatus}`}>
                        {upstreamStatusLabel(upstreamStatus)}
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
                      {server.autoStart && <span>自动连接</span>}
                    </div>
                    {upstream?.lastError && <div className="serverError">{upstream.lastError}</div>}
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
                        disabled={changing}
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
                      className={`actionButton settingButton ${server.autoStart ? "enabled" : ""}`}
                      disabled={changing}
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
                      onClick={() => void removeServerConfig(server.id)}
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

      <section className="section">
        <div className="sectionTitle">
          <div>
            <h2>Tools</h2>
            <p>只有启用的 Tool 会出现在统一 /mcp 的 tools/list</p>
          </div>
          <span>{enabledToolCount}/{tools.length} 已启用</span>
        </div>

        {tools.length === 0 ? (
          <div className="emptyState compact">
            <span>连接一个 MCP 后，这里会显示它暴露的 Tools。</span>
          </div>
        ) : (
          <div className="toolList">
            {tools.map((tool) => {
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
        )}
      </section>

      <section className="section logsSection">
        <div className="sectionTitle">
          <div>
            <h2>运行日志</h2>
            <p>{status?.core.logFile ?? "~/Library/Logs/MCP Gate/core.jsonl"}</p>
          </div>
          <div className="logToolbar">
            <select value={logLevel} onChange={(event) => setLogLevel(event.target.value as typeof logLevel)}>
              <option value="all">全部</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
              <option value="debug">Debug</option>
            </select>
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
            visibleLogs.slice(-80).map((entry) => (
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
        </div>
      </section>

      {showAddServer && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => {
          setShowAddServer(false);
          setEditingServerId(null);
        }}>
          <section className="modalCard" role="dialog" aria-modal="true" aria-label={editingServerId ? "编辑 MCP" : "添加 MCP"} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <h2>{editingServerId ? "编辑 MCP" : "添加 MCP"}</h2>
                <p>{editingServerId ? "保存时会先断开当前连接，alias 保持不变。" : "支持 stdio 与 HTTP MCP；HTTP 凭据写入 macOS Keychain。"}</p>
              </div>
              <button className="iconButton" onClick={() => {
                setShowAddServer(false);
                setEditingServerId(null);
              }} aria-label="关闭">
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
            <div className="modalActions">
              <button className="secondaryButton" onClick={() => {
                setShowAddServer(false);
                setEditingServerId(null);
              }}>取消</button>
              <button
                className="actionButton primary"
                disabled={
                  configBusy ||
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
        <span><Activity size={12} /> MG-018</span>
        <span>统一 /mcp · Tray · Autostart · Single Instance</span>
      </footer>
    </main>
  );
}
