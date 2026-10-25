import { mapLimit } from "../util";
import { removeDevice, type ApnsEnvironment, type Device } from "./devices";

/** What a push needs from the environment; any missing piece turns pushing off (logged, not thrown). */
export type ApnsConfig = { keyP8: string; keyId: string; teamId: string; topic: string };

export type Alert = {
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  storyId?: string;
  /** Groups notifications in Notification Center: "edition" or "breaking". */
  thread: string;
  /** Seconds APNs keeps trying a device that's offline. */
  ttl: number;
};

const HOST: Record<ApnsEnvironment, string> = { production: "https://api.push.apple.com", sandbox: "https://api.sandbox.push.apple.com" };

/** Apple throttles providers that sign a new token per request and rejects tokens older than an hour. */
const TOKEN_REUSE_MS = 45 * 60_000;
let cached: { jwt: string; at: number; keyId: string } | null = null;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

async function importKey(p8: string): Promise<CryptoKey> {
  const der = Uint8Array.from(atob(p8.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (ch) => ch.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** The provider token (ES256 JWT). WebCrypto's ECDSA signature is already the raw r||s form JWS uses. */
export async function providerToken(config: ApnsConfig, now = Date.now()): Promise<string> {
  if (cached && cached.keyId === config.keyId && now - cached.at < TOKEN_REUSE_MS) return cached.jwt;
  const header = b64urlText(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = b64urlText(JSON.stringify({ iss: config.teamId, iat: Math.floor(now / 1000) }));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await importKey(config.keyP8), new TextEncoder().encode(`${header}.${claims}`));
  const jwt = `${header}.${claims}.${b64url(new Uint8Array(signature))}`;
  cached = { jwt, at: now, keyId: config.keyId };
  return jwt;
}

export function apnsConfig(env: { APNS_KEY?: string; APNS_KEY_ID?: string; APPLE_TEAM_ID?: string; APNS_TOPIC?: string }): ApnsConfig | null {
  if (!env.APNS_KEY || !env.APNS_KEY_ID || !env.APPLE_TEAM_ID || !env.APNS_TOPIC) return null;
  return { keyP8: env.APNS_KEY, keyId: env.APNS_KEY_ID, teamId: env.APPLE_TEAM_ID, topic: env.APNS_TOPIC };
}

export function payload(alert: Alert) {
  return {
    aps: { alert: { title: alert.title, body: alert.body }, sound: "default", "thread-id": alert.thread, "mutable-content": 0 },
    ...(alert.storyId ? { storyId: alert.storyId } : {}),
  };
}

/** APNs reasons meaning the token will never work again. */
const DEAD_TOKEN = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

export type PushReport = { sent: number; failed: number; removed: number };

/**
 * Sends one alert to many devices, 20 at a time. Dead tokens are deleted; other failures are counted and
 * logged, never thrown, so one bad device can't stop the rest.
 */
export async function pushAll(
  db: D1Database,
  config: ApnsConfig | null,
  devices: readonly Device[],
  alert: Alert,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<PushReport> {
  const report: PushReport = { sent: 0, failed: 0, removed: 0 };
  if (devices.length === 0) return report;
  if (!config) {
    console.warn(`push skipped: APNS_KEY, APNS_KEY_ID, APPLE_TEAM_ID or APNS_TOPIC not set (${devices.length} devices)`);
    return report;
  }
  const jwt = await providerToken(config, now);
  const body = JSON.stringify(payload(alert));
  await mapLimit(devices, 20, async (d) => {
    try {
      const res = await fetcher(`${HOST[d.environment]}/3/device/${d.token}`, {
        method: "POST",
        headers: {
          authorization: `bearer ${jwt}`,
          "apns-topic": config.topic,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-expiration": String(Math.floor(now / 1000) + alert.ttl),
          "content-type": "application/json",
        },
        body,
      });
      if (res.ok) {
        report.sent += 1;
        return;
      }
      const reason = ((await res.json().catch(() => ({}))) as { reason?: string }).reason ?? String(res.status);
      if (res.status === 410 || DEAD_TOKEN.has(reason)) {
        await removeDevice(db, d.token);
        report.removed += 1;
      } else {
        report.failed += 1;
        console.error(`push failed for a device: ${res.status} ${reason}`);
      }
    } catch (err) {
      report.failed += 1;
      console.error(`push failed for a device: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return report;
}
