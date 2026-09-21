import { Check, Copy, FileText, Folder, Play, RefreshCw, RotateCw, Settings2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:24888/mcp";
const MANAGEMENT_URL = "http://127.0.0.1:24889";

type ServerStatus = "starting" | "running" | "stopping" | "stopped" | "error";
type LogLevel = "debug" | "info" | "warn" | "error";

interface ServerInfo {
  id: string;
  name: string;
  transport: "stdio" | "http";
  status: ServerStatus;
  pid: number | null;
  startedAt: string | null;
  lastError: string | null;
  root?: string;
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
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.method && init.method !== "GET") {
    headers.set("X-MCP-Gate-Client", "desktop");
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 4000);

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
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logLevel, setLogLevel] = useState<"all" | LogLevel>("all");
  const [managementConnected, setManagementConnected] = useState(false);
  const logPanelRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [statusResult, serversResult, logsResult] = await Promise.all([
        api<StatusResponse>("/api/status"),
        api<{ servers: ServerInfo[] }>("/api/servers"),
        api<{ entries: LogEntry[] }>("/api/logs?limit=250"),
      ]);
      setStatus(statusResult);
      setServers(serversResult.servers);
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

  async function serverAction(serverId: string, action: "start" | "stop" | "restart") {
    setBusy(`${serverId}:${action}`);
    setError(null);
    try {
      await api(`/api/servers/${serverId}/${action}`, { method: "POST", body: "{}" });
      await refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await refresh();
      setError(message);
    } finally {
      setBusy(null);
    }
  }

  const gatewayState = managementConnected ? (status?.gateway.status ?? "stopped") : "error";
  const runningCount = servers.filter((server) => server.status === "running").length;
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
        <button className="iconButton" aria-label="设置" title="设置">
          <Settings2 size={18} />
        </button>
      </header>

      {error && (
        <div className="errorBanner">
          <strong>管理服务连接异常</strong>
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
            <strong>{servers.length}</strong>
          </div>
          <div>
            <span>运行中</span>
            <strong>{runningCount}</strong>
          </div>
          <div>
            <span>Core</span>
            <strong>{status?.core.version ?? "—"}</strong>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="sectionTitle">
          <div>
            <h2>MCP 管理</h2>
            <p>启动、停止和查看本机 MCP 进程状态</p>
          </div>
          <button className="secondaryButton" disabled title="多 MCP 配置将在聚合层完成后开放">
            + 添加 MCP
          </button>
        </div>

        <div className="serverList">
          {servers.map((server) => {
            const changing = busy?.startsWith(`${server.id}:`) ?? false;
            return (
              <article className="serverCard" key={server.id}>
                <div className="serverIcon">
                  <Folder size={19} />
                </div>
                <div className="serverInfo">
                  <div className="serverNameRow">
                    <strong>{server.name}</strong>
                    <span className={`pill ${server.status}`}>{statusLabel(server.status)}</span>
                  </div>
                  <span>{server.transport.toUpperCase()} · {server.root ?? "本地服务"}</span>
                  <div className="serverMeta">
                    <span>PID {server.pid ?? "—"}</span>
                    <span>启动 {formatTime(server.startedAt)}</span>
                  </div>
                  {server.lastError && <div className="serverError">{server.lastError}</div>}
                </div>
                <div className="serverActions">
                  {server.status === "running" || server.status === "starting" ? (
                    <button
                      className="actionButton"
                      disabled={changing}
                      onClick={() => void serverAction(server.id, "stop")}
                    >
                      <Square size={14} /> 停止
                    </button>
                  ) : (
                    <button
                      className="actionButton primary"
                      disabled={changing}
                      onClick={() => void serverAction(server.id, "start")}
                    >
                      <Play size={14} /> 启动
                    </button>
                  )}
                  <button
                    className="actionButton"
                    disabled={changing}
                    onClick={() => void serverAction(server.id, "restart")}
                  >
                    <RotateCw size={14} /> 重启
                  </button>
                </div>
              </article>
            );
          })}
        </div>
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

        <div className="logPanel">
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

      <footer>
        <span><Activity size={12} /> MG-005+</span>
        <span>Core 管理 API · 日志 · MCP 生命周期</span>
      </footer>
    </main>
  );
}
