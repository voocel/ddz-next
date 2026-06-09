import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthUserDto } from "@ddz/protocol";

export interface TokenConfig {
  readonly secret: string;
  readonly issuer: string;
  readonly audience: string;
  readonly accessTokenTtlSeconds: number;
}

export interface AccessTokenClaims {
  readonly sub: string;
  readonly username: string;
  readonly nickname: string;
  readonly typ: "access";
  readonly iss: string;
  readonly aud: string;
  readonly iat: number;
  readonly exp: number;
}

export function signAccessToken(user: AuthUserDto, config: TokenConfig): string {
  const issuedAt = nowSeconds();
  const header = encodeJson({
    alg: "HS256",
    typ: "JWT"
  });
  const payload = encodeJson({
    sub: user.id,
    username: user.username,
    nickname: user.nickname,
    typ: "access",
    iss: config.issuer,
    aud: config.audience,
    iat: issuedAt,
    exp: issuedAt + config.accessTokenTtlSeconds
  } satisfies AccessTokenClaims);
  const signingInput = `${header}.${payload}`;
  const signature = sign(signingInput, config.secret);

  return `${signingInput}.${signature}`;
}

export function verifyAccessToken(token: string, config: TokenConfig): AccessTokenClaims {
  const [encodedHeader, encodedPayload, signature, extra] = token.split(".");
  if (!encodedHeader || !encodedPayload || !signature || extra !== undefined) {
    throw new Error("Invalid access token format.");
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  if (!isValidSignature(signingInput, signature, config.secret)) {
    throw new Error("Invalid access token signature.");
  }

  const header = decodeJsonObject(encodedHeader);
  if (!isJwtHeader(header)) {
    throw new Error("Unsupported access token header.");
  }

  const payload = decodeJsonObject(encodedPayload);
  if (!isAccessTokenClaims(payload)) {
    throw new Error("Invalid access token claims.");
  }

  if (payload.iss !== config.issuer || payload.aud !== config.audience) {
    throw new Error("Access token issuer or audience does not match.");
  }

  if (payload.exp <= nowSeconds()) {
    throw new Error("Access token has expired.");
  }

  return payload;
}

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

function isValidSignature(input: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(sign(input, secret), "base64url");
  const actual = Buffer.from(signature, "base64url");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeJsonObject(value: string): unknown {
  const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JWT section to be an object.");
  }
  return parsed;
}

function isAccessTokenClaims(value: unknown): value is AccessTokenClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const claims = value as Record<string, unknown>;
  return (
    typeof claims.sub === "string" &&
    typeof claims.username === "string" &&
    typeof claims.nickname === "string" &&
    claims.typ === "access" &&
    typeof claims.iss === "string" &&
    typeof claims.aud === "string" &&
    Number.isInteger(claims.iat) &&
    Number.isInteger(claims.exp)
  );
}

function isJwtHeader(value: unknown): value is { readonly alg: "HS256"; readonly typ: "JWT" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const header = value as Record<string, unknown>;
  return header.alg === "HS256" && header.typ === "JWT";
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
