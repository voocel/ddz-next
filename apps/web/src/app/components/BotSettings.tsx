import type { BotModelOption } from "@ddz/protocol";
import type { BotPreferences } from "../../botPreferences";

/**
 * 设置弹窗内的「AI 对战」机器人模型选择:从 game-server 动态下发的清单里选(按 provider 分组),
 * API key 始终在服务端。option 值用扁平索引(模型名可能含「/」,不能直接拼成 value)。
 */
export function BotSettings({
  preferences,
  models,
  defaultRef,
  onChange
}: {
  preferences: BotPreferences;
  models: readonly BotModelOption[];
  /** 服务端默认模型(/bot-models 下发);用于把「服务端默认」这一项标注成具体模型名。 */
  defaultRef?: { readonly provider: string; readonly model: string } | null;
  onChange: (next: BotPreferences) => void;
}) {
  const selectedIndex = models.findIndex(
    (option) => option.provider === preferences.provider && option.model === preferences.model
  );
  const groups = groupByProvider(models);

  const handleChange = (value: string): void => {
    if (value === "") {
      onChange({ provider: "", model: "" });
      return;
    }
    const option = models[Number(value)];
    if (option) {
      onChange({ provider: option.provider, model: option.model });
    }
  };

  return (
    <div className="bot-settings">
      <label className="bot-model-row">
        <span className="bot-model-icon" aria-hidden>
          🤖
        </span>
        <span className="bot-model-name">AI 机器人模型</span>
        <select
          className="bot-model-select"
          value={selectedIndex >= 0 ? String(selectedIndex) : ""}
          onChange={(event) => handleChange(event.target.value)}
          aria-label="AI 机器人模型"
        >
          <option value="">{describeDefault(defaultRef, models)}</option>
          {groups.map(([label, options]) => (
            <optgroup key={label} label={label}>
              {options.map((option) => (
                <option key={`${option.provider}/${option.model}`} value={String(models.indexOf(option))}>
                  {option.model}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <p className="bot-settings-hint">
        「AI 对战」时机器人用此模型出牌；服务端未配置对应 API key 时会直接建房失败并提示，不会静默降级成规则机器人。
      </p>
    </div>
  );
}

/** 把「服务端默认」标注成具体模型名:有则显示「服务端默认（DeepSeek · deepseek-v4-pro）」,没拉到则退化为「服务端默认」。导出供单测。 */
export function describeDefault(
  defaultRef: { readonly provider: string; readonly model: string } | null | undefined,
  models: readonly BotModelOption[]
): string {
  if (!defaultRef?.provider) {
    return "服务端默认";
  }
  const option = models.find((item) => item.provider === defaultRef.provider && item.model === defaultRef.model);
  const name = option ? `${option.providerLabel} · ${option.model}` : `${defaultRef.provider} · ${defaultRef.model}`;
  return `服务端默认（${name}）`;
}

/** 按 providerLabel 分组,保持原始出现顺序。 */
function groupByProvider(models: readonly BotModelOption[]): [string, BotModelOption[]][] {
  const groups = new Map<string, BotModelOption[]>();
  for (const option of models) {
    const list = groups.get(option.providerLabel) ?? [];
    list.push(option);
    groups.set(option.providerLabel, list);
  }
  return [...groups];
}
