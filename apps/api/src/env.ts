import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function loadRootEnv(): void {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");
  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (!entry || process.env[entry.name] !== undefined) {
      continue;
    }
    process.env[entry.name] = entry.value;
  }
}

function parseEnvLine(line: string): { readonly name: string; readonly value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const separator = trimmed.indexOf("=");
  if (separator <= 0) {
    return null;
  }

  const name = trimmed.slice(0, separator).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid environment variable name in .env: ${name}`);
  }

  return {
    name,
    value: unquoteEnvValue(trimmed.slice(separator + 1).trim())
  };
}

function unquoteEnvValue(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replaceAll('\\"', '"');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}
