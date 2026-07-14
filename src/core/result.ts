/**
 * Result<T> — never-throw return convention.
 * Mirrors the BoringWorks Core Return Convention.
 *
 * Business logic returns Result<T>, never throws.
 * Routes map success: false to HTTP status codes.
 */

export type ErrorCode =
  | "validation_failed"
  | "not_found"
  | "unauthorized"
  | "forbidden"
  | "conflict"
  | "rate_limited"
  | "circuit_open"
  | "budget_exceeded"
  | "upstream_failed"
  | "not_implemented"
  | "internal";

export interface AppError {
  code: ErrorCode;
  message: string;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export type Result<T> = { success: true; data: T } | { success: false; error: AppError };

export function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

export function fail<T = never>(
  code: ErrorCode,
  message: string,
  extra?: Partial<AppError>,
): Result<T> {
  return { success: false, error: { code, message, ...extra } };
}

export function isOk<T>(r: Result<T>): r is { success: true; data: T } {
  return r.success;
}

/**
 * Unwrap a Result, throwing on failure.
 * Use only in tests, scripts, or diagnostic helpers — never in business logic.
 */
export function unwrap<T>(r: Result<T>): T {
  if (r.success) return r.data;
  throw new Error(`unwrap on failed Result: ${r.error.code} — ${r.error.message}`);
}

const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  validation_failed: 400,
  not_found: 404,
  unauthorized: 401,
  forbidden: 403,
  conflict: 409,
  rate_limited: 429,
  circuit_open: 503,
  budget_exceeded: 402,
  upstream_failed: 502,
  not_implemented: 501,
  internal: 500,
};

export function statusFor(code: ErrorCode): number {
  return ERROR_HTTP_STATUS[code] ?? 500;
}
