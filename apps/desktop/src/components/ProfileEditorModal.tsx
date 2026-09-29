import { X } from "lucide-react";
import type { ProfileInfo, ServerConfigInfo, StatusResponse, UpstreamInfo } from "../types";
import { serverIconFor } from "../lib/format";

interface ProfileEditorModalProps {
  editingProfileId: string | null;
  profileBusy: boolean;
  profileName: string;
  profileServerIds: string[];
  saveProfile: () => Promise<void>;
  serverConfigs: ServerConfigInfo[];
  setEditingProfileId: (value: string | null) => void;
  setProfileName: (value: string) => void;
  setProfileServerIds: (value: string[]) => void;
  setShowProfileEditor: (value: boolean) => void;
  status: StatusResponse | null;
  toggleProfileServer: (serverId: string) => void;
  upstreams: UpstreamInfo[];
}

export function ProfileEditorModal({editingProfileId, profileBusy, profileName, profileServerIds, saveProfile, serverConfigs, setEditingProfileId, setProfileName, setProfileServerIds, setShowProfileEditor, status, toggleProfileServer, upstreams}: ProfileEditorModalProps) {
  return (
  <div className="modalBackdrop" role="presentation" onMouseDown={() => {
    setShowProfileEditor(false);
    setEditingProfileId(null);
  }}>
    <section
      className="modalCard"
      role="dialog"
      aria-modal="true"
      aria-label={editingProfileId ? "编辑 Profile" : "新建 Profile"}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="modalHeader">
        <div>
          <h2>{editingProfileId ? "编辑 Profile" : "新建 Profile"}</h2>
          <p>
            激活后，只保留选中的 MCP 运行；编辑当前 Profile 并保存时也会立即按新成员重算运行集合。
          </p>
        </div>
        <button
          className="iconButton"
          onClick={() => {
            setShowProfileEditor(false);
            setEditingProfileId(null);
          }}
          aria-label="关闭"
        >
          <X size={17} />
        </button>
      </div>

      <label className="field">
        <span>名称</span>
        <input
          value={profileName}
          onChange={(event) => setProfileName(event.target.value)}
          placeholder="例如 Coding"
        />
      </label>

      <div className="profilePicker">
        <div className="profilePickerToolbar">
          <span className="profilePickerTitle">MCP 成员</span>
          <div>
            <button
              type="button"
              className="profilePickerButton"
              onClick={() =>
                setProfileServerIds(
                  upstreams
                    .filter((upstream) => upstream.status === "running")
                    .map((upstream) => upstream.id),
                )
              }
            >
              使用当前运行集合
            </button>
            <button
              type="button"
              className="profilePickerButton"
              onClick={() =>
                setProfileServerIds(
                  serverConfigs
                    .filter((server) => server.enabled)
                    .map((server) => server.id),
                )
              }
            >
              全选已启用
            </button>
            <button
              type="button"
              className="profilePickerButton"
              onClick={() => setProfileServerIds([])}
            >
              清空
            </button>
          </div>
        </div>
        {serverConfigs.length === 0 ? (
          <div className="emptyState compact">
            <span>先添加 MCP，再创建 Profile。</span>
          </div>
        ) : (
          serverConfigs.map((server) => (
            <label className="profilePickerRow" key={server.id}>
              <input
                type="checkbox"
                checked={profileServerIds.includes(server.id)}
                onChange={() => toggleProfileServer(server.id)}
              />
              <div>
                <strong>{server.name}</strong>
                <span>
                  {server.transport.toUpperCase()} · {server.alias}
                  {!server.enabled ? " · 已禁用" : ""}
                </span>
              </div>
            </label>
          ))
        )}
      </div>

      <div className="modalActions">
        <button
          className="secondaryButton"
          onClick={() => {
            setShowProfileEditor(false);
            setEditingProfileId(null);
          }}
        >
          取消
        </button>
        <button
          className="actionButton primary"
          disabled={profileBusy || !profileName.trim()}
          onClick={() => void saveProfile()}
        >
          {profileBusy ? "保存中…" : editingProfileId ? "保存修改" : "创建 Profile"}
        </button>
      </div>
    </section>
  </div>
  );
}
