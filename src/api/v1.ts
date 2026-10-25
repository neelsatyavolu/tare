import { Hono } from "hono";
import { leanReading } from "../build/select";
import { displayImage } from "../build/photos";
import { cardLine, editionByDate, latestEdition, orderedSources, shownSummary, sourcesFor, storiesFor, storyById, type Edition, type Source, type Story } from "../editions";
import type { Env } from "../env";
import { editionLayout } from "../layout";
import { LEAN_LABEL, sideOf, SIDE_SIZE } from "../outlets";
import { readFirst, readFirstLabel } from "../read-first";
import { currentSlot, DEFAULT_TIME_ZONE, isTimeZone, SLOT_NAME } from "../slots";
import { topicName } from "../topics";
import { DATE_RE } from "../editions";
import { kindLabel, namedOutlets } from "../web/components";
import { registerDevice, removeDevice, parseDevice } from "../push/devices";

/**
 * The JSON API the iOS app reads. Same data and the same rules as the site: the app never computes an
 * edition, it renders this one. Version 1; breaking changes get /api/v2.
 */
export const api = new Hono<{ Bindings: Env }>();

/** How long clients and Cloudflare may reuse an edition response; the edition changes hourly. */
const EDITION_MAX_AGE = 120;

api.use(async (c, next) => {
  await next();
  if (!c.res.headers.get("cache-control")) c.header("cache-control", "no-store");
});

function photoOf(story: Story, sources: Map<string, Source>) {
  const src = story.imageItemId ? sources.get(story.imageItemId) : undefined;
  return src?.imageUrl ? { url: displayImage(src.imageUrl), credit: src.outlet.name } : null;
}

function sourceJson(s: Source, n: number) {
  return {
    n,
    id: s.id,
    outlet: s.outlet.name,
    lean: s.outlet.lean,
    leanLabel: LEAN_LABEL[s.outlet.lean],
    side: sideOf(s.outlet.lean) ?? "unrated",
    title: s.title,
    url: s.url,
    publishedAt: s.publishedAt,
    snippet: s.snippet ?? null,
  };
}

/** One story as the app shows it. `full` adds the sources, the differences' quotes and the read-first link. */
function storyJson(story: Story, sources: Map<string, Source>, full: boolean) {
  const ordered = orderedSources(story, sources);
  const numbers = new Map(ordered.map((s, i) => [s.id, i + 1]));
  const cite = (ids: readonly string[]) => [...new Set(ids.map((id) => numbers.get(id)).filter((n): n is number => n !== undefined))].sort((a, b) => a - b);
  const read = leanReading(story.coverage);
  const first = readFirst(story, sources);
  return {
    id: story.id,
    url: `/s/${story.id}`,
    front: story.front,
    topic: story.topic,
    topicName: topicName(story.topic),
    headline: story.headline,
    cardLine: cardLine(story),
    summary: shownSummary(story).map((s) => ({ text: s.text, cites: cite(s.cites) })),
    why: story.why ? { text: story.why.text, cites: cite(story.why.cites) } : null,
    coverage: { ...story.coverage, sideSize: SIDE_SIZE, reading: read },
    blindspot: story.blindspot,
    importance: story.importance,
    firstSeenAt: story.firstSeenAt,
    photo: photoOf(story, sources),
    correction: story.correction ?? null,
    namedOutlets: namedOutlets(story, sources),
    differences: story.differences.map((d) => ({
      kind: d.kind,
      label: kindLabel(d.kind, d.cites, sources),
      text: d.text,
      cites: cite(d.cites),
      quotes: full ? d.cites.slice(0, 2).map((id) => sources.get(id)).filter((s): s is Source => !!s).map((s) => sourceJson(s, numbers.get(s.id) ?? 0)) : [],
    })),
    readFirst: full && first ? { label: readFirstLabel(first), title: first.title, url: first.url, outlet: first.outlet.name } : null,
    sources: full ? ordered.map((s, i) => sourceJson(s, i + 1)) : [],
  };
}

function editionJson(edition: Edition, stories: Story[], sources: Map<string, Source>, isToday: boolean, tz: string) {
  const layout = editionLayout(stories);
  const ids = (list: readonly Story[]) => list.map((s) => s.id);
  return {
    date: edition.date,
    number: edition.number,
    isToday,
    slot: isToday ? SLOT_NAME[currentSlot(Date.now(), tz)] : null,
    updatedAt: edition.builtAt,
    sections: [
      { id: "front", name: "Front page", storyIds: ids(layout.front) },
      ...(layout.blindspots.length ? [{ id: "blindspots", name: "Blindspots", storyIds: ids(layout.blindspots) }] : []),
      ...layout.topics.map((t) => ({ id: t.id, name: t.name, storyIds: ids(t.stories) })),
    ],
    // The lead carries its read-first link, like the site; other stories get theirs on their own page.
    stories: stories.map((s, i) => storyJson(s, sources, i === 0 && s.front)),
  };
}

/** Today's edition, or the edition for ?date=YYYY-MM-DD. */
api.get("/edition", async (c) => {
  const date = c.req.query("date");
  if (date !== undefined && !DATE_RE.test(date)) return c.json({ error: "bad date" }, 400);
  const latest = await latestEdition(c.env.DB);
  const edition = date ? await editionByDate(c.env.DB, date) : latest;
  if (!edition || edition.status !== "ready") return c.json({ error: "no edition" }, 404);
  const stories = await storiesFor(c.env.DB, edition.date);
  // Only the lead's sources are needed: its photo, read-first link and named outlets; card photos need theirs too.
  const sources = await sourcesFor(c.env.DB, stories);
  c.header("cache-control", `public, max-age=${EDITION_MAX_AGE}`);
  // The app sends the phone's zone (?tz=); otherwise Cloudflare's guess from the connection.
  const asked = c.req.query("tz");
  const detected = (c.req.raw as { cf?: { timezone?: unknown } }).cf?.timezone;
  const tz = isTimeZone(asked) ? asked : isTimeZone(detected) ? detected : DEFAULT_TIME_ZONE;
  return c.json(editionJson(edition, stories, sources, edition.date === latest?.date, tz));
});

api.get("/stories/:id", async (c) => {
  const story = await storyById(c.env.DB, c.req.param("id"));
  if (!story) return c.json({ error: "not found" }, 404);
  const sources = await sourcesFor(c.env.DB, [story]);
  c.header("cache-control", `public, max-age=${EDITION_MAX_AGE}`);
  return c.json(storyJson(story, sources, true));
});

/** Registers (or updates) a device for push notifications. Body: {token, editions, breaking, environment}. */
api.post("/devices", async (c) => {
  const { success } = await c.env.SIGNUP_LIMIT.limit({ key: c.req.header("cf-connecting-ip") ?? "unknown" });
  if (!success) return c.json({ error: "slow down" }, 429);
  const device = parseDevice(await c.req.json().catch(() => null));
  if (!device) return c.json({ error: "bad device" }, 400);
  await registerDevice(c.env.DB, device, Date.now());
  return c.json({ ok: true });
});

api.delete("/devices/:token", async (c) => {
  await removeDevice(c.env.DB, c.req.param("token"));
  return c.json({ ok: true });
});
