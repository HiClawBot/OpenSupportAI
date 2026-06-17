import type { ApiErrorCode, ApiErrorResponse } from "@opensupportai/protocol";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;

  constructor(code: ApiErrorCode, message: string, statusCode = 400) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function invalidRequest(message: string): ApiError {
  return new ApiError("invalid_request", message, 400);
}

export function unauthorized(message = "Unauthorized"): ApiError {
  return new ApiError("unauthorized", message, 401);
}

export function forbidden(message = "Forbidden"): ApiError {
  return new ApiError("forbidden", message, 403);
}

export function notFound(message = "Not found"): ApiError {
  return new ApiError("not_found", message, 404);
}

export function toApiErrorResponse(error: ApiError, requestId: string): ApiErrorResponse {
  return {
    error: {
      code: error.code,
      message: error.message,
      requestId
    }
  };
}
