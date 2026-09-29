import { X } from "lucide-react";
import type { ConnectionTestState, StatusResponse } from "../types";

interface AddServerModalProps {
  configBusy: boolean;
  connectionTestState: ConnectionTestState | null;
  setConnectionTestState: (value: ConnectionTestState | null) => void;
  connectionTestBusy: boolean;
  editingServerId: string | null;
  newServerArgs: string;
  newServerCommand: string;
  newServerCwd: string;
  newServerEnv: string;
  newServerHeaders: string;
  newServerName: string;
  newServerSecretEnv: string;
  newServerTransport: "stdio" | "http";
  newServerUrl: string;
  saveServerConfig: () => Promise<void>;
  setEditingServerId: (value: string | null) => void;
  setNewServerArgs: (value: string) => void;
  setNewServerCommand: (value: string) => void;
  setNewServerCwd: (value: string) => void;
  setNewServerEnv: (value: string) => void;
  setNewServerHeaders: (value: string) => void;
  setNewServerName: (value: string) => void;
  setNewServerSecretEnv: (value: string) => void;
  setNewServerTransport: (value: 'stdio' | 'http') => void;
  setNewServerUrl: (value: string) => void;
  setShowAddServer: (value: boolean) => void;
  status: StatusResponse | null;
  testServerConnection: () => Promise<void>;
}

