export interface InternalConfig {
  readonly token: string;
}

export function readInternalConfig(env: NodeJS.ProcessEnv = process.env): InternalConfig {
  const token = env.INTERNAL_API_TOKEN?.trim();
  if (!token) {
    throw new Error("INTERNAL_API_TOKEN is required to start internal API routes.");
  }

  return {
    token
  };
}
