import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { buildEdition, checkBlindspot, EMBED_MODEL, pickImage } from "../src/build/build";
import { displayImage, weakImage } from "../src/build/photos";
import { WRITEUP_VERSION, type AiRunner } from "../src/build/summarize";

const NOW = Date.parse("2026-10-24T10:15:00Z");

// Three events, each covered across the spectrum, plus filler that matches nothing.
const EVENTS: Record<string, { axis: number; outlets: string[]; topic: string }> = {
  senate: { axis: 0, outlets: ["vox", "nyt", "npr", "bbc", "pbs", "fox", "nypost", "breitbart"], topic: "politics" },
  quake: { axis: 1, outlets: ["guardian", "abc", "bbc", "upi", "washtimes", "dailywire"], topic: "world" },
  merger: { axis: 2, outlets: ["fox", "nypost", "dailycaller", "federalist", "dailywire", "breitbart", "washtimes", "washexam", "natreview", "freebeacon", "cnbc"], topic: "business" },
  // Not seeded at first: breaks later in the day.
  storm: { axis: 3, outlets: ["guardian", "bbc", "fox"], topic: "climate" },
};
const SEEDED = ["senate", "quake", "merger"];
const DIM = 10;

async function addItems(key: string, outlets: string[], at: number) {
  await env.DB.batch(
    outlets.map((o, i) =>
      env.DB.prepare("INSERT OR IGNORE INTO items (id, outlet_id, title, snippet, published_at, url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(`${key}-${o}`, o, `${key} story from ${o}`, `about ${key}`, at - (i + 1) * 60_000, `https://x.test/${key}-${o}`, at),
    ),
  );
}

async function seed() {
  for (const key of SEEDED) await addItems(key, EVENTS[key]!.outlets, NOW);
  await env.DB.batch(
    Array.from({ length: 40 }, (_, i) =>
      env.DB.prepare("INSERT INTO items (id, outlet_id, title, snippet, published_at, url, fetched_at) VALUES (?, 'axios', ?, '', ?, ?, ?)")
        .bind(`filler-${i}`, `filler ${i}`, NOW - 3600_000, `https://x.test/filler-${i}`, NOW),
    ),
  );
}

function vectorFor(text: string): number[] {
  const v = Array(DIM).fill(0);
  const ev = Object.entries(EVENTS).find(([k]) => text.startsWith(k));
  if (ev) v[ev[1].axis] = 1;
  else v[4 + (Number(text.match(/filler (\d+)/)?.[1] ?? 0) % (DIM - 4))] = 1;
  return v;
}

let summaryCalls = 0;

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
          return [label, { section: key ? EVENTS[key]!.topic : "world", importance: key ? 4 : 2 }];
        }));
        return { response: JSON.stringify(map) };
      }
      if (system!.startsWith("You check a news summary")) {
        const n = (user0!.match(/^\[\d+\]/gm) ?? []).length;
        return { response: JSON.stringify({ supported: Array(n).fill(true) }) };
      }
      if (system!.startsWith("You are the last editor")) return { response: JSON.stringify({ story_ok: true, bad_differences: [] }) };
      if (opts.failSummaries) throw new Error("model down");
      summaryCalls += 1;
      const user = (input.messages as { content: string }[])[1]!.content;
      const key = Object.keys(EVENTS).find((k) => user.includes(`${k} story`))!;
      return {
        response: JSON.stringify({
          topic: EVENTS[key]!.topic,
          headline: `${key} headline`,
          summary: [
            { text: `What happened in the ${key} headline story.`, sources: ["s1", "s2"] },
            { text: `Officials responded to the ${key} news.`, sources: ["s1"] },
          ],
          differences: [],
          off_topic: [],
        }),
      };
    },
  };
}

