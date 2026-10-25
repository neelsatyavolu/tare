import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { coverageOf } from "../src/build/select";
import type { Story } from "../src/editions";
import { payload, providerToken, pushAll, type ApnsConfig } from "../src/push/apns";
import { registerDevice, type Device } from "../src/push/devices";
import { breakingStory } from "../src/push/notify";

async function p8(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
  return { pem, publicKey: pair.publicKey };
}

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

describe("APNs", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM devices");
  });

  it("signs a provider token Apple can verify with the key", async () => {
    const { pem, publicKey } = await p8();
    const config: ApnsConfig = { keyP8: pem, keyId: "KEY123", teamId: "TEAM456", topic: "co.xanom.tare" };
    const jwt = await providerToken(config, 1_000_000_000_000);
    const [h, c, sig] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromB64url(h!)))).toEqual({ alg: "ES256", kid: "KEY123" });
    expect(JSON.parse(new TextDecoder().decode(fromB64url(c!)))).toEqual({ iss: "TEAM456", iat: 1_000_000_000 });
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, fromB64url(sig!), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });

  it("sends to each device, deletes dead tokens and skips when not configured", async () => {
    const { pem } = await p8();
    const config: ApnsConfig = { keyP8: pem, keyId: "KEY999", teamId: "TEAM456", topic: "co.xanom.tare" };
    const good: Device = { token: "aa".repeat(32), environment: "production", editions: "both", breaking: true };
    const gone: Device = { token: "bb".repeat(32), environment: "sandbox", editions: "both", breaking: true };
    await registerDevice(env.DB, good, 0);
    await registerDevice(env.DB, gone, 0);
    const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
      return String(url).includes("bbbb") ? new Response('{"reason":"Unregistered"}', { status: 410 }) : new Response(null, { status: 200 });
    }) as typeof fetch;
    const alert = { title: "Breaking", body: "Something happened", storyId: "s1", thread: "breaking", ttl: 60 };
    const report = await pushAll(env.DB, config, [good, gone], alert, fetcher, 1_000_000_000_000);
    expect(report).toEqual({ sent: 1, failed: 0, removed: 1 });
    expect(calls.find((c) => c.url.startsWith("https://api.push.apple.com/3/device/aaaa"))?.headers["apns-topic"]).toBe("co.xanom.tare");
    expect(calls.some((c) => c.url.startsWith("https://api.sandbox.push.apple.com/"))).toBe(true);
    expect(calls[0]!.body).toEqual(payload(alert));
    expect(await env.DB.prepare("SELECT token FROM devices").all()).toMatchObject({ results: [{ token: good.token }] });
    expect(await pushAll(env.DB, null, [good], alert, fetcher)).toEqual({ sent: 0, failed: 0, removed: 0 });
  });
});

describe("breakingStory", () => {
  const now = 100 * 3600_000;
  const wide = coverageOf(["vox", "nyt", "axios", "pbs", "fox", "nypost"]);
  const story = (id: string, over: Partial<Story>): Story => ({
    id, editionDate: "2026-10-25", rank: 0, front: true, topic: "world", headline: id, summary: [], differences: [], coverage: wide,
    blindspot: null, itemIds: [], imageItemId: null, firstSeenAt: now - 600_000, importance: 5, dek: null, why: null, writtenAt: null, ...over,
  });

  it("picks the newest major front-page story not already pushed", () => {
    const older = story("older", { firstSeenAt: now - 3600_000 });
    const newer = story("newer", {});
    expect(breakingStory([older, newer], new Set(), now)?.id).toBe("newer");
    expect(breakingStory([older, newer], new Set(["newer"]), now)?.id).toBe("older");
  });

  it("ignores minor, old, narrow or off-front stories", () => {
    expect(breakingStory([story("minor", { importance: 4 })], new Set(), now)).toBeNull();
    expect(breakingStory([story("old", { firstSeenAt: now - 3 * 3600_000 })], new Set(), now)).toBeNull();
    expect(breakingStory([story("narrow", { coverage: coverageOf(["vox", "fox"]) })], new Set(), now)).toBeNull();
    expect(breakingStory([story("inside", { front: false })], new Set(), now)).toBeNull();
  });
});
