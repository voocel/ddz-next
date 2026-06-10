import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const PASSWORD_HASH_ALGORITHM = "scrypt";
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const key = await deriveKey(password, salt, {
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION,
    keyLength: SCRYPT_KEY_LENGTH
  });

  return [
    PASSWORD_HASH_ALGORITHM,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt,
    key.toString("base64url")
  ].join("$");
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  // 散列格式畸形时按验证失败处理，不抛异常导致 500
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== PASSWORD_HASH_ALGORITHM) {
    return false;
  }

  const salt = parts[4]!;
  const expectedText = parts[5]!;
  const cost = parsePositiveInteger(parts[1]);
  const blockSize = parsePositiveInteger(parts[2]);
  const parallelization = parsePositiveInteger(parts[3]);
  if (cost === null || blockSize === null || parallelization === null) {
    return false;
  }

  const expected = Buffer.from(expectedText, "base64url");
  if (expected.length === 0) {
    return false;
  }
  const actual = await deriveKey(password, salt, {
    cost,
    blockSize,
    parallelization,
    keyLength: expected.length
  });

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

interface ScryptParams {
  readonly cost: number;
  readonly blockSize: number;
  readonly parallelization: number;
  readonly keyLength: number;
}

async function deriveKey(password: string, salt: string, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      params.keyLength,
      {
        N: params.cost,
        r: params.blockSize,
        p: params.parallelization
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey as Buffer);
      }
    );
  });
}

function parsePositiveInteger(value: string | undefined): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}
