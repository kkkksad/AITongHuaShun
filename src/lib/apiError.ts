export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < 2 && error instanceof ApiRequestError && error.retryable;
}
