import { X } from "lucide-react";

interface RestoreConfirmProps {
  backupBusy: 'export' | 'restore' | null;
  restoreCandidate: unknown;
  restoreConfigurationBackup: () => Promise<void>;
  setRestoreCandidate: (value: unknown | null) => void;
}

export function RestoreConfirm({backupBusy, restoreCandidate, restoreConfigurationBackup, setRestoreCandidate}: RestoreConfirmProps) {
  return (
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
  );
}
