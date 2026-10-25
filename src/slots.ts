/**
 * Tare updates every hour and goes out by email twice a day: a morning edition (7 a.m. Eastern) and an evening
 * edition (6 p.m. Eastern, during daylight time). Readers choose one or both.
 */
export type Slot = "am" | "pm";
export type EditionChoice = "both" | "morning" | "evening";

export const EDITION_CHOICES: readonly { id: EditionChoice; label: string }[] = [
  { id: "both", label: "Morning and evening" },
  { id: "morning", label: "Morning only" },
  { id: "evening", label: "Evening only" },
];

export const SLOT_NAME: Record<Slot, string> = { am: "Morning edition", pm: "Evening edition" };

/** The UTC hour each edition's email goes out (cron schedules in wrangler.jsonc match these). */
export const SEND_HOUR_UTC: Record<Slot, number> = { am: 11, pm: 22 };

/** What a reader's last_sent_date holds once an edition is sent: "2026-10-25-am". Keys sort in send order. */
export const editionKey = (date: string, slot: Slot) => `${date}-${slot}`;

/** Which choice includes this slot's email. */
export const choiceFor = (slot: Slot): EditionChoice => (slot === "am" ? "morning" : "evening");

export const isEditionChoice = (v: unknown): v is EditionChoice => v === "both" || v === "morning" || v === "evening";

/** The edition the site is showing now, by the Eastern clock: morning from 5 a.m., evening from 4 p.m. */
export function currentSlot(now: number): Slot {
  const hour = Number(new Date(now).toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" })) % 24;
  return hour >= 5 && hour < 16 ? "am" : "pm";
}
