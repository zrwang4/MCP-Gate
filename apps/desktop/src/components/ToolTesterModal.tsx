import { X } from "lucide-react";
import type { ToolInfo } from "../types";

interface ToolTesterModalProps {
  runToolTest: () => Promise<void>;
  setTestTool: (value: ToolInfo | null) => void;
  setTestToolArgs: (value: string) => void;
  testTool: ToolInfo;
  testToolArgs: string;
  testToolBusy: boolean;
  testToolResult: string;
}

export function ToolTesterModal({
  runToolTest,
  setTestTool,
  setTestToolArgs,
  testTool,
  testToolArgs,
  testToolBusy,
  testToolResult,
}: ToolTesterModalProps) {
  return (
  <div className="modalBackdrop" role="presentation" onMouseDown={() => setTestTool(null)}>
    <section
      className="modalCard toolTesterCard"
      role="dialog"
      aria-modal="true"
      aria-label="Tool 测试器"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="modalHeader">
        <div>
          <h2>Tool 测试器</h2>
          <p><code>{testTool.publicName}</code> · 调用可能产生真实副作用，请确认参数。</p>
        </div>
        <button className="iconButton" onClick={() => setTestTool(null)} aria-label="关闭">
          <X size={17} />
        </button>
      </div>
      <label className="field">
        <span>Arguments JSON</span>
        <textarea
          value={testToolArgs}
          onChange={(event) => setTestToolArgs(event.target.value)}
          rows={7}
          spellCheck={false}
        />
      </label>
      {testToolResult && (
        <label className="field">
          <span>Result</span>
          <pre className="toolResult">{testToolResult}</pre>
        </label>
      )}
      <div className="modalActions">
        <button className="secondaryButton" onClick={() => setTestTool(null)}>关闭</button>
        <button
          className="actionButton primary"
          disabled={testToolBusy}
          onClick={() => void runToolTest()}
        >
          {testToolBusy ? "运行中…" : "运行 Tool"}
        </button>
      </div>
    </section>
  </div>
  );
}
