import { Layers3, Pencil, Play, Plus, Square, Trash2, X } from "lucide-react";
import type { ProfileInfo, ServerConfigInfo, StatusResponse, UpstreamInfo } from "../types";
import { serverIconFor, statusLabel } from "../lib/format";

interface ProfilesSectionProps {
  activeProfileId: string | null;
  busy: string | null;
  openCreateProfile: () => void;
  openEditProfile: (profile: ProfileInfo) => void;
  profileAction: (profileId: string, action: 'activate' | 'deactivate') => Promise<void>;
  profileBusy: boolean;
  profiles: ProfileInfo[];
  serverConfigs: ServerConfigInfo[];
  setDeletingProfileId: (value: string | null) => void;
  status: StatusResponse | null;
  upstreams: UpstreamInfo[];
}

export function ProfilesSection({activeProfileId, busy, openCreateProfile, openEditProfile, profileAction, profileBusy, profiles, serverConfigs, setDeletingProfileId, status, upstreams}: ProfilesSectionProps) {
  return (
<section className="section">
  <div className="sectionTitle">
    <div>
      <h2>Profiles</h2>
      <p>按场景保存一组 MCP，激活时精确切换运行集合</p>
    </div>
    <button className="secondaryButton" onClick={openCreateProfile}>
      <Plus size={14} /> 新建 Profile
    </button>
  </div>

  {profiles.length === 0 ? (
    <div className="emptyState compact">
      <Layers3 size={19} />
      <span>还没有 Profile。可以创建“Coding”“Research”等场景。</span>
    </div>
  ) : (
    <div className="profileGrid">
      {profiles.map((profile) => {
        const active = activeProfileId === profile.id;
        const changing = busy?.startsWith(`profile:${profile.id}:`) ?? false;
        const memberServers = profile.serverIds
          .map((id) => serverConfigs.find((server) => server.id === id))
          .filter((server): server is ServerConfigInfo => Boolean(server));
        const runningMembers = profile.serverIds.filter(
          (id) => upstreams.find((upstream) => upstream.id === id)?.status === "running",
        ).length;

        return (
          <article className={`profileCard ${active ? "active" : ""}`} key={profile.id}>
            <div className="profileHeader">
              <div>
                <div className="profileNameRow">
                  <Layers3 size={16} />
                  <strong>{profile.name}</strong>
                  {active && <span className="pill running">当前</span>}
                </div>
                <span>{runningMembers}/{profile.serverIds.length} 个成员运行中</span>
              </div>
              <div className="profileActions">
                <button
                  className={`actionButton ${active ? "" : "primary"}`}
                  disabled={changing}
                  onClick={() => void profileAction(
                    profile.id,
                    active ? "deactivate" : "activate",
                  )}
                >
                  {active ? <Square size={14} /> : <Play size={14} />}
                  {active ? "停用" : "激活"}
                </button>
                <button
                  className="actionButton"
                  disabled={profileBusy || changing}
                  onClick={() => openEditProfile(profile)}
                >
                  <Pencil size={14} /> 编辑
                </button>
                <button
                  className="actionButton danger"
                  disabled={profileBusy || changing}
                  onClick={() => setDeletingProfileId(profile.id)}
                >
                  <Trash2 size={14} /> 删除
                </button>
              </div>
            </div>

            <div className="profileMembers">
              {memberServers.length === 0 ? (
                <span className="profileEmpty">空 Profile：激活后会断开所有 MCP。</span>
              ) : (
                memberServers.map((server) => {
                  const running =
                    upstreams.find((upstream) => upstream.id === server.id)?.status === "running";
                  return (
                    <span
                      className={`profileMember ${running ? "running" : ""} ${server.enabled ? "" : "disabled"}`}
                      key={server.id}
                    >
                      {server.name}
                      {!server.enabled ? " · 禁用" : running ? " · 运行中" : ""}
                    </span>
                  );
                })
              )}
            </div>
          </article>
        );
      })}
    </div>
  )}
</section>
  );
}
