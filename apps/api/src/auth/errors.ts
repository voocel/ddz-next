import { ApiError } from "../errors.js";

export class AuthError extends ApiError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = "AuthError";
  }
}
