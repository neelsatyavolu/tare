import { describe, expect, it } from "vitest";
import { currentSlot, dueSlot, isTimeZone, localTime, takes, zoneName } from "../src/slots";

// 2026-10-25 14:00 UTC: 7 a.m. in Los Angeles (PDT), 10 a.m. in New York (EDT).
const NOW = Date.parse("2026-10-25T14:00:00Z");

describe("time zones", () => {
  it("accepts IANA zones and rejects anything else", () => {
    expect(isTimeZone("America/Los_Angeles")).toBe(true);
    expect(isTimeZone("Not/AZone")).toBe(false);
    expect(isTimeZone(42)).toBe(false);
  });

  it("reads the local date and hour", () => {
    expect(localTime(NOW, "America/Los_Angeles")).toEqual({ date: "2026-10-25", hour: 7 });
    expect(localTime(NOW, "Asia/Tokyo")).toEqual({ date: "2026-10-25", hour: 23 });
  });

  it("names zones the way readers say them", () => {
    expect(zoneName("America/Los_Angeles", NOW)).toBe("Pacific");
    expect(zoneName("America/New_York", NOW)).toBe("Eastern");
  });
});

describe("dueSlot", () => {
  it("is the morning edition at 7 and 8 a.m. local, keyed by the local date", () => {
    expect(dueSlot(NOW, "America/Los_Angeles")).toEqual({ slot: "am", key: "2026-10-25-am" });
    expect(dueSlot(NOW + 3600_000, "America/Los_Angeles")).toEqual({ slot: "am", key: "2026-10-25-am" });
    expect(dueSlot(NOW + 2 * 3600_000, "America/Los_Angeles")).toBeNull();
    expect(dueSlot(NOW, "America/New_York")).toBeNull();
  });

  it("is the evening edition at 6 p.m. local", () => {
    // 01:00 UTC on the 26th is 6 p.m. on the 25th in Los Angeles.
    expect(dueSlot(Date.parse("2026-10-26T01:00:00Z"), "America/Los_Angeles")).toEqual({ slot: "pm", key: "2026-10-25-pm" });
  });

  it("matches choices to slots", () => {
    expect(takes("both", "pm")).toBe(true);
    expect(takes("morning", "pm")).toBe(false);
    expect(takes("evening", "pm")).toBe(true);
  });
});

it("labels the edition by the reader's clock", () => {
  expect(currentSlot(NOW, "America/Los_Angeles")).toBe("am");
  expect(currentSlot(NOW, "Asia/Tokyo")).toBe("pm");
});
