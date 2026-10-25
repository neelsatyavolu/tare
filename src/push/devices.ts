import { z } from "zod";
import { choiceFor, type EditionChoice, type Slot } from "../slots";

/** Which APNs server a token belongs to: development builds get sandbox tokens. */
export type ApnsEnvironment = "production" | "sandbox";

export type Device = { token: string; environment: ApnsEnvironment; editions: EditionChoice | "none"; breaking: boolean };

const DeviceSchema = z.object({
  // APNs device tokens are 32 bytes, sent as 64 hex characters; allow longer in case Apple grows them.
  token: z.string().regex(/^[0-9a-f]{64,200}$/i).transform((t) => t.toLowerCase()),
  environment: z.enum(["production", "sandbox"]).default("production"),
  editions: z.enum(["both", "morning", "evening", "none"]).default("both"),
  breaking: z.boolean().default(true),
});

export function parseDevice(raw: unknown): Device | null {
  const r = DeviceSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export async function registerDevice(db: D1Database, d: Device, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO devices (token, environment, editions, breaking, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET environment = excluded.environment, editions = excluded.editions,
         breaking = excluded.breaking, updated_at = excluded.updated_at`,
    )
    .bind(d.token, d.environment, d.editions, d.breaking ? 1 : 0, now, now)
    .run();
}

export async function removeDevice(db: D1Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM devices WHERE token = ?").bind(token.toLowerCase()).run();
}

type Row = { token: string; environment: ApnsEnvironment; editions: Device["editions"]; breaking: number };
const toDevice = (r: Row): Device => ({ token: r.token, environment: r.environment, editions: r.editions, breaking: r.breaking === 1 });

/** Devices that take this slot's edition. */
export async function devicesForEdition(db: D1Database, slot: Slot): Promise<Device[]> {
  const { results } = await db.prepare("SELECT token, environment, editions, breaking FROM devices WHERE editions = 'both' OR editions = ?").bind(choiceFor(slot)).all<Row>();
  return results.map(toDevice);
}

export async function devicesForBreaking(db: D1Database): Promise<Device[]> {
  const { results } = await db.prepare("SELECT token, environment, editions, breaking FROM devices WHERE breaking = 1").all<Row>();
  return results.map(toDevice);
}