export function AddServerModal({
  configBusy,
  connectionTestState,
  setConnectionTestState,
  connectionTestBusy,
  editingServerId, newServerArgs, newServerCommand, newServerCwd, newServerEnv, newServerHeaders, newServerName, newServerSecretEnv, newServerTransport, newServerUrl, saveServerConfig, setEditingServerId, setNewServerArgs, setNewServerCommand, setNewServerCwd, setNewServerEnv, setNewServerHeaders, setNewServerName, setNewServerSecretEnv, setNewServerTransport, setNewServerUrl, setShowAddServer, status, testServerConnection}: AddServerModalProps) {
  return (
  <div className="modalBackdrop" role="presentation" onMouseDown={() => {
    if (connectionTestBusy || configBusy) return;
    setShowAddServer(false);
    setEditingServerId(null);
    setConnectionTestState(null);
  }}>
    <section className="modalCard" role="dialog" aria-modal="true" aria-label={editingServerId ? "编辑 MCP" : "添加 MCP"} onMouseDown={(event) => event.stopPropagation()}>
      <div className="modalHeader">
        <div>
          <h2>{editingServerId ? "编辑 MCP" : "添加 MCP"}</h2>
          <p>{editingServerId ? "保存时会先断开当前连接，alias 保持不变。" : "支持 stdio 与 HTTP MCP；HTTP 请求头在自定义 Header 中逐条配置。"}</p>
        </div>
        <button
          className="iconButton"
          disabled={connectionTestBusy || configBusy}
          onClick={() => {
            setShowAddServer(false);
            setEditingServerId(null);
            setConnectionTestState(null);
          }}
          aria-label="关闭"
        >
          <X size={17} />
        </button>
      </div>
      <label className="field">
        <span>名称</span>
        <input value={newServerName} onChange={(event) => setNewServerName(event.target.value)} placeholder="例如 GitHub" />
      </label>
      <label className="field">
        <span>类型</span>
        <select
          value={newServerTransport}
          onChange={(event) => setNewServerTransport(event.target.value as "stdio" | "http")}
        >
          <option value="stdio">本地命令（stdio）</option>
          <option value="http">远端 MCP（HTTP）</option>
        </select>
      </label>
      {newServerTransport === "stdio" ? (
        <>
      <label className="field">
        <span>命令</span>
        <input value={newServerCommand} onChange={(event) => setNewServerCommand(event.target.value)} placeholder="例如 npx" />
      </label>
      <label className="field">
        <span>参数（每行一个）</span>
        <textarea value={newServerArgs} onChange={(event) => setNewServerArgs(event.target.value)} rows={4} placeholder={"-y\n@modelcontextprotocol/server-github"} />
      </label>
      <label className="field">
        <span>工作目录（可选）</span>
        <input value={newServerCwd} onChange={(event) => setNewServerCwd(event.target.value)} placeholder="/Users/me/project" />
      </label>
      <label className="field">
        <span>环境变量（每行 KEY=VALUE）</span>
        <textarea
          value={newServerEnv}
          onChange={(event) => setNewServerEnv(event.target.value)}
          rows={3}
          placeholder={"API_URL=https://example.com\nMODE=production"}
          spellCheck={false}
        />
        <small>普通变量会保存在 servers.json；SDK 仍会自动继承 HOME、PATH、SHELL 等安全默认环境。</small>
      </label>
      <label className="field">
        <span>Secret 环境变量（每行 KEY=VALUE）</span>
        <textarea
          value={newServerSecretEnv}
          onChange={(event) => setNewServerSecretEnv(event.target.value)}
          rows={3}
          placeholder={"GITHUB_TOKEN=...\nAPI_KEY=..."}
          spellCheck={false}
        />
        <small>Secret 只写入 macOS Keychain。编辑已有 Secret 时保留 KEY= 空值即可保持原值；删除整行会清除它。</small>
      </label>
        </>
      ) : (
        <>
          <label className="field">
            <span>MCP URL</span>
            <input
              value={newServerUrl}
              onChange={(event) => setNewServerUrl(event.target.value)}
              placeholder="https://example.com/mcp"
            />
          </label>
          <label className="field">
            <span>自定义 Header（每行 KEY=VALUE）</span>
            <textarea
              value={newServerHeaders}
              onChange={(event) => setNewServerHeaders(event.target.value)}
              rows={3}
              placeholder={"X-Apifox-Api-Version=2025-09-01\nX-Custom-Header=value"}
              spellCheck={false}
            />
            <small>
              随每次请求发送，以明文保存在 servers.json。Authorization 也直接写在这里
              （例如 Authorization=Bearer ...）；文件权限为 0600，仅当前用户可读。
            </small>
          </label>
        </>
      )}
      {connectionTestState && (
        <div
          className={`connectionTestResult ${connectionTestState.status}`}
          role="status"
        >
          {connectionTestState.status === "success" ? (
            <>
              <div className="connectionTestSummary">
                <strong>连接成功</strong>
                <span>
                  {connectionTestState.result.toolCount} 个 Tools ·
                  {" "}
                  {connectionTestState.result.durationMs} ms
                </span>
              </div>
              {connectionTestState.result.toolNames.length > 0 && (
                <div className="connectionTestTools">
                  {connectionTestState.result.toolNames
                    .slice(0, 12)
                    .map((toolName) => (
                      <code key={toolName}>{toolName}</code>
                    ))}
                  {connectionTestState.result.toolNames.length > 12 && (
                    <span>
                      +{connectionTestState.result.toolNames.length - 12}
                    </span>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <strong>连接失败</strong>
              <span>{connectionTestState.error}</span>
            </>
          )}
          <small>
            这是临时连接测试，不会保存配置；修改表单后请重新测试。
          </small>
        </div>
      )}

      <div className="modalActions">
        <button
          className="secondaryButton"
          disabled={connectionTestBusy || configBusy}
          onClick={() => {
            setShowAddServer(false);
            setEditingServerId(null);
            setConnectionTestState(null);
          }}
        >
          取消
        </button>
        <button
          className="secondaryButton"
          disabled={
            connectionTestBusy ||
            configBusy ||
            (newServerTransport === "stdio"
              ? !newServerCommand.trim()
              : !newServerUrl.trim())
          }
          onClick={() => void testServerConnection()}
        >
          {connectionTestBusy ? "测试中…" : "测试连接"}
        </button>
        <button
          className="actionButton primary"
          disabled={
            configBusy ||
            connectionTestBusy ||
            !newServerName.trim() ||
            (newServerTransport === "stdio"
              ? !newServerCommand.trim()
              : !newServerUrl.trim())
          }
          onClick={() => void saveServerConfig()}
        >
          {configBusy ? "保存中…" : editingServerId ? "保存修改" : "保存配置"}
        </button>
      </div>
    </section>
  </div>
  );
}
