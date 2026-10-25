#!/usr/bin/env node
// Builds data/outlets.generated.json: every outlet Tare reads, with its audience-lean score and working feeds.
//
//   npx esbuild src/ingest/rss.ts --bundle --format=esm --platform=node --outfile=.tmp/rss.mjs
//   node scripts/discover-feeds.mjs
//
// Scores come from Eady, Bonneau, Tucker & Nagler (2025), CC0 (data/eady2025). Outlets not in that data are
// listed as unrated. A feed is kept only if its items carry real dates and it published in the last 72 hours,
// so stale or undated items can't pass for news.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseFeed } from "../.tmp/rss.mjs";

const UA = "Mozilla/5.0 (compatible; TareBot/0.1; +https://tare.news/method)";
const FRESH_MS = 72 * 3600_000;
const MAX_FEEDS = 10;
const COMMENTS_FEED = /\/comments\/feed\b/i;
const COMMON_PATHS = ["/feed", "/feed/", "/rss", "/rss.xml", "/feeds/all.rss", "/index.xml", "/rss/index.xml", "/feed/rss2"];

const extra = JSON.parse(readFileSync("data/outlets-extra.json", "utf8"));
const scores = readFileSync("data/eady2025/News_Domain_Media_Scores.csv", "utf8")
  .trim()
  .split("\n")
  .slice(1)
  .map((line) => {
    const [domain, zeta, low, high] = line.split(",");
    return { domain: domain.toLowerCase(), zeta: Number(zeta), zetaLow: Number(low), zetaHigh: Number(high) };
  });

const exclude = new Set(extra.exclude);
const known = new Map(extra.known.map((k) => [k.domain, k]));
const extraByDomain = new Map(extra.extraDomains.map((e) => [e.domain, e]));

async function get(url) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 6_000_000 ? null : { text, url: res.url };
  } catch {
    return null;
  }
}

/** A usable feed: at least 3 items, nearly all with real dates, and something from the last 72 hours. */
async function checkFeed(url, now) {
  const page = await get(url);
  if (!page) return null;
  const items = parseFeed(page.text, 0);
  if (items.length < 3) return null;
  const dated = items.filter((i) => i.publishedAt > 0);
  if (dated.length / items.length < 0.9) return null;
  const fresh = dated.filter((i) => now - i.publishedAt < FRESH_MS).length;
  return fresh > 0 ? { url, fresh, links: items.map((i) => i.url) } : null;
}

function homepageLinks(html, base) {
  const feeds = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?alternate/i.test(tag) || !/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (href) {
      try {
        feeds.push(new URL(href.replace(/&amp;/g, "&"), base).toString());
      } catch {}
    }
  }
  return feeds;
}

function siteName(html) {
  const og = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i)?.[1];
  if (og) return og.trim();
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  return title ? title.split(/\s[|\-–—:]\s/)[0].trim() : null;
}

const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&").replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"').split(/\s[–—|-]\s/)[0].trim();

const slug = (domain) => domain.replace(/^www\./, "").replace(/\.(com|org|net|news|us|co)(\/.*)?$/, "").replace(/[^a-z0-9]+/g, "");

async function discover(domain, now) {
  const host = domain.split("/")[0];
  const home = (await get(`https://${domain}`)) ?? (await get(`https://www.${domain}`));
  const preset = known.get(domain)?.feeds ?? extraByDomain.get(domain)?.feeds ?? extra.presets?.[domain] ?? [];
  const found = home ? homepageLinks(home.text, home.url) : [];
  const guesses = COMMON_PATHS.map((p) => `https://${host}${p}`);
  // WordPress advertises a feed of reader comments next to the posts feed; those aren't headlines.
  const candidates = [...new Set([...preset, ...found, ...guesses])].filter((u) => preset.includes(u) || !COMMENTS_FEED.test(u));

  const ok = [];
  const seen = new Set();
  for (const url of candidates) {
    if (ok.length >= MAX_FEEDS) break;
    // Hand-picked section feeds are all tried; for the rest one working feed is enough.
    if (!preset.includes(url) && ok.length > 0 && ok.some((f) => !preset.includes(f.url))) continue;
    // One retry: busy servers sometimes refuse a burst of requests.
    const feed = (await checkFeed(url, now)) ?? (await new Promise((r) => setTimeout(r, 2000)).then(() => checkFeed(url, now)));
    // A found feed whose items are all in feeds already kept is the same feed at another address (no www, a
    // trailing slash); it would only add a fetch every hour.
    if (!feed || (!preset.includes(url) && feed.links.every((l) => seen.has(l)))) continue;
    ok.push(feed);
    for (const l of feed.links) seen.add(l);
  }
  return { name: home ? siteName(home.text) : null, feeds: ok.map((f) => f.url) };
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  }));
  return out;
}

const now = Date.now();
const targets = [
  ...scores.filter((s) => !exclude.has(s.domain)).map((s) => ({ ...s, rated: true })),
  ...extra.unrated.filter((d) => !scores.some((s) => s.domain === d)).map((domain) => ({ domain, rated: false })),
];

const results = await mapLimit(targets, 12, async (t) => {
  const k = known.get(t.domain) ?? extraByDomain.get(t.domain);
  const found = await discover(t.domain, now);
  const name = found.name;
  // An outlet Tare already reads keeps its hand-picked feeds if a discovery run can't reach them right now.
  const feeds = found.feeds.length ? found.feeds : (known.get(t.domain)?.feeds ?? []);
  process.stderr.write(`${feeds.length ? "ok " : "-- "} ${t.domain} ${feeds.length}\n`);
  if (!feeds.length) return null;
  return {
    id: k?.id ?? slug(t.domain),
    name: k?.name ?? extra.names?.[t.domain] ?? (name ? decode(name) : t.domain),
    domain: t.domain,
    ...(t.rated ? { zeta: t.zeta, zetaLow: t.zetaLow, zetaHigh: t.zetaHigh } : {}),
    feeds,
  };
});

const outlets = results.filter(Boolean).sort((a, b) => (a.zeta ?? 99) - (b.zeta ?? 99) || a.id.localeCompare(b.id));
const ids = new Set();
for (const o of outlets) {
  if (ids.has(o.id)) throw new Error(`duplicate id ${o.id}`);
  ids.add(o.id);
}
mkdirSync("data", { recursive: true });
writeFileSync(
  "data/outlets.generated.json",
  JSON.stringify({ generatedAt: new Date(now).toISOString(), source: "scripts/discover-feeds.mjs", outlets }, null, 1) + "\n",
);
console.log(`${outlets.length} outlets, ${outlets.reduce((n, o) => n + o.feeds.length, 0)} feeds (${targets.length - outlets.length} without a working feed)`);
