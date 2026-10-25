import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { coverageOf } from "../src/build/select";
import type { Story } from "../src/editions";
import { payload, providerToken, pushAll, type ApnsConfig } from "../src/push/apns";
import { devicesDue, markPushed, registerDevice, type Device } from "../src/push/devices";
import { breakingStories } from "../src/push/notify";

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

describe("devicesDue", () => {
  it("picks phones whose own clock reads 7 a.m., once per edition", async () => {
    await env.DB.prepare("DELETE FROM devices").run();
    const west: Device = { token: "cc".repeat(32), environment: "production", editions: "both", breaking: true, timezone: "America/Los_Angeles" };
    const east: Device = { token: "dd".repeat(32), environment: "production", editions: "both", breaking: true, timezone: "America/New_York" };
    const quiet: Device = { token: "ee".repeat(32), environment: "production", editions: "evening", breaking: true, timezone: "America/Los_Angeles" };
    for (const d of [west, east, quiet]) await registerDevice(env.DB, d, 0);
    // An older app build re-registering without a zone keeps the saved one.
    await registerDevice(env.DB, { ...west, timezone: undefined }, 1);

    const at = Date.parse("2026-10-25T14:00:00Z"); // 7 a.m. Pacific, 10 a.m. Eastern
    const due = await devicesDue(env.DB, at);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ slot: "am", key: "2026-10-25-am" });
    expect(due[0]!.devices.map((d) => d.token)).toEqual([west.token]);

    await markPushed(env.DB, [west.token], "2026-10-25-am");
    expect(await devicesDue(env.DB, at + 3600_000)).toEqual([]);
  });
});

describe("breakingStories", () => {
  const now = 100 * 3600_000;
  const wide = coverageOf(["vox", "nyt", "axios", "pbs", "fox", "nypost"]);
  const story = (id: string, over: Partial<Story>): Story => ({
    id, editionDate: "2026-10-25", rank: 0, front: true, topic: "world", headline: id, summary: [], differences: [], coverage: wide,
    blindspot: null, itemIds: [], imageItemId: null, firstSeenAt: now - 600_000, importance: 5, dek: null, why: null, writtenAt: null, ...over,
  });
  const ids = (list: Story[]) => list.map((s) => s.id);

  it("picks every new major front-page story not already pushed, most important first", () => {
    const major = story("major", { importance: 4 });
    const historic = story("historic", { firstSeenAt: now - 3600_000 });
    expect(ids(breakingStories([major, historic], new Set(), now))).toEqual(["historic", "major"]);
    expect(ids(breakingStories([major, historic], new Set(["historic"]), now))).toEqual(["major"]);
  });

  it("caps a busy hour at three", () => {
    expect(breakingStories(["a", "b", "c", "d"].map((id) => story(id, {})), new Set(), now)).toHaveLength(3);
  });

  it("ignores minor, old, narrow or off-front stories", () => {
    expect(breakingStories([story("minor", { importance: 3 })], new Set(), now)).toEqual([]);
    expect(breakingStories([story("old", { firstSeenAt: now - 3 * 3600_000 })], new Set(), now)).toEqual([]);
    expect(breakingStories([story("narrow", { coverage: coverageOf(["vox", "fox"]) })], new Set(), now)).toEqual([]);
    expect(breakingStories([story("inside", { front: false })], new Set(), now)).toEqual([]);
  });
});
