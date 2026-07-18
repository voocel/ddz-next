/** 模型计价（$/百万 token）：input / output。未知模型只报 token、不估成本。 */
const PRICING: Record<string, readonly [number, number]> = {
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-4-6": [3, 15],
  "claude-opus-4-8": [5, 25],
  "claude-opus-4-7": [5, 25],
  "claude-opus-4-6": [5, 25],
  "claude-fable-5": [10, 50]
};

/** 估算成本（美元）；未知模型返回 null（不猜价）。 */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = PRICING[model];
  if (!price) {
    return null;
  }
  return (inputTokens / 1e6) * price[0] + (outputTokens / 1e6) * price[1];
}
