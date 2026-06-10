/** API 业务错误基类，由全局错误处理器统一转换为 HTTP 响应 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly issues?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}
