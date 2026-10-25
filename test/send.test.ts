import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Story } from "../src/editions";
import { sendEdition } from "../src/mail/send";
import { digestEmail, digestFor } from "../src/mail/templates";
import { outletById } from "../src/outlets";
import { confirm, findById, signUp } from "../src/subscribers";

const NOW = Date.parse("2026-10-24T11:00:00Z");
const DATE = "2026-10-24";
const cov = { left: 3, center: 2, right: 3, total: 8, balance: 0 };

const story = (id: string, rank: number, topic: string, front: boolean, blindspot: "left" | "right" | null = null) => ({
  id: id.padEnd(32, "0"), editionDate: DATE, rank, front, topic, blindspot, headline: `Headline ${id}`,
  summary: [{ text: `Summary ${id} <b>`, cites: ["i1"] }], differences: [], coverage: cov, itemIds: ["i1"],
});

const STORIES = [
  story("a", 0, "politics", true),
  story("b", 1, "world", true),
  story("c", 2, "tech", false),
  story("d", 3, "sports", false),
  story("e", 4, "business", false, "left"),
];

async function seed() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM stories"),
    env.DB.prepare("DELETE FROM editions"),
    env.DB.prepare("DELETE FROM subscribers"),
    env.DB.prepare("INSERT INTO editions (date, number, status) VALUES (?, 7, 'ready')").bind(DATE),
    ...STORIES.map((s) =>
      env.DB.prepare("INSERT INTO stories (id, edition_date, rank, front, topic, headline, summary, differences, coverage, blindspot, item_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(s.id, DATE, s.rank, s.front ? 1 : 0, s.topic, s.headline, JSON.stringify(s.summary), "[]", JSON.stringify(s.coverage), s.blindspot, '["i1"]'),
    ),
  ]);
}

type Sent = { url: string; body: { to: string[]; subject: string; html: string; text: string; headers: Record<string, string> }[] };

function recorder(status = 200) {
  const calls: Sent[] = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(status === 200 ? '{"data":[]}' : "rate limited", { status });
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("digestFor", () => {
  it("puts the front page first, then the reader's topics, then blindspots", () => {
    const d = digestFor(STORIES as unknown as Story[], ["tech"]);
    expect(d.front.map((s) => s.headline)).toEqual(["Headline a", "Headline b"]);
    expect(d.yours.map((s) => s.headline)).toEqual(["Headline c"]);
    expect(d.blindspots.map((s) => s.headline)).toEqual(["Headline e"]);
    // Everything else, widest first, as one-line links.
    expect(d.also.every((s) => !d.front.includes(s) && !d.yours.includes(s) && !d.blindspots.includes(s))).toBe(true);
    expect(d.also.length).toBeLessThanOrEqual(3);
  });
});

describe("sendEdition", () => {
  beforeEach(seed);

  it("emails active readers once, with their topics and a one-click unsubscribe", async () => {
    const a = await signUp(env.DB, "a@ex.com", ["sports"], 0);
    await confirm(env.DB, a.id);
    await signUp(env.DB, "pending@ex.com", ["tech"], 0);

    const { calls, fetcher } = recorder();
    const report = await sendEdition(env, fetcher, NOW);
    expect(report).toMatchObject({ status: "sent", sent: 1, due: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails/batch");

    const mail = calls[0]!.body[0]!;
    expect(mail.to).toEqual(["a@ex.com"]);
    expect(mail.subject).toBe("Tare · Saturday, October 24: Headline a");
    expect(mail.html).toContain("Headline d");
    // The tech story isn't one of this reader's topics, so it only gets a one-line "Also today" link.
    expect(mail.html.split("Also today")[0]).not.toContain("Headline c");
    expect(mail.html.split("Also today")[1]).toContain("Headline c");
    expect(mail.html).toContain("Summary a &lt;b&gt;");
    expect(mail.text).toContain("That's the edition.");
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(mail.headers["List-Unsubscribe"]).toMatch(new RegExp(`^<http://localhost:8787/unsubscribe/${a.id}\\.`));

    expect((await findById(env.DB, a.id))?.lastSentDate).toBe(DATE);
    expect((await sendEdition(env, recorder().fetcher, NOW)).sent).toBe(0);
  });

  it("reports a partial send and leaves readers due when Resend fails", async () => {
    const a = await signUp(env.DB, "a@ex.com", [], 0);
    await confirm(env.DB, a.id);
    const failing = recorder(429);
    const report = await sendEdition(env, failing.fetcher, NOW, async () => {});
    expect(report).toMatchObject({ status: "partial", sent: 0, due: 1 });
    // Three tries with the same idempotency key.
    expect(failing.calls).toHaveLength(3);
    expect((await findById(env.DB, a.id))?.lastSentDate).toBeNull();
  });

  it("does nothing without a ready edition", async () => {
    await env.DB.exec("DELETE FROM editions");
    expect((await sendEdition(env, recorder().fetcher, NOW)).status).toBe("no-edition");
  });
});

describe("digestEmail", () => {
  it("gives the lead its background link, as on the site", () => {
    const stories = STORIES as unknown as Story[];
    const lead = stories.find((s) => s.front)!;
    const src = { id: "x", outlet: outletById("nyt")!, title: "What to Know About the Vote", url: "https://nyt.test/a", publishedAt: 0, imageUrl: null };
    const mail = digestEmail({ date: "2026-10-24", number: 1, status: "ready", itemCount: 0, builtAt: null, sentAt: null } as never, digestFor(stories, []), "https://tare.test", "https://tare.test/m", new Map(), new Map([[lead.id, src]]));
    expect(mail.html).toContain("Background");
    expect(mail.html).toContain("https://nyt.test/a");
  });
});
