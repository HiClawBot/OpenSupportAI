export type ApiErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "internal_error";

export type ApiErrorResponse = {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
  };
};

export type ApiHealthResponse = {
  status: "ok";
  service: string;
};

export function createApiRequestId(prefix = "req"): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
