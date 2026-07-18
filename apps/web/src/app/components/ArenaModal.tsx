import { useState } from "react";
import type { BotModelOption, BotModelRefDto, RoomDto } from "@ddz/protocol";
import type { ReasoningEffort } from "../../botPreferences";
import { modelProfile } from "../../modelProfiles";
import { Modal } from "./Modal";

/** 竞技场思考强度档位:reasoning 直播是核心观赏点,默认中档;关闭最省 token 但面板只剩编号。 */
const ARENA_EFFORT_OPTIONS: readonly { readonly value: ReasoningEffort; readonly label: string }[] = [
  { value: "medium", label: "中（推荐）" },
  { value: "low", label: "低" },
  { value: "high", label: "高" },
  { value: "auto", label: "模型默认" },
  { value: "off", label: "关闭（最省，无思考直播）" }
];

interface ArenaModalProps {
  readonly arenaRooms: readonly RoomDto[];
  readonly botModels: readonly BotModelOption[];
  readonly onClose: () => void;
  readonly onCreate: (lineup: readonly BotModelRefDto[], reasoningEffort: ReasoningEffort) => void;
  readonly onRefresh: () => void;
  readonly onWatch: (code: string) => void;
}

/** 竞技场弹窗：直播房观战列表 + 三席位阵容选择开新赛 */
export function ArenaModal({ arenaRooms, botModels, onClose, onCreate, onRefresh, onWatch }: ArenaModalProps) {
  // 每席位存 botModels 下标；默认三席错开选不同模型
  const [picks, setPicks] = useState<readonly number[]>(() =>
    [0, 1, 2].map((seat) => (botModels.length ? seat % botModels.length : 0))
  );
  const [effort, setEffort] = useState<ReasoningEffort>("medium");

  const pickSeat = (seat: number, index: number): void => {
    setPicks((current) => current.map((pick, position) => (position === seat ? index : pick)));
  };

  return (
    <Modal title="AI 竞技场" onClose={onClose}>
      <div className="section-heading">
        <span className="modal-hint">大模型同桌对战，围观每一手思考</span>
        <button type="button" className="btn-img btn-img-wood btn-img-sm" onClick={onRefresh}>
          刷新
        </button>
      </div>
      <div className="room-list">
        {arenaRooms.length ? (
          arenaRooms.slice(0, 5).map((room) => (
            <button type="button" key={room.id} className="room-row" onClick={() => onWatch(room.code)}>
              <span className="room-medal">播</span>
              <span className="room-copy">
                <strong>{room.code}</strong>
                <span>{room.status === "playing" ? "对战进行中" : "等待开赛"}</span>
              </span>
              <span className="room-enter">观战</span>
            </button>
          ))
        ) : (
          <p className="empty-state">暂无直播，开一场吧</p>
        )}
      </div>

      <div className="section-heading arena-create-heading">
        <span className="modal-hint">选择三位选手开新一场</span>
      </div>
      {botModels.length ? (
        <div className="arena-create">
          {picks.map((pick, seat) => {
            const picked = botModels[pick];
            return (
              <label key={seat} className="arena-seat-pick">
                <img src={modelProfile(picked?.model ?? "", picked?.provider).avatar} alt="" />
                <select value={pick} onChange={(event) => pickSeat(seat, Number(event.target.value))}>
                  {botModels.map((option, index) => (
                    <option key={`${option.provider}/${option.model}`} value={index}>
                      {option.providerLabel} · {option.model}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          <label className="arena-effort-pick">
            <span>思考强度</span>
            <select value={effort} onChange={(event) => setEffort(event.target.value as ReasoningEffort)}>
              {ARENA_EFFORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-img btn-img-ai btn-img-sm arena-create-button"
            onClick={() =>
              onCreate(
                picks.flatMap((pick) => {
                  const option = botModels[pick];
                  return option ? [{ provider: option.provider, model: option.model }] : [];
                }),
                effort
              )
            }
          >
            开赛
          </button>
        </div>
      ) : (
        <p className="empty-state">服务端未配置可用模型，暂时无法开赛</p>
      )}
    </Modal>
  );
}
