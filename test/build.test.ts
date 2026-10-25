import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { buildEdition, EMBED_MODEL, pickImage } from "../src/build/build";
import type { AiRunner } from "../src/build/summarize";

const NOW = Date.parse("2026-10-24T10:15:00Z");

// Three events, each covered across the spectrum, plus filler that matches nothing.
const EVENTS: Record<string, { axis: number; outlets: string[]; topic: string }> = {
  senate: { axis: 0, outlets: ["vox", "nyt", "npr", "bbc", "pbs", "fox", "nypost", "breitbart"], topic: "politics" },
  quake: { axis: 1, outlets: ["guardian", "abc", "bbc", "upi", "washtimes", "dailywire"], topic: "world" },
  merger: { axis: 2, outlets: ["fox", "nypost", "dailycaller", "federalist", "cnbc"], topic: "business" },
};
const DIM = 8;

async function seed() {
  const rows: [string, string, string, string, number][] = [];
  for (const [key, ev] of Object.entries(EVENTS)) {
    ev.outlets.forEach((o, i) => rows.push([`${key}-${o}`, o, `${key} story from ${o}`, `about ${key}`, NOW - (i + 1) * 60_000]));
  }
  for (let i = 0; i < 40; i++) rows.push([`filler-${i}`, "axios", `filler ${i}`, "", NOW - 3600_000]);
  await env.DB.batch(
    rows.map((r) => env.DB.prepare("INSERT INTO items (id, outlet_id, title, snippet, published_at, url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(...r, `https://x.test/${r[0]}`, NOW)),
  );
}

function vectorFor(text: string): number[] {
  const v = Array(DIM).fill(0);
  const ev = Object.entries(EVENTS).find(([k]) => text.startsWith(k));
  if (ev) v[ev[1].axis] = 1;
  else v[3 + (Number(text.match(/filler (\d+)/)?.[1] ?? 0) % (DIM - 3))] = 1;
  return v;
}

function fakeAi(opts: { failSummaries?: boolean } = {}): AiRunner {
  return {
    async run(model, input) {
      if (model === EMBED_MODEL) return { data: (input.text as string[]).map(vectorFor) };
      const [system, user0] = (input.messages as { content: string }[]).map((m) => m.content);
      if (system!.startsWith("Sort news story groups")) {
        // Classifier: put each group in its event's section.
        const map = Object.fromEntries(user0!.split("\n").map((line) => {
          const [label, rest] = line.split(": ");
          const key = Object.keys(EVENTS).find((k) => rest!.startsWith(k));
          return [label, key ? EVENTS[key]!.topic : "world"];
        }));
        return { response: JSON.stringify(map) };
      }
      if (opts.failSummaries) throw new Error("model down");
      const user = (input.messages as { content: string }[])[1]!.content;
      const key = Object.keys(EVENTS).find((k) => user.includes(`${k} story`))!;
      return {
        response: JSON.stringify({
          topic: EVENTS[key]!.topic,
          headline: `${key} headline`,
          summary: [{ text: `What happened with ${key}.`, sources: ["s1", "s2"] }],
          differences: [],
          off_topic: [],
        }),
      };
    },
  };
}

describe("pickImage", () => {
  const src = (id: string, outletId: string, imageUrl: string | null = `https://img.test/${id}.jpg`) => ({ id, outletId, imageUrl });

  it("prefers a center outlet's photo", () => {
    expect(pickImage([src("a", "fox"), src("b", "vox"), src("c", "bbc")])).toBe("c");
  });

  it("otherwise takes it from the side that covered the story less", () => {
    expect(pickImage([src("a", "fox"), src("b", "nypost"), src("c", "vox")])).toBe("c");
    expect(pickImage([src("a", "fox"), src("b", "vox"), src("c", "nyt")])).toBe("a");
  });

  it("skips sources without a photo and returns null when none has one", () => {
    expect(pickImage([src("a", "bbc", null), src("b", "fox")])).toBe("b");
    expect(pickImage([src("a", "bbc", null)])).toBeNull();
  });
});

describe("buildEdition", () => {
  beforeEach(async () => {
    await env.DB.batch([env.DB.prepare("DELETE FROM stories"), env.DB.prepare("DELETE FROM editions"), env.DB.prepare("DELETE FROM items")]);
    await seed();
  });

  it("clusters, writes and stores the day's stories with the front page first", async () => {
    const report = await buildEdition(env.DB, fakeAi(), NOW);
    expect(report).toMatchObject({ date: "2026-10-24", status: "ready", stories: 3 });

    const { results } = await env.DB.prepare("SELECT headline, front, topic, blindspot, coverage FROM stories ORDER BY rank").all<{
      headline: string; front: number; topic: string; blindspot: string | null; coverage: string;
    }>();
    expect(results.map((r) => r.headline)).toEqual(["senate headline", "quake headline", "merger headline"]);
    expect(results.map((r) => r.front)).toEqual([1, 1, 0]);
    // The merger was covered by four right-side outlets and no left-side ones.
    expect(results[2]).toMatchObject({ topic: "business", blindspot: "left" });
    expect(JSON.parse(results[0]!.coverage)).toMatchObject({ left: 3, center: 2, right: 3, total: 8 });

    const edition = await env.DB.prepare("SELECT number, status FROM editions WHERE date = ?").bind("2026-10-24").first();
    expect(edition).toEqual({ number: 1, status: "ready" });
  });

  it("skips a day that is already built unless forced", async () => {
    await buildEdition(env.DB, fakeAi(), NOW);
    expect((await buildEdition(env.DB, fakeAi(), NOW)).status).toBe("skipped");
    expect((await buildEdition(env.DB, fakeAi(), NOW, { force: true })).status).toBe("ready");
  });

  it("marks the edition failed when the model fails, and keeps a ready one readable", async () => {
    const failed = await buildEdition(env.DB, fakeAi({ failSummaries: true }), NOW);
    expect(failed.status).toBe("failed");
    expect(await env.DB.prepare("SELECT status FROM editions").first("status")).toBe("failed");

    await buildEdition(env.DB, fakeAi(), NOW, { force: true });
    await buildEdition(env.DB, fakeAi({ failSummaries: true }), NOW, { force: true });
    expect(await env.DB.prepare("SELECT status FROM editions").first("status")).toBe("ready");
  });

  it("never rebuilds an edition that has started emailing", async () => {
    await buildEdition(env.DB, fakeAi(), NOW);
    await env.DB.prepare("UPDATE editions SET sent_at = 1").run();
    expect((await buildEdition(env.DB, fakeAi(), NOW, { force: true })).status).toBe("skipped");
  });

  it("fails cleanly when there are too few headlines", async () => {
    await env.DB.exec("DELETE FROM items");
    const r = await buildEdition(env.DB, fakeAi(), NOW);
    expect(r).toMatchObject({ status: "failed", error: "only 0 headlines in the last 24 hours" });
  });
});
