export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function badRequest(message: string, code = "bad_request"): ApiError {
  return new ApiError(400, message, code);
}

export function unauthorized(message = "请先登录"): ApiError {
  return new ApiError(401, message, "unauthorized");
}

export function forbidden(message = "没有权限执行此操作"): ApiError {
  return new ApiError(403, message, "forbidden");
}

export function notFound(message = "目标不存在"): ApiError {
  return new ApiError(404, message, "not_found");
}

export function conflict(message: string, code = "conflict"): ApiError {
  return new ApiError(409, message, code);
}
