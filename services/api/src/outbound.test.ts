import { describe, expect, it, vi } from "vitest";
import { assertSafeOutboundUrl, createSafeOutboundFetch } from "./outbound";

describe("safe outbound requests", () => {
  it("rejects non-HTTP protocols, URL credentials, and private hosts", async () => {
    await expect(
      assertSafeOutboundUrl("file:///etc/passwd", { allowPrivateNetwork: false })
    ).rejects.toThrow("http or https");
    await expect(
      assertSafeOutboundUrl("https://user:password@example.com", {
        allowPrivateNetwork: false
      })
    ).rejects.toThrow("credentials");
    await expect(
      assertSafeOutboundUrl("http://127.0.0.1:3000", { allowPrivateNetwork: false })
    ).rejects.toThrow("private or reserved");
    await expect(
      assertSafeOutboundUrl("http://metadata.internal", { allowPrivateNetwork: false })
    ).rejects.toThrow("private or reserved");
  });

  it("rejects public hostnames when DNS resolves to a private address", async () => {
    await expect(
      assertSafeOutboundUrl("https://support.example.com", {
        allowPrivateNetwork: false,
        lookupHost: async () => ["169.254.169.254"]
      })
    ).rejects.toThrow("private or reserved address");
  });

  it("allows public destinations and validates same-origin redirect targets", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/v2/answer" }
        })
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const safeFetch = createSafeOutboundFetch({
      allowPrivateNetwork: false,
      fetchImpl,
      lookupHost: async () => ["93.184.216.34"]
    });

    const response = await safeFetch("https://api.example.com/v1/answer");

    expect(response.ok).toBe(true);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.example.com/v1/answer",
      "https://api.example.com/v2/answer"
    ]);
  });

  it("blocks redirects to a different origin", async () => {
    const safeFetch = createSafeOutboundFetch({
      allowPrivateNetwork: false,
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://other.example.com/secret" }
        }),
      lookupHost: async () => ["93.184.216.34"]
    });

    await expect(safeFetch("https://api.example.com/start")).rejects.toThrow("different origin");
  });
});
