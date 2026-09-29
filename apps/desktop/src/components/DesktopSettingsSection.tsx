import { Activity, Check, Copy, Download, FileText, RefreshCw, Settings2, Upload, X } from "lucide-react";
import { IS_TAURI } from "../api";
import type { StatusResponse, UpdateMetadata } from "../types";

interface DesktopSettingsSectionProps {
  autostartBusy: boolean;
  autostartEnabled: boolean | null;
  availableUpdate: UpdateMetadata | null;
  backupBusy: 'export' | 'restore' | null;
  backupInputRef: React.RefObject<HTMLInputElement | null>;
  backupMessage: string | null;
  checkForUpdate: () => Promise<void>;
  copyDiagnosticsSnapshot: () => Promise<void>;
  diagnosticsBusy: boolean;
  diagnosticsCopied: boolean;
  disableGatewayApiKey: () => Promise<void>;
  exportConfigurationBackup: () => Promise<void>;
  generatedGatewayKey: string | null;
  gatewayKeyBusy: boolean;
  gatewayKeyCopied: boolean;
  installAvailableUpdate: () => Promise<void>;
  lanAccessBusy: boolean;
  managementConnected: boolean;
  rotateGatewayApiKey: () => Promise<void>;
  selectBackupFile: (file: File | undefined) => void;
  sessionSettingBusy: boolean;
  setGeneratedGatewayKey: (value: string | null) => void;
  setRestoreCandidate: (value: unknown | null) => void;
  status: StatusResponse | null;
  toggleAutostart: () => Promise<void>;
  toggleLanAccess: () => Promise<void>;
  updateBusy: 'checking' | 'installing' | null;
  updateError: string | null;
  updateMessage: string | null;
  updateSessionIdleTimeout: (minutes: number) => Promise<void>;
}

export function DesktopSettingsSection({autostartBusy, autostartEnabled, availableUpdate, backupBusy, backupInputRef, backupMessage, checkForUpdate, copyDiagnosticsSnapshot, diagnosticsBusy, diagnosticsCopied, disableGatewayApiKey, exportConfigurationBackup, generatedGatewayKey, gatewayKeyBusy, gatewayKeyCopied, installAvailableUpdate, lanAccessBusy, managementConnected, rotateGatewayApiKey, selectBackupFile, sessionSettingBusy, setGeneratedGatewayKey, setRestoreCandidate, status, toggleAutostart, toggleLanAccess, updateBusy, updateError, updateMessage, updateSessionIdleTimeout}: DesktopSettingsSectionProps) {
  return (
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
        <strong>MCP 会话生命周期</strong>
        <span>无活动的 Gateway MCP 会话会自动过期。修改后 Core 会自动重启以应用新值。</span>
      </div>
      <select
        className="sessionTimeoutSelect"
        value={status?.core.sessionIdleTimeoutMs
          ? String(Math.round(status.core.sessionIdleTimeoutMs / 60_000))
          : "30"}
        disabled={sessionSettingBusy || !managementConnected}
        onChange={(event) => void updateSessionIdleTimeout(Number(event.target.value))}
        aria-label="设置 MCP 会话生命周期"
      >
        <option value="5">5 分钟</option>
        <option value="15">15 分钟</option>
        <option value="30">30 分钟</option>
        <option value="60">1 小时</option>
        <option value="120">2 小时</option>
        <option value="360">6 小时</option>
        <option value="720">12 小时</option>
        <option value="1440">24 小时</option>
      </select>
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
        {updateError && (
          <span className="updateError">{updateError}</span>
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

    <div className="settingsRow">
      <div>
        <strong>配置备份</strong>
        <span>
          导出 Server、Profile、Tool 策略和 Gateway 配置。备份不会包含 Keychain 中保存的 Secret 值。
          {backupMessage ? ` ${backupMessage}` : ""}
        </span>
      </div>
      <div className="settingsActions">
        <input
          ref={backupInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => selectBackupFile(event.target.files?.[0])}
        />
        <button
          className="secondaryButton"
          disabled={backupBusy !== null || !managementConnected}
          onClick={() => void exportConfigurationBackup()}
        >
          <Download size={14} /> {backupBusy === "export" ? "导出中…" : "导出"}
        </button>
        <button
          className="secondaryButton"
          disabled={backupBusy !== null || !managementConnected}
          onClick={() => backupInputRef.current?.click()}
        >
          <Upload size={14} /> 选择恢复文件
        </button>
      </div>
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
  );
}
