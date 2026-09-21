import {
  Activity,
  Check,
  Copy,
  FileText,
  Play,
  Plus,
  RefreshCw,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:24888/mcp";
const MANAGEMENT_URL = "http://127.0.0.1:24889";

type ServerStatus = "starting" | "running" | "stopping" | "stopped" | "error";
type LogLevel = "debug" | "info" | "warn" | "error";

interface UpstreamInfo {
  id: string;
  name: string;
  alias: string;
  status: "configured" | "connecting" | "running" | "stopping" | "stopped" | "error";
  toolCount: number;
  lastError: string | null;
}

interface ServerConfigInfo {
  id: string;
  name: string;
  alias: string;
  transport: "stdio";
  command: string;
  args: string[];
  cwd?: string;
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
  const [showAddServer, setShowAddServer] = useState(false);
  const [newServerName, setNewServerName] = useState("");
  const [newServerCommand, setNewServerCommand] = useState("");
  const [newServerArgs, setNewServerArgs] = useState("");
  const [newServerCwd, setNewServerCwd] = useState("");
  const [configBusy, setConfigBusy] = useState(false);
  const logPanelRef = useRef<HTMLDivElement | null>(null);

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
    }
  }, []);

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

  async function copyGatewayUrl() {
    await navigator.clipboard.writeText(gatewayUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  async function addServerConfig() {
    setConfigBusy(true);
    setError(null);
    try {
      await api("/api/server-configs", {
        method: "POST",
        body: JSON.stringify({
          name: newServerName,
          command: newServerCommand,
          args: newServerArgs.split("\n").map((value) => value.trim()).filter(Boolean),
          cwd: newServerCwd.trim() || undefined,
        }),
      });
      setShowAddServer(false);
      setNewServerName("");
      setNewServerCommand("");
      setNewServerArgs("");
      setNewServerCwd("");
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
          <button onClick={() => void refresh()}>重试</button>
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
        </div>
      </section>

      <section className="section">
        <div className="sectionTitle">
          <div>
            <h2>MCP 管理</h2>
            <p>配置并连接本机 stdio MCP Server</p>
          </div>
          <button className="secondaryButton" onClick={() => setShowAddServer(true)}>
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
                    <span>{server.command} {server.args.join(" ")}</span>
                    <div className="serverMeta">
                      <span>{server.alias}</span>
                      <span>{upstream?.toolCount ?? 0} 个工具</span>
                      <span>{server.cwd || "默认工作目录"}</span>
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
                  <button
                    className={`toolToggle ${tool.enabled ? "enabled" : ""}`}
                    disabled={changing}
                    onClick={() => void toggleTool(tool)}
                    aria-pressed={tool.enabled}
                  >
                    {tool.enabled ? "已启用" : "已禁用"}
                  </button>
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

      {showAddServer && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setShowAddServer(false)}>
          <section className="modalCard" role="dialog" aria-modal="true" aria-label="添加 MCP" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <h2>添加 MCP</h2>
                <p>保存后可直接连接 stdio MCP；Tools 会注册到统一 Gateway。</p>
              </div>
              <button className="iconButton" onClick={() => setShowAddServer(false)} aria-label="关闭">
                <X size={17} />
              </button>
            </div>
            <label className="field">
              <span>名称</span>
              <input value={newServerName} onChange={(event) => setNewServerName(event.target.value)} placeholder="例如 GitHub" />
            </label>
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
            <div className="modalActions">
              <button className="secondaryButton" onClick={() => setShowAddServer(false)}>取消</button>
              <button
                className="actionButton primary"
                disabled={configBusy || !newServerName.trim() || !newServerCommand.trim()}
                onClick={() => void addServerConfig()}
              >
                {configBusy ? "保存中…" : "保存配置"}
              </button>
            </div>
          </section>
        </div>
      )}

      <footer>
        <span><Activity size={12} /> MG-010</span>
        <span>统一 /mcp · MCP 管理 · Tool 开关</span>
      </footer>
    </main>
  );
}
