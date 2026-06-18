import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 把相对路径解析到仓库根(与 loadRootEnv 同一基准:编译产物所在的 packages/env/dist 上溯三级)。 */
export function resolveRootPath(relativePath: string): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../", relativePath);
}

/** 读取仓库根下的文件内容;不存在返回 null(供可选配置文件使用)。relativePath 为绝对路径时按绝对路径读取。 */
export function readRootFile(relativePath: string): string | null {
  const path = resolveRootPath(relativePath);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

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
