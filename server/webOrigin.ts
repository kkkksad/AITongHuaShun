type HeaderValue = string | string[] | undefined;

function firstHeaderValue(value: HeaderValue): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim() ? first.trim() : undefined;
}

function normalizeHttpOrigin(value: string | undefined): string | null {
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export interface WebOriginRequestHeaders {
  origin?: HeaderValue;
  host?: HeaderValue;
  "x-forwarded-proto"?: HeaderValue;
}

export function isTrustedWebSocketOrigin(input: {
  headers: WebOriginRequestHeaders;
  protocol?: string;
  configuredOrigin: string;
  trustProxy: boolean;
}): boolean {
  const browserOrigin = normalizeHttpOrigin(
    firstHeaderValue(input.headers.origin),
  );
  const configuredOrigin = normalizeHttpOrigin(input.configuredOrigin);
  if (!browserOrigin || !configuredOrigin) return false;
  if (browserOrigin === configuredOrigin) return true;
  if (!input.trustProxy) return false;

  const host = firstHeaderValue(input.headers.host);
  const forwardedProto = firstHeaderValue(input.headers["x-forwarded-proto"]);
  const protocol = (forwardedProto ?? input.protocol ?? "").split(",", 1)[0].trim();
  if (!host || (protocol !== "http" && protocol !== "https")) return false;

  return normalizeHttpOrigin(`${protocol}://${host}`) === browserOrigin;
}
