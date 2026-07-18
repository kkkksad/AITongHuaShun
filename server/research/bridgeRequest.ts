export type BridgeRequestErrorCode =
  | "http"
  | "invalid-json"
  | "network"
  | "timeout";

export class BridgeRequestError extends Error {
  constructor(
    message: string,
    readonly code: BridgeRequestErrorCode,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "BridgeRequestError";
  }
}

interface FetchBridgeJsonInput {
  url: string;
  token?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

function boundedTimeout(value: number): number {
  if (!Number.isFinite(value)) return 15_000;
  return Math.max(1, Math.round(value));
}

function normalizeDetail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 240);
  return normalized || null;
}

function responseDetail(body: string): string | null {
  try {
    const payload = JSON.parse(body) as unknown;
    if (!payload || typeof payload !== "object") return null;
    return normalizeDetail((payload as Record<string, unknown>).detail);
  } catch {
    return null;
  }
}

export function bridgeErrorMessage(error: unknown): string {
  return error instanceof BridgeRequestError
    ? error.message
    : "行情桥请求失败";
}

export async function fetchBridgeJson<T>(
  input: FetchBridgeJsonInput,
): Promise<T> {
  const timeoutMs = boundedTimeout(input.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await (input.fetchImpl ?? fetch)(input.url, {
      headers: {
        Accept: "application/json",
        ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
      },
      signal: controller.signal,
    });
    const body = await response.text();

    if (!response.ok) {
      const detail = responseDetail(body);
      throw new BridgeRequestError(
        `行情桥返回 HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
        "http",
        response.status,
      );
    }

    try {
      return JSON.parse(body) as T;
    } catch {
      throw new BridgeRequestError(
        "行情桥返回了无法解析的 JSON",
        "invalid-json",
        response.status,
      );
    }
  } catch (error: unknown) {
    if (error instanceof BridgeRequestError) throw error;
    if (controller.signal.aborted) {
      throw new BridgeRequestError(
        `连接行情桥超时（${timeoutMs}ms）`,
        "timeout",
      );
    }
    throw new BridgeRequestError(
      "无法连接行情桥，请确认行情服务已启动",
      "network",
    );
  } finally {
    clearTimeout(timer);
  }
}
