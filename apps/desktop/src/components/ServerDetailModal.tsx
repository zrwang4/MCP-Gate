import { X } from "lucide-react";
import type { LogEntry, ServerConfigInfo, StatusResponse, UpstreamInfo } from "../types";
import { formatTime, upstreamStatusLabel } from "../lib/format";

interface ServerDetailModalProps {
  logs: LogEntry[];
  selectedServerId: string;
  serverConfigs: ServerConfigInfo[];
  setSelectedServerId: (value: string | null) => void;
  status: StatusResponse | null;
  upstreams: UpstreamInfo[];
}

export function ServerDetailModal({logs, selectedServerId, serverConfigs, setSelectedServerId, status, upstreams}: ServerDetailModalProps) {
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
}
