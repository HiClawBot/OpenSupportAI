import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

type LookupHost = (hostname: string) => Promise<string[]>;

export function createSafeOutboundFetch(options: {
  allowPrivateNetwork: boolean;
  fetchImpl?: typeof fetch;
  lookupHost?: LookupHost;
  maxRedirects?: number;
}): typeof fetch {
  const fetchImpl = options.fetchImpl ?? fetch;
  const lookupHost = options.lookupHost ?? (options.fetchImpl ? undefined : resolveHostname);
  const maxRedirects = options.maxRedirects ?? 3;

  return (async (input: string | URL | Request, init?: RequestInit) => {
    let url = requestUrl(input);
    let requestInit: RequestInit = { ...init, redirect: "manual" };

    for (let redirectCount = 0; ; redirectCount += 1) {
      await assertSafeOutboundUrl(url, {
        allowPrivateNetwork: options.allowPrivateNetwork,
        lookupHost
      });
      const response = await fetchImpl(url, requestInit);
      const location = redirectLocation(response, url);
      if (!location) {
        return response;
      }
      if (redirectCount >= maxRedirects) {
        throw new Error("Outbound request exceeded the redirect limit");
      }
      if (location.origin !== url.origin) {
        throw new Error("Outbound request cannot redirect to a different origin");
      }
      requestInit = redirectedRequestInit(requestInit, response.status);
      url = location;
    }
  }) as typeof fetch;
}

export async function assertSafeOutboundUrl(
  input: string | URL,
  options: {
    allowPrivateNetwork: boolean;
    lookupHost?: LookupHost;
  }
): Promise<URL> {
  const url = input instanceof URL ? input : new URL(input);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Outbound URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("Outbound URL must not contain credentials");
  }
  if (options.allowPrivateNetwork) {
    return url;
  }

  const hostname = normalizedHostname(url.hostname);
  if (isPrivateHostname(hostname)) {
    throw new Error(`Outbound URL resolves to a private or reserved host: ${hostname}`);
  }
  if (options.lookupHost && isIP(hostname) === 0) {
    const addresses = await options.lookupHost(hostname);
    if (addresses.length === 0 || addresses.some((address) => isPrivateAddress(address))) {
      throw new Error(`Outbound URL resolves to a private or reserved address: ${hostname}`);
    }
  }
  return url;
}

async function resolveHostname(hostname: string): Promise<string[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => entry.address);
}

function requestUrl(input: string | URL | Request): URL {
  if (input instanceof URL) {
    return new URL(input);
  }
  if (typeof input === "string") {
    return new URL(input);
  }
  return new URL(input.url);
}

function redirectLocation(response: Response, currentUrl: URL): URL | undefined {
  if (![301, 302, 303, 307, 308].includes(response.status)) {
    return undefined;
  }
  const location = response.headers.get("location");
  return location ? new URL(location, currentUrl) : undefined;
}

function redirectedRequestInit(init: RequestInit, status: number): RequestInit {
  const method = String(init.method ?? "GET").toUpperCase();
  if (status !== 303 && !((status === 301 || status === 302) && method === "POST")) {
    return init;
  }
  const headers = new Headers(init.headers);
  headers.delete("content-length");
  headers.delete("content-type");
  return {
    ...init,
    method: "GET",
    body: undefined,
    headers
  };
}

function normalizedHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function isPrivateHostname(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return true;
  }
  return isIP(hostname) !== 0 && isPrivateAddress(hostname);
}

function isPrivateAddress(address: string): boolean {
  const normalized = normalizedHostname(address);
  const version = isIP(normalized);
  if (version === 4) {
    const [a = 0, b = 0, c = 0] = normalized.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (version === 6) {
    const compact = normalized.toLowerCase();
    if (compact.startsWith("::ffff:")) {
      return isPrivateAddress(compact.slice("::ffff:".length));
    }
    return (
      compact === "::" ||
      compact === "::1" ||
      compact.startsWith("fc") ||
      compact.startsWith("fd") ||
      /^fe[89ab]/.test(compact) ||
      compact.startsWith("ff") ||
      compact.startsWith("2001:db8:")
    );
  }
  return true;
}
