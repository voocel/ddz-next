import type { BotModelOption } from "@ddz/protocol";
import type { BotPreferences, ReasoningEffort } from "../../botPreferences";

/** 思考强度档位的展示文案(顺序即下拉顺序)。 */
const EFFORT_OPTIONS: readonly { readonly value: ReasoningEffort; readonly label: string }[] = [
  { value: "off", label: "关闭（推荐，最快）" },
  { value: "auto", label: "模型默认（可能较慢）" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" }
];

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
      onChange({ ...preferences, provider: "", model: "" });
      return;
    }
    const option = models[Number(value)];
    if (option) {
      onChange({ ...preferences, provider: option.provider, model: option.model });
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
      <label className="bot-model-row">
        <span className="bot-model-icon" aria-hidden>
          ⚡
        </span>
        <span className="bot-model-name">思考强度</span>
        <select
          className="bot-model-select"
          value={preferences.reasoningEffort}
          onChange={(event) => onChange({ ...preferences, reasoningEffort: event.target.value as ReasoningEffort })}
          aria-label="思考强度"
        >
          {EFFORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p className="bot-settings-hint">
        「AI 对战」时机器人用此模型出牌；服务端未配置对应 API key 时会直接建房失败并提示，不会静默降级成规则机器人。
        出牌只需要选择编号，默认关闭思考以避免 DeepSeek 长时间推理后不输出答案；需要观察模型原生推理时可切到模型默认或高强度。
        Anthropic 各档均生效；DeepSeek V4 可真正关闭，但低/中会被其服务端归到「高」；其它兼容模型无统一关闭语义，关闭会退化为最低档。
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
