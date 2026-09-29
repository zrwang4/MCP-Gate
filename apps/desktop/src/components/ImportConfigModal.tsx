import { X } from "lucide-react";
import type { McpImportApplyResult, McpImportPreview, McpImportSourceInfo } from "../types";

interface ImportConfigModalProps {
  applyImportConfig: () => Promise<void>;
  importApplyResult: McpImportApplyResult | null;
  importBusy: boolean;
  importConfigText: string;
  importPreview: McpImportPreview | null;
  importSourceId: string | null;
  importSources: McpImportSourceInfo[];
  previewImportConfig: () => Promise<void>;
  previewImportSource: (sourceId: string) => Promise<void>;
  refreshImportSources: () => Promise<void>;
  setImportApplyResult: (value: McpImportApplyResult | null) => void;
  setImportConfigText: (value: string) => void;
  setImportPreview: (value: McpImportPreview | null) => void;
  setImportSourceId: (value: string | null) => void;
  setImportSourceSnapshot: (value: McpImportSourceInfo | null) => void;
  setShowImportConfig: (value: boolean) => void;
}

export function ImportConfigModal({applyImportConfig, importApplyResult, importBusy, importConfigText, importPreview, importSourceId, importSources, previewImportConfig, previewImportSource, refreshImportSources, setImportApplyResult, setImportConfigText, setImportPreview, setImportSourceId, setImportSourceSnapshot, setShowImportConfig}: ImportConfigModalProps) {
  return (
  <div
    className="modalBackdrop"
    role="presentation"
    onMouseDown={() => {
      if (importBusy) return;
      setShowImportConfig(false);
      setImportPreview(null);
      setImportApplyResult(null);
      setImportSourceId(null);
      setImportSourceSnapshot(null);
    }}
  >
    <section
      className="modalCard importConfigCard"
      role="dialog"
      aria-modal="true"
      aria-label="导入 MCP 配置"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="modalHeader">
        <div>
          <h2>导入 MCP 配置</h2>
          <p>
            支持 Claude / Cursor 风格 mcpServers JSON。先预览，再写入 Registry 和 Keychain。
          </p>
        </div>
        <button
          className="iconButton"
          disabled={importBusy}
          onClick={() => {
            setShowImportConfig(false);
            setImportPreview(null);
            setImportApplyResult(null);
          }}
          aria-label="关闭"
        >
          <X size={17} />
        </button>
      </div>

      <div className="importSources">
        <div className="importSourcesHeader">
          <div>
            <strong>本机配置</strong>
            <span>Core 直接读取，原始 JSON 和 Secret 不会发给 WebView</span>
          </div>
          <button
            type="button"
            className="profilePickerButton"
            disabled={importBusy}
            onClick={() => void refreshImportSources()}
          >
            刷新检测
          </button>
        </div>

        {importSources.map((source) => (
          <button
            type="button"
            className={`importSourceRow ${importSourceId === source.id ? "selected" : ""}`}
            key={source.id}
            disabled={importBusy || !source.exists}
            onClick={() => void previewImportSource(source.id)}
          >
            <div>
              <strong>{source.label}</strong>
              <code>{source.displayPath}</code>
            </div>
            <span className={source.exists ? "sourceFound" : "sourceMissing"}>
              {source.exists ? "预览" : "未发现"}
            </span>
          </button>
        ))}
      </div>

      <div className="importDivider"><span>或粘贴 JSON</span></div>

      <label className="field">
        <span>JSON 配置</span>
        <textarea
          className="importConfigText"
          value={importConfigText}
          onChange={(event) => {
            setImportConfigText(event.target.value);
            setImportPreview(null);
            setImportApplyResult(null);
            setImportSourceId(null);
            setImportSourceSnapshot(null);
          }}
          rows={10}
          spellCheck={false}
          placeholder={'{\n  "mcpServers": {\n    "github": {\n      "command": "npx",\n      "args": ["-y", "server-package"],\n      "env": { "GITHUB_TOKEN": "..." }\n    }\n  }\n}'}
        />
        <small>
          Preview 不回显 Secret 值；敏感 env 和 HTTP Authorization 在导入时写入 macOS Keychain。
        </small>
      </label>

      {importPreview && (
        <div className="importPreview">
          <div className="importPreviewHeader">
            <strong>{importPreview.candidates.length} 个可导入</strong>
            <span>{importPreview.issues.length} 个问题</span>
          </div>

          {importPreview.candidates.map((candidate) => (
            <div className="importCandidate" key={candidate.sourceName}>
              <div className="importCandidateHeader">
                <strong>{candidate.name}</strong>
                <span className="toolSource">{candidate.transport.toUpperCase()}</span>
              </div>
              <code>
                {candidate.transport === "stdio"
                  ? `${candidate.command ?? ""} ${(candidate.args ?? []).join(" ")}`
                  : candidate.url}
              </code>
              <div className="importMeta">
                {candidate.plainEnvKeys.length > 0 && (
                  <span>Env: {candidate.plainEnvKeys.join(", ")}</span>
                )}
                {candidate.secretEnvKeys.length > 0 && (
                  <span>Keychain: {candidate.secretEnvKeys.join(", ")}</span>
                )}
                {candidate.headerKeys.length > 0 && (
                  <span>Header: {candidate.headerKeys.join(", ")}</span>
                )}
                {candidate.hasAuthorization && (
                  <span>Authorization → Keychain</span>
                )}
              </div>
              {candidate.warnings.map((warning) => (
                <div className="importWarning" key={warning}>{warning}</div>
              ))}
            </div>
          ))}

          {importPreview.issues.map((issue, index) => (
            <div
              className="importIssue"
              key={`${issue.sourceName ?? "config"}:${index}`}
            >
              <strong>{issue.sourceName ?? "配置"}</strong>
              <span>{issue.message}</span>
            </div>
          ))}
        </div>
      )}

      {importApplyResult && (
        <div className="importResult">
          <strong>导入结果</strong>
          <span>
            已导入 {importApplyResult.imported.length} ·
            跳过 {importApplyResult.skipped.length} ·
            失败 {importApplyResult.failed.length}
          </span>
          {importApplyResult.failed.map((item) => (
            <div className="importIssue" key={`failed:${item.sourceName}`}>
              <strong>{item.sourceName}</strong>
              <span>{item.error}</span>
            </div>
          ))}
        </div>
      )}

      <div className="modalActions">
        <button
          className="secondaryButton"
          disabled={importBusy}
          onClick={() => {
            setShowImportConfig(false);
            setImportPreview(null);
            setImportApplyResult(null);
          }}
        >
          关闭
        </button>
        <button
          className="secondaryButton"
          disabled={importBusy || !importConfigText.trim() || Boolean(importSourceId)}
          onClick={() => void previewImportConfig()}
        >
          {importBusy ? "处理中…" : "预览"}
        </button>
        <button
          className="actionButton primary"
          disabled={
            importBusy ||
            !importPreview ||
            importPreview.candidates.length === 0
          }
          onClick={() => void applyImportConfig()}
        >
          {importBusy
            ? "导入中…"
            : `导入 ${importPreview?.candidates.length ?? 0} 个`}
        </button>
      </div>
    </section>
  </div>
  );
}
