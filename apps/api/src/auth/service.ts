import type { LoginRequest, LoginResponse, RegisterRequest } from "@ddz/protocol";
import { signAccessToken, type TokenConfig } from "@ddz/auth";
import { AuthError } from "./errors.js";
import { hashPassword, verifyPassword } from "./password.js";

export interface AuthUserRecord {
  readonly id: string;
  readonly username: string;
  readonly nickname: string;
  readonly passwordHash: string;
}

export interface CreateUserInput {
  readonly username: string;
  readonly nickname: string;
  readonly passwordHash: string;
}

export interface UserRepository {
  findByUsername(username: string): Promise<AuthUserRecord | null>;
  createUser(input: CreateUserInput): Promise<AuthUserRecord>;
}

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly tokenConfig: TokenConfig
  ) {}

  async register(input: RegisterRequest): Promise<LoginResponse> {
    const username = normalizeUsername(input.username);
    if (!USERNAME_PATTERN.test(username)) {
      throw new AuthError("Username must be 3-32 letters, numbers, underscores, or hyphens.", 400);
    }

    const existing = await this.users.findByUsername(username);
    if (existing) {
      throw new AuthError("Username already exists.", 409);
    }

    const user = await this.users.createUser({
      username,
      nickname: input.nickname.trim(),
      passwordHash: await hashPassword(input.password)
    });

    return this.createAuthResponse(user);
  }

  async login(input: LoginRequest): Promise<LoginResponse> {
    const username = normalizeUsername(input.username);
    const user = await this.users.findByUsername(username);
    if (!user) {
      // 跑一次虚拟散列验证，抹平“用户不存在”与“密码错误”的响应时序差异
      await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
      throw new AuthError("Invalid username or password.", 401);
    }

    const validPassword = await verifyPassword(input.password, user.passwordHash);
    if (!validPassword) {
      throw new AuthError("Invalid username or password.", 401);
    }

    return this.createAuthResponse(user);
  }

  private createAuthResponse(user: AuthUserRecord): LoginResponse {
    const dto = {
      id: user.id,
      username: user.username,
      nickname: user.nickname
    };

    return {
      accessToken: signAccessToken(dto, this.tokenConfig),
      user: dto
    };
  }
}

// 与 demoUser 的用户名约束保持一致（规范化后为小写）
const USERNAME_PATTERN = /^[a-z0-9_-]{3,32}$/;

// 预生成的 scrypt 散列（参数与 hashPassword 相同），仅用于抹平时序，不对应任何真实密码
const DUMMY_PASSWORD_HASH =
  "scrypt$16384$8$1$sjRYcgi62LYcJTbxjLBHcg$_nRVZ-2-3kDeO9ovIEAkbu1x9TN8p9abeogrUMYGYVT8KJlhsDsdfjqafgkEPxlUsTeHtrqbXSoqUdBK_j34Xg";

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}
