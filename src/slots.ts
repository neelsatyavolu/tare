/**
 * Tare updates every hour and goes out by email twice a day: a morning edition at 7 a.m. and an evening edition at
 * 6 p.m., in each reader's own time zone (detected from their connection, or their phone in the app). Readers
 * choose one or both.
 */
export type Slot = "am" | "pm";
export type EditionChoice = "both" | "morning" | "evening";

export const EDITION_CHOICES: readonly { id: EditionChoice; label: string }[] = [
  { id: "both", label: "Morning and evening" },
  { id: "morning", label: "Morning only" },
  { id: "evening", label: "Evening only" },
];

export const SLOT_NAME: Record<Slot, string> = { am: "Morning edition", pm: "Evening edition" };

/** The local hour each edition goes out. */
export const LOCAL_SEND_HOUR: Record<Slot, number> = { am: 7, pm: 18 };
/** Hours after the send hour that still count, so a failed run is retried the next hour. */
const SEND_WINDOW_HOURS = 2;

/** Readers with no detected time zone get Eastern, the edition's home zone. */
export const DEFAULT_TIME_ZONE = "America/New_York";

/** Whether `tz` is an IANA time zone this runtime knows. */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The local date (YYYY-MM-DD) and hour (0-23) at `now` in `tz`. */
export function localTime(now: number, tz: string): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

/** The edition due now for a reader in `tz`, if their clock is inside a send window: its slot and edition key. */
export function dueSlot(now: number, tz: string): { slot: Slot; key: string } | null {
  const { date, hour } = localTime(now, tz);
  for (const slot of ["am", "pm"] as const) {
    const from = LOCAL_SEND_HOUR[slot];
    if (hour >= from && hour < from + SEND_WINDOW_HOURS) return { slot, key: editionKey(date, slot) };
  }
  return null;
}

/** Whether a reader's choice includes this slot. */
export const takes = (choice: EditionChoice | "none", slot: Slot) => choice === "both" || choice === choiceFor(slot);

/** "Pacific", "Eastern", "Central European": the zone's everyday name, for copy like "7 a.m. Pacific time". */
export function zoneName(tz: string, now = Date.now()): string {
  const long = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "long" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? tz;
  return long.replace(/\s+(Standard|Daylight|Summer)\s+Time$/, "").replace(/\s+Time$/, "");
}

/** What a reader's last_sent_date holds once an edition is sent: "2026-10-25-am". Keys sort in send order. */
export const editionKey = (date: string, slot: Slot) => `${date}-${slot}`;

/** Which choice includes this slot's email. */
export const choiceFor = (slot: Slot): EditionChoice => (slot === "am" ? "morning" : "evening");

export const isEditionChoice = (v: unknown): v is EditionChoice => v === "both" || v === "morning" || v === "evening";

/** The edition the site is showing now, by the reader's clock: morning from 5 a.m., evening from 4 p.m. */
export function currentSlot(now: number, tz: string = DEFAULT_TIME_ZONE): Slot {
  const { hour } = localTime(now, tz);
  return hour >= 5 && hour < 16 ? "am" : "pm";
}
