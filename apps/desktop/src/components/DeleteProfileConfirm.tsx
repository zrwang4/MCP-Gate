import { X } from "lucide-react";
import type { ProfileInfo } from "../types";

interface DeleteProfileConfirmProps {
  deletingProfileId: string;
  profileBusy: boolean;
  profiles: ProfileInfo[];
  removeProfile: (profileId: string) => Promise<void>;
  setDeletingProfileId: (value: string | null) => void;
}

export function DeleteProfileConfirm({deletingProfileId, profileBusy, profiles, removeProfile, setDeletingProfileId}: DeleteProfileConfirmProps) {
  return (
  <div className="modalBackdrop" role="presentation" onMouseDown={() => setDeletingProfileId(null)}>
    <section className="modalCard confirmCard" role="dialog" aria-modal="true" aria-label="删除 Profile 确认" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modalHeader">
        <div>
          <h2>删除 Profile</h2>
          <p>此操作会移除场景配置；如果它正在使用，会同时停用该场景。</p>
        </div>
        <button className="iconButton" onClick={() => setDeletingProfileId(null)} aria-label="关闭">
          <X size={17} />
        </button>
      </div>
      <p className="confirmText">
        确定要删除“{profiles.find((profile) => profile.id === deletingProfileId)?.name ?? "当前 Profile"}”吗？
      </p>
      <div className="modalActions">
        <button className="secondaryButton" onClick={() => setDeletingProfileId(null)}>取消</button>
        <button
          className="actionButton danger"
          disabled={profileBusy}
          onClick={() => void removeProfile(deletingProfileId)}
        >
          {profileBusy ? "删除中…" : "删除"}
        </button>
      </div>
    </section>
  </div>
  );
}
