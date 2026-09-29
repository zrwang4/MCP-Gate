import { X } from "lucide-react";
import type { ToolInfo } from "../types";

interface ToolsSectionProps {
  tools: ToolInfo[];
  busy: string | null;
  openToolTester: (tool: ToolInfo) => void;
  toggleTool: (tool: ToolInfo) => Promise<void>;
  toolSearch: string;
  setToolSearch: (value: string) => void;
  toolPage: number;
  setToolPage: (value: number | ((page: number) => number)) => void;
  filteredTools: ToolInfo[];
  totalToolPages: number;
  safeToolPage: number;
  pagedTools: ToolInfo[];
}

export function ToolsSection({tools, busy, openToolTester, toggleTool, toolSearch, setToolSearch, toolPage, setToolPage, filteredTools, totalToolPages, safeToolPage, pagedTools}: ToolsSectionProps) {
  return (
<section className="section">
  <div className="sectionTitle">
    <div>
      <h2>Tools</h2>
      <p>只有启用的 Tool 会出现在统一 /mcp 的 tools/list</p>
    </div>
    <div className="toolToolbar">
      <div className="searchWithClear">
        <input
          className="toolSearch"
          value={toolSearch}
          onChange={(event) => setToolSearch(event.target.value)}
          placeholder="搜索工具名、来源或描述..."
        />
        {toolSearch && (
          <button
            className="iconButton clearSearchButton"
            onClick={() => setToolSearch("")}
            aria-label="清空搜索"
            title="清空搜索"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <span className="toolCount">{filteredTools.length} 个工具</span>
    </div>
  </div>

  {filteredTools.length === 0 ? (
    <div className="emptyState compact">
      <span>{tools.length === 0 ? "连接一个 MCP 后，这里会显示它暴露的 Tools。" : "没有匹配的 Tools。"}</span>
    </div>
  ) : (
    <>
      <div className="toolList">
        {pagedTools.map((tool) => {
          const changing = busy === `tool:${tool.publicName}`;
          return (
            <article className="toolRow" key={tool.publicName}>
              <div className="toolInfo">
                <div>
                  <code>{tool.publicName}</code>
                  <span className="toolSource">{tool.serverAlias}</span>
                </div>
                {tool.definition.description && (
                  <p>{tool.definition.description}</p>
                )}
              </div>
              <div className="toolActions">
                <button
                  className="actionButton"
                  disabled={!tool.enabled || changing}
                  onClick={() => openToolTester(tool)}
                >
                  测试
                </button>
                <button
                  className={`toolToggle ${tool.enabled ? "enabled" : ""}`}
                  disabled={changing}
                  onClick={() => void toggleTool(tool)}
                  aria-pressed={tool.enabled}
                >
                  {tool.enabled ? "已启用" : "已禁用"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <div className="pagination">
        <button
          className="ghostButton"
          disabled={safeToolPage <= 1}
          onClick={() => setToolPage((page) => page - 1)}
        >
          上一页
        </button>
        <span>
          {safeToolPage} / {totalToolPages}
        </span>
        <button
          className="ghostButton"
          disabled={safeToolPage >= totalToolPages}
          onClick={() => setToolPage((page) => page + 1)}
        >
          下一页
        </button>
      </div>
    </>
  )}
</section>
  );
}
