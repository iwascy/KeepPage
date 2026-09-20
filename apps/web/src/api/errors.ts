export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;
  readonly code?: string;

  constructor(status: number, message: string, details?: unknown, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

// Permission failures and private-vault errors must not end the account session.
export function isSessionInvalid(error: unknown) {
  return error instanceof ApiError && error.status === 401 && (
    !error.code || ["Unauthorized", "TokenExpired", "SessionExpired"].includes(error.code)
  );
}
