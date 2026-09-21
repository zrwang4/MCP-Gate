import { Check, Copy, Folder, RefreshCw, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";

const GATEWAY_URL = "http://127.0.0.1:24888/mcp";
const HEALTH_URL = "http://127.0.0.1:24888/ping";

type GatewayState = "checking" | "online" | "offline";

export function App() {
  const [state, setState] = useState<GatewayState>("checking");
  const [copied, setCopied] = useState(false);

  async function checkGateway() {
    setState("checking");
    try {
      const response = await fetch(HEALTH_URL, {
        signal: AbortSignal.timeout(1200),
      });
      setState(response.ok ? "online" : "offline");
    } catch {
      setState("offline");
    }
  }

  async function copyGatewayUrl() {
    await navigator.clipboard.writeText(GATEWAY_URL);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  useEffect(() => {
    void checkGateway();
  }, []);

  const statusText =
    state === "online" ? "正在运行" : state === "checking" ? "检查中" : "未运行";

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">LOCAL MCP GATEWAY</div>
          <h1>MCP Gate</h1>
        </div>
        <button className="iconButton" aria-label="设置" title="设置（后续里程碑）">
          <Settings2 size={18} />
        </button>
      </header>

      <section className="gatewayCard">
        <div className="cardHeader">
          <div>
            <span className={`statusDot ${state}`} />
            <span className="statusText">{statusText}</span>
          </div>
          <button className="ghostButton" onClick={() => void checkGateway()}>
            <RefreshCw size={15} />
            检查
          </button>
        </div>

        <div className="endpointRow">
          <code>{GATEWAY_URL}</code>
          <button className="copyButton" onClick={() => void copyGatewayUrl()}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "已复制" : "复制"}
          </button>
        </div>

        <p className="hint">
          P0 阶段：先在终端启动 Core；后续里程碑会由 Tauri 自动管理 Core 生命周期。
        </p>
      </section>

      <section className="section">
        <div className="sectionTitle">
          <h2>MCP 服务</h2>
          <span>1 个 PoC</span>
        </div>

        <article className="serverCard">
          <div className="serverIcon">
            <Folder size={19} />
          </div>
          <div className="serverInfo">
            <strong>Filesystem</strong>
            <span>通过 mcp-proxy 暴露为 Streamable HTTP</span>
          </div>
          <span className={`pill ${state === "online" ? "success" : "muted"}`}>
            {state === "online" ? "运行中" : "未连接"}
          </span>
        </article>
      </section>

      <footer>
        <span>MG-001 → MG-005</span>
        <span>Core PoC · mcp-proxy 6.7.18</span>
      </footer>
    </main>
  );
}
