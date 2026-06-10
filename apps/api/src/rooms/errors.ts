import { ApiError } from "../errors.js";

export class RoomError extends ApiError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = "RoomError";
  }
}
