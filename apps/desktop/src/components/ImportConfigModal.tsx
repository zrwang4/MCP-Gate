import { X } from "lucide-react";
import type { McpImportApplyResult, McpImportPreview } from "../types";

interface ImportConfigModalProps {
  applyImportConfig: () => Promise<void>;
  importApplyResult: McpImportApplyResult | null;
  importBusy: boolean;
  importConfigText: string;
  importPreview: McpImportPreview | null;
  previewImportConfig: () => Promise<void>;
  setImportApplyResult: (value: McpImportApplyResult | null) => void;
  setImportConfigText: (value: string) => void;
  setImportPreview: (value: McpImportPreview | null) => void;
  setShowImportConfig: (value: boolean) => void;
}

export function ImportConfigModal({applyImportConfig, importApplyResult, importBusy, importConfigText, importPreview, previewImportConfig, setImportApplyResult, setImportConfigText, setImportPreview, setShowImportConfig}: ImportConfigModalProps) {
  return (
  <div
    className="modalBackdrop"
    role="presentation"
    onMouseDown={() => {
      if (importBusy) return;
      setShowImportConfig(false);
      setImportPreview(null);
      setImportApplyResult(null);
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

      <label className="field">
        <span>JSON 配置</span>
        <textarea
          className="importConfigText"
          value={importConfigText}
          onChange={(event) => {
            setImportConfigText(event.target.value);
            setImportPreview(null);
            setImportApplyResult(null);
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
          disabled={importBusy || !importConfigText.trim()}
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
