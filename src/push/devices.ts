import { z } from "zod";
import { DEFAULT_TIME_ZONE, dueSlot, isTimeZone, takes, type EditionChoice, type Slot } from "../slots";

/** Which APNs server a token belongs to: development builds get sandbox tokens. */
export type ApnsEnvironment = "production" | "sandbox";

export type Device = { token: string; environment: ApnsEnvironment; editions: EditionChoice | "none"; breaking: boolean; timezone?: string };

const DeviceSchema = z.object({
  // APNs device tokens are 32 bytes, sent as 64 hex characters; allow longer in case Apple grows them.
  token: z.string().regex(/^[0-9a-f]{64,200}$/i).transform((t) => t.toLowerCase()),
  environment: z.enum(["production", "sandbox"]).default("production"),
  editions: z.enum(["both", "morning", "evening", "none"]).default("both"),
  breaking: z.boolean().default(true),
  // The phone's IANA time zone, so editions arrive at its 7 a.m. and 6 p.m. Older app builds don't send it.
  timezone: z.string().refine(isTimeZone).optional(),
});

export function parseDevice(raw: unknown): Device | null {
  const r = DeviceSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export async function registerDevice(db: D1Database, d: Device, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO devices (token, environment, editions, breaking, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET environment = excluded.environment, editions = excluded.editions,
         breaking = excluded.breaking, timezone = COALESCE(excluded.timezone, devices.timezone), updated_at = excluded.updated_at`,
    )
    .bind(d.token, d.environment, d.editions, d.breaking ? 1 : 0, d.timezone ?? null, now, now)
    .run();
}

export async function removeDevice(db: D1Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM devices WHERE token = ?").bind(token.toLowerCase()).run();
}

type Row = { token: string; environment: ApnsEnvironment; editions: Device["editions"]; breaking: number; timezone: string | null; last_edition_key: string | null };
const COLUMNS = "token, environment, editions, breaking, timezone, last_edition_key";
const toDevice = (r: Row): Device => ({
  token: r.token, environment: r.environment, editions: r.editions, breaking: r.breaking === 1,
  timezone: isTimeZone(r.timezone) ? r.timezone : DEFAULT_TIME_ZONE,
});

/** Devices whose local clock says an edition is due now, that take it and haven't had it: grouped by slot and key. */
export async function devicesDue(db: D1Database, now: number): Promise<{ slot: Slot; key: string; devices: Device[] }[]> {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM devices WHERE editions != 'none'`).all<Row>();
  const groups = new Map<string, { slot: Slot; key: string; devices: Device[] }>();
  for (const r of results) {
    const d = toDevice(r);
    const due = dueSlot(now, d.timezone ?? DEFAULT_TIME_ZONE);
    if (!due || !takes(d.editions, due.slot) || (r.last_edition_key ?? "") >= due.key) continue;
    const group = groups.get(due.key) ?? { ...due, devices: [] };
    group.devices.push(d);
    groups.set(due.key, group);
  }
  return [...groups.values()];
}

/** Remembers that these devices got this edition's push, so the next hour's run skips them. */
export async function markPushed(db: D1Database, tokens: readonly string[], key: string): Promise<void> {
  if (tokens.length === 0) return;
  const stmt = db.prepare("UPDATE devices SET last_edition_key = ? WHERE token = ?");
  await db.batch(tokens.map((t) => stmt.bind(key, t)));
}

export async function devicesForBreaking(db: D1Database): Promise<Device[]> {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM devices WHERE breaking = 1`).all<Row>();
  return results.map(toDevice);
}
