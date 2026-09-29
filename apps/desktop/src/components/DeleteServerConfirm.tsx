import { X } from "lucide-react";
import type { ServerConfigInfo } from "../types";

interface DeleteServerConfirmProps {
  configBusy: boolean;
  deletingServer: ServerConfigInfo;
  deletingServerId: string;
  removeServerConfig: (serverId: string) => Promise<void>;
  setDeletingServerId: (value: string | null) => void;
}

export function DeleteServerConfirm({configBusy, deletingServer, deletingServerId, removeServerConfig, setDeletingServerId}: DeleteServerConfirmProps) {
  return (
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
  );
}
