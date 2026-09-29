import { Activity } from "lucide-react";
import type { AuditEntry } from "../types";
import { formatTime } from "../lib/format";

interface AuditSectionProps {
  auditEntries: AuditEntry[];
  error: string | null;
}

export function AuditSection({auditEntries, error}: AuditSectionProps) {
  return (
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
  );
}
