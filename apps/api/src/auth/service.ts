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

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}
