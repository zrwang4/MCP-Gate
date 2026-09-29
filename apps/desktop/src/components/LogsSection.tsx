import type { LogEntry, LogLevel, StatusResponse } from "../types";
import { Copy, FileText, RefreshCw } from "lucide-react";
import { formatTime } from "../lib/format";

interface LogsSectionProps {
  logs: LogEntry[];
  error: string | null;
  status: StatusResponse | null;
  refresh: () => Promise<void>;
  logLevel: "all" | LogLevel;
  setLogLevel: (value: 'all' | LogLevel) => void;
  logSource: string;
  setLogSource: (value: string) => void;
  logQuery: string;
  setLogQuery: (value: string) => void;
  logSources: string[];
  visibleLogs: LogEntry[];
  logFollow: boolean;
  setLogFollow: (value: boolean) => void;
  logsCopied: boolean;
  copyVisibleLogs: () => Promise<void>;
  logPanelRef: React.RefObject<HTMLDivElement | null>;
  handleLogScroll: () => void;
  scrollLogsToBottom: () => void;
}

export function LogsSection({logs, error, status, refresh, logLevel, setLogLevel, logSource, setLogSource, logQuery, setLogQuery, logSources, visibleLogs, logFollow, setLogFollow, logsCopied, copyVisibleLogs, logPanelRef, handleLogScroll, scrollLogsToBottom}: LogsSectionProps) {
  return (
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
  );
}
