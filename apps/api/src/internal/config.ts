export interface InternalConfig {
  readonly token: string;
}

export function readInternalConfig(env: NodeJS.ProcessEnv = process.env): InternalConfig {
  const token = env.INTERNAL_API_TOKEN?.trim();
  // 至少 32 字符，避免弱令牌被暴力破解
  if (!token || token.length < 32) {
    throw new Error("INTERNAL_API_TOKEN must be at least 32 characters to start internal API routes.");
  }

  return {
    token
  };
}
