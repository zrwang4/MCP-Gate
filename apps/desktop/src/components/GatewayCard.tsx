import { Check, Copy, Layers3, RefreshCw, X } from "lucide-react";
import type { CoreRuntimeStatus, ProfileInfo, ServerConfigInfo, ServerStatus } from "../types";
import { coreRuntimeLabel, statusLabel } from "../lib/format";

interface GatewayCardProps {
  activeProfile: ProfileInfo | null;
  activeProfileId: string | null;
  copied: boolean;
  copyGatewaySseUrl: () => Promise<void>;
  copyGatewayUrl: () => Promise<void>;
  coreRuntime: CoreRuntimeStatus | null;
  enabledToolCount: number;
  gatewaySseUrl: string;
  gatewayState: ServerStatus | "error";
  gatewayUrl: string;
  profileSwitchBusy: boolean;
  profiles: ProfileInfo[];
  quickSwitchProfile: (nextProfileId: string) => Promise<void>;
  refresh: () => Promise<void>;
  runningCount: number;
  serverConfigs: ServerConfigInfo[];
  sseCopied: boolean;
}

export function GatewayCard({activeProfile, activeProfileId, copied, copyGatewaySseUrl, copyGatewayUrl, coreRuntime, enabledToolCount, gatewaySseUrl, gatewayState, gatewayUrl, profileSwitchBusy, profiles, quickSwitchProfile, refresh, runningCount, serverConfigs, sseCopied}: GatewayCardProps) {
  return (
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
    <span className="endpointLabel">Streamable HTTP</span>
    <code>{gatewayUrl}</code>
    <button className="copyButton" onClick={() => void copyGatewayUrl()}>
      {copied ? <Check size={15} /> : <Copy size={15} />}
      {copied ? "已复制" : "复制"}
    </button>
  </div>

  <div className="endpointRow secondary">
    <span className="endpointLabel">
      SSE 兼容
      <small>旧版客户端用这个地址</small>
    </span>
    <code>{gatewaySseUrl}</code>
    <button className="copyButton" onClick={() => void copyGatewaySseUrl()}>
      {sseCopied ? <Check size={15} /> : <Copy size={15} />}
      {sseCopied ? "已复制" : "复制"}
    </button>
  </div>

  <div className="profileQuickSwitch">
    <div>
      <Layers3 size={15} />
      <span>当前场景</span>
      <strong>{activeProfile?.name ?? "手动模式"}</strong>
    </div>
    <select
      value={activeProfileId ?? ""}
      disabled={profileSwitchBusy}
      onChange={(event) => void quickSwitchProfile(event.target.value)}
      aria-label="切换 Profile"
    >
      <option value="">手动模式（无 Profile）</option>
      {profiles.map((profile) => (
        <option value={profile.id} key={profile.id}>
          {profile.name}
        </option>
      ))}
    </select>
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
      <span>Profile</span>
      <strong>{activeProfile?.name ?? "手动模式"}</strong>
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
  );
}
