import type { ReactNode } from "react";
import type { BotModelOption, BotModelRefDto } from "@ddz/protocol";
import type { ReasoningEffort } from "../../lineupDefaults";
import { modelProfile } from "../../modelProfiles";

/** 思考强度档位:reasoning 直播是核心观赏点,默认中档;关闭最省 token 但面板只剩编号。 */
export const EFFORT_OPTIONS: readonly { readonly value: ReasoningEffort; readonly label: string }[] = [
  { value: "medium", label: "中（推荐）" },
  { value: "low", label: "低" },
  { value: "high", label: "高" },
  { value: "auto", label: "模型默认" },
  { value: "off", label: "关闭（最省，无思考直播）" }
];

interface LineupPickerProps {
  /** 席位数:竞技场 3/挑战桌 2 */
  readonly seats: 2 | 3;
  readonly botModels: readonly BotModelOption[];
  /** 各席位选中的 botModels 下标,由父级持有 */
  readonly picks: readonly number[];
  readonly onPick: (seat: number, index: number) => void;
  readonly effort: ReasoningEffort;
  readonly onEffort: (effort: ReasoningEffort) => void;
  /** 动作按钮(开赛/上桌),随选择器同容器布局 */
  readonly children?: ReactNode;
}

/** 席位阵容选择器:每席一个模型下拉(带头像)+ 思考强度档位;竞技场与挑战桌共用。 */
export function LineupPicker({ seats, botModels, picks, onPick, effort, onEffort, children }: LineupPickerProps) {
  return (
    <div className="arena-create">
      {Array.from({ length: seats }, (_, seat) => {
        const pick = picks[seat] ?? 0;
        const picked = botModels[pick];
        return (
          <label key={seat} className="arena-seat-pick">
            <img src={modelProfile(picked?.model ?? "", picked?.provider).avatar} alt="" />
            <select value={pick} onChange={(event) => onPick(seat, Number(event.target.value))}>
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
        <select value={effort} onChange={(event) => onEffort(event.target.value as ReasoningEffort)}>
          {EFFORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {children}
    </div>
  );
}

/** 默认阵容下标:各席错开选不同模型。 */
export function defaultLineupPicks(seats: number, modelCount: number): number[] {
  return Array.from({ length: seats }, (_, seat) => (modelCount ? seat % modelCount : 0));
}

/** 把 picks 下标翻成 {provider, model} 阵容(越界下标跳过,长度校验由服务端收口)。 */
export function lineupFromPicks(picks: readonly number[], botModels: readonly BotModelOption[]): BotModelRefDto[] {
  return picks.flatMap((pick) => {
    const option = botModels[pick];
    return option ? [{ provider: option.provider, model: option.model }] : [];
  });
}
