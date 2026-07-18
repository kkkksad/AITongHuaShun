const WXPUSHER_SIMPLE_PUSH_URL =
  "https://wxpusher.zjiecode.com/api/send/message/simple-push";

export interface WxPusherMessage {
  summary: string;
  content: string;
}

export interface WxPusherSendResult {
  provider: "wxpusher";
  accepted: true;
}

export interface WxPusherClientOptions {
  spt: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

function providerCode(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const code = (value as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

export class WxPusherClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: WxPusherClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(message: WxPusherMessage): Promise<WxPusherSendResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    timeout.unref?.();

    try {
      const response = await this.fetchImpl(WXPUSHER_SIMPLE_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: message.content,
          summary: message.summary.slice(0, 100),
          contentType: 2,
          spt: this.options.spt,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`WxPusher request failed with HTTP ${response.status}`);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error("WxPusher returned an invalid JSON response");
      }

      const code = providerCode(payload);
      if (code !== 1000) {
        throw new Error(
          code === null
            ? "WxPusher returned an invalid response"
            : `WxPusher rejected the message with provider code ${code}`,
        );
      }

      return { provider: "wxpusher", accepted: true };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `WxPusher request timed out after ${this.options.timeoutMs} ms`,
        );
      }
      if (error instanceof Error && error.message.startsWith("WxPusher")) {
        throw error;
      }
      throw new Error("WxPusher request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}
