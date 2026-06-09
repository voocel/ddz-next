import { createHash } from "node:crypto";
import type { RecordGameAction } from "@ddz/protocol";

export function createActionFingerprint(actions: readonly RecordGameAction[]): string {
  return createHash("sha256").update(canonicalJson(actions)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === undefined) {
    throw new Error("Cannot fingerprint undefined game action values.");
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
