import { ApiError } from "../errors.js";

export class GameActionError extends ApiError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = "GameActionError";
  }
}