describe("checkBlindspot", () => {
  const item = (id: string, outletId: string, vec: number[]) => ({ id, outletId, publishedAt: 0, vec });
  const group = { members: [item("a", "fox", [1, 0]), item("b", "nypost", [1, 0])] };

  it("keeps a blindspot when nothing from the skipping side is close", () => {
    const all = [...group.members, item("c", "vox", [0, 1])];
    expect(checkBlindspot({ blindspot: "left" as const }, group, all).blindspot).toBe("left");
  });

  it("clears it when the skipping side published a matching headline that didn't cluster", () => {
    const all = [...group.members, item("c", "vox", [0.8, 0.6])];
    expect(checkBlindspot({ blindspot: "left" as const }, group, all).blindspot).toBeNull();
  });
});

describe("pickImage", () => {
  const src = (id: string, outletId: string, imageUrl: string | null = `https://img.test/${id}.jpg`) => ({ id, outletId, imageUrl });

  it("prefers a center outlet's photo", () => {
    expect(pickImage([src("a", "fox"), src("b", "vox"), src("c", "axios")])).toBe("c");
  });

  it("otherwise takes it from the side that covered the story less", () => {
    expect(pickImage([src("a", "fox"), src("b", "nypost"), src("c", "vox")])).toBe("c");
    expect(pickImage([src("a", "fox"), src("b", "vox"), src("c", "nyt")])).toBe("a");
  });

  it("passes over video frames and small thumbnails when a sharp photo exists", () => {
    const nbcVideo = "https://media-cldnry.s-nbcnews.com/image/upload/t_fit_1500w/mpx/2704722219/2026_10/frame_1920x1080.jpg";
    const abcThumb = "https://s.abcnews.com/images/US/wirestory_abc_4x3_384.jpg";
    expect(pickImage([src("a", "nbc", nbcVideo), src("b", "abc", abcThumb), src("c", "fox")])).toBe("c");
    // With nothing better, a weak photo still beats none.
    expect(pickImage([src("a", "nbc", nbcVideo)])).toBe("a");
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
    // All three are important (4). The merger had the most outlets but none on the left: important enough to
    // lead anyway, marked as a possible blindspot.
    expect(results.map((r) => r.headline)).toEqual(["merger headline", "senate headline", "quake headline"]);
    expect(results.map((r) => r.front)).toEqual([1, 1, 1]);
    expect(results[0]).toMatchObject({ topic: "business", blindspot: "left" });
    expect(JSON.parse(results[1]!.coverage)).toMatchObject({ left: 3, center: 1, right: 3, unrated: 1, total: 8 });

    const edition = await env.DB.prepare("SELECT number, status FROM editions WHERE date = ?").bind("2026-10-24").first();
    expect(edition).toEqual({ number: 1, status: "ready" });
  });

  const HOUR = 3600_000;
  const lineup = async () =>
    (await env.DB.prepare("SELECT id, headline, active, coverage FROM stories ORDER BY headline").all<{ id: string; headline: string; active: number; coverage: string }>()).results;

  it("refreshes in place: continuing stories keep their id without new write-ups", async () => {
    await buildEdition(env.DB, fakeAi(), NOW);
    const before = await lineup();
    summaryCalls = 0;
    const r = await buildEdition(env.DB, fakeAi(), NOW + HOUR);
    expect(r).toMatchObject({ status: "ready", stories: 3, kept: 3, written: 0 });
    expect(summaryCalls).toBe(0);
    expect(await lineup()).toEqual(before);
  });

  it("adds a breaking story within the hour and retires one that dropped out, keeping its row", async () => {
    await buildEdition(env.DB, fakeAi(), NOW);
    const merger = (await lineup()).find((s) => s.headline === "merger headline")!;
    await addItems("storm", EVENTS.storm!.outlets, NOW + HOUR);
    await env.DB.exec("DELETE FROM items WHERE id LIKE 'merger-%'");

    summaryCalls = 0;
    const r = await buildEdition(env.DB, fakeAi(), NOW + HOUR);
    expect(r).toMatchObject({ status: "ready", stories: 3, written: 1 });
    expect(summaryCalls).toBe(1);
    const after = await lineup();
    expect(after.find((s) => s.headline === "storm headline")?.active).toBe(1);
    expect(after.find((s) => s.id === merger.id)?.active).toBe(0);
  });

  it("widens coverage on a continuing story and rewrites it when coverage jumps, keeping the id", async () => {
    await buildEdition(env.DB, fakeAi(), NOW);
    const quake = (await lineup()).find((s) => s.headline === "quake headline")!;
    await addItems("quake", ["vox", "slate", "salon", "nyt", "fox", "nypost", "reason"], NOW + HOUR);

    summaryCalls = 0;
    await buildEdition(env.DB, fakeAi(), NOW + HOUR);
    const now = (await lineup()).find((s) => s.headline === "quake headline")!;
    expect(now.id).toBe(quake.id);
    expect(JSON.parse(now.coverage).total).toBe(13);
    expect(summaryCalls).toBe(1);
  });

  it("rewrites stories written under older rules, keeping their ids", async () => {
    await buildEdition(env.DB, fakeAi(), NOW);
    const before = await lineup();
    await env.DB.exec("UPDATE stories SET writeup_version = 1");
    summaryCalls = 0;
    await buildEdition(env.DB, fakeAi(), NOW + HOUR);
    expect(summaryCalls).toBe(3);
    expect((await lineup()).map((s) => s.id)).toEqual(before.map((s) => s.id));
    expect(await env.DB.prepare("SELECT MIN(writeup_version) AS v FROM stories").first("v")).toBe(WRITEUP_VERSION);
  });

  it("skips while another run holds the edition", async () => {
    await buildEdition(env.DB, fakeAi(), NOW);
    await env.DB.prepare("UPDATE editions SET lock_until = ?").bind(NOW + HOUR + 60_000).run();
    expect((await buildEdition(env.DB, fakeAi(), NOW + HOUR)).status).toBe("skipped");
  });

  it("still publishes widely covered stories when the model fails, as attributed stand-ins retried next hour", async () => {
    const r = await buildEdition(env.DB, fakeAi({ failSummaries: true }), NOW);
    expect(r.status).toBe("ready");
    const rows = (await env.DB.prepare("SELECT headline, summary, writeup_version FROM stories ORDER BY headline").all<{ headline: string; summary: string; writeup_version: number }>()).results;
    // Senate (8 outlets) and merger (11) stand in; quake (6) waits for a real write-up.
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.writeup_version).toBe(0);
      expect(JSON.parse(row.summary)[0].text).toMatch(/ reports: /);
    }
    summaryCalls = 0;
    await buildEdition(env.DB, fakeAi(), NOW + HOUR);
    expect(summaryCalls).toBe(3);
  });

  it("never replaces a real write-up with a stand-in when a rewrite fails", async () => {
    await buildEdition(env.DB, fakeAi(), NOW);
    await buildEdition(env.DB, fakeAi({ failSummaries: true }), NOW + HOUR, { force: true });
    const summaries = (await env.DB.prepare("SELECT summary FROM stories").all<{ summary: string }>()).results.map((r) => JSON.parse(r.summary)[0].text);
    expect(summaries.every((t) => !/ reports: /.test(t))).toBe(true);
  });

  it("fails cleanly when there are too few headlines", async () => {
    await env.DB.exec("DELETE FROM items");
    const r = await buildEdition(env.DB, fakeAi(), NOW);
    expect(r).toMatchObject({ status: "failed", error: "only 0 headlines in the last 24 hours" });
  });
});

describe("photo URLs", () => {
  it("knows weak photos and asks the BBC for a larger size", () => {
    expect(weakImage("https://s.abcnews.com/images/US/x_4x3_384.jpg")).toBe(true);
    expect(weakImage("https://media-cldnry.s-nbcnews.com/image/upload/t_fit_1500w/rockcms/2026-10/photo.jpg")).toBe(false);
    const bbc = "https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/7561/live/photo.jpg";
    expect(weakImage(bbc)).toBe(false);
    expect(displayImage(bbc)).toBe("https://ichef.bbci.co.uk/ace/standard/976/cpsprodpb/7561/live/photo.jpg");
  });
});
