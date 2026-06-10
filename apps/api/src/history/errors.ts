import { ApiError } from "../errors.js";

export class HistoryError extends ApiError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = "HistoryError";
  }
}
