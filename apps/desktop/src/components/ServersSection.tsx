import { useRef, useState } from "react";
import { Activity, FileText, GripVertical, Pencil, Play, Plus, RefreshCw, Server, Square, Trash2 } from "lucide-react";
import type { ServerConfigInfo, StatusResponse, ToolInfo, UpstreamInfo } from "../types";
import { formatTime, serverIconFor, upstreamStatusLabel } from "../lib/format";
import { moveServer, orderServers, parseServerOrder, SERVER_ORDER_KEY } from "../lib/server-order";

interface ServerDrag {
  id: string;
  pointerId: number;
  startY: number;
  active: boolean;
  target: string | null;
  after: boolean;
}

interface ServersSectionProps {
  busy: string | null;
  configBusy: boolean;
  openCreateServer: () => void;
  openEditServer: (server: ServerConfigInfo) => void;
  openImportConfig: () => void;
  refresh: () => Promise<void>;
  serverConfigs: ServerConfigInfo[];
  setDeletingServerId: (value: string | null) => void;
  setSelectedServerId: (value: string | null) => void;
  status: StatusResponse | null;
  tools: ToolInfo[];
  updateServerSettings: (serverId: string, patch: { enabled?: boolean; autoStart?: boolean }) => Promise<void>;
  upstreamAction: (serverId: string, action: 'connect' | 'disconnect' | 'refresh-tools') => Promise<void>;
  upstreams: UpstreamInfo[];
}

export function ServersSection({busy, configBusy, openCreateServer, openEditServer, openImportConfig, refresh, serverConfigs, setDeletingServerId, setSelectedServerId, status, tools, updateServerSettings, upstreamAction, upstreams}: ServersSectionProps) {
  const [displayOrder, setDisplayOrder] = useState<string[]>(() => {
    try { return parseServerOrder(localStorage.getItem(SERVER_ORDER_KEY)); }
    catch { return []; }
  });
  const [drag, setDrag] = useState<ServerDrag | null>(null);
  const dragRef = useRef<ServerDrag | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [orderMessage, setOrderMessage] = useState("");
  const sortedServers = orderServers(serverConfigs, displayOrder);

  function saveOrder(next: string[]) {
    setDisplayOrder(next);
    try {
      localStorage.setItem(SERVER_ORDER_KEY, JSON.stringify(next));
      setOrderMessage("排序已保存");
    } catch {
      setOrderMessage("排序已调整，但本机存储不可用，重启后可能恢复原顺序。");
    }
  }

  function cancelDrag() {
    dragRef.current = null;
    setDrag(null);
  }

  return (
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
    <div className="configuredServers" ref={listRef}>
      {sortedServers.map((server) => {
        const upstream = upstreams.find((item) => item.id === server.id);
        const upstreamStatus = upstream?.status ?? "configured";
        const changing = busy?.startsWith(`${server.id}:`) ?? false;
        const connected = upstreamStatus === "running" || upstreamStatus === "connecting";
        const launchDescription = server.transport === "http"
          ? server.url ?? ""
          : `${server.command ?? ""} ${(server.args ?? []).join(" ")}`.trim();

        return (
          <article
            className={`serverCard configuredCard ${server.enabled ? "" : "serverDisabled"} ${drag?.active && drag.id === server.id ? "serverDragging" : ""} ${drag?.active && drag.target === server.id ? (drag.after ? "serverDropAfter" : "serverDropBefore") : ""}`}
            key={server.id}
            data-server-id={server.id}
          >
            <button
              type="button"
              className="serverDragHandle"
              aria-label={`拖拽排序 ${server.name}`}
              title="拖拽排序；也可使用上下方向键调整"
              disabled={sortedServers.length < 2}
              onPointerDown={(event) => {
                if (event.button !== 0 || !event.isPrimary) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                dragRef.current = { id: server.id, pointerId: event.pointerId, startY: event.clientY, active: false, target: null, after: false };
              }}
              onPointerMove={(event) => {
                const current = dragRef.current;
                if (!current || current.pointerId !== event.pointerId) return;
                if (!current.active && Math.abs(event.clientY - current.startY) < 5) return;
                const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-server-id]");
                const valid = target && listRef.current?.contains(target) && target.dataset.serverId !== current.id;
                const next = { ...current, active: true, target: valid ? target.dataset.serverId ?? null : null, after: valid ? event.clientY > target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2 : false };
                dragRef.current = next;
                setDrag(next);
              }}
              onPointerUp={(event) => {
                const current = dragRef.current;
                if (!current || current.pointerId !== event.pointerId) return;
                if (current.active && current.target) {
                  saveOrder(moveServer(sortedServers.map((item) => item.id), current.id, current.target, current.after));
                }
                cancelDrag();
              }}
              onPointerCancel={cancelDrag}
              onLostPointerCapture={cancelDrag}
              onKeyDown={(event) => {
                if (event.key === "Escape") { cancelDrag(); return; }
                if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                event.preventDefault();
                const index = sortedServers.findIndex((item) => item.id === server.id);
                const target = sortedServers[index + (event.key === "ArrowUp" ? -1 : 1)];
                if (target) saveOrder(moveServer(sortedServers.map((item) => item.id), server.id, target.id, event.key === "ArrowDown"));
              }}
            >
              <GripVertical size={16} />
            </button>
            <div className="serverIcon">
              {(() => {
                const ServerIcon = serverIconFor(server);
                return <ServerIcon size={19} />;
              })()}
            </div>
            <div className="serverInfo">
              <div className="serverNameRow">
                <strong title={server.name}>{server.name}</strong>
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
              <span title={launchDescription}>
                {launchDescription}
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
                <span title={server.cwd || "默认工作目录"}>{server.cwd || "默认工作目录"}</span>
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
  <span className="serverOrderMessage" role="status">{orderMessage}</span>
</section>
  );
}
