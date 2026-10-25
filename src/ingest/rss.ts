import { XMLParser } from "fast-xml-parser";

export type FeedItem = { title: string; url: string; snippet: string; publishedAt: number; imageUrl: string | null };

const SNIPPET_MAX = 400;
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_|cmpid$|ocid$|smid$|taid$|ref$|rss$|cid$)/i;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  cdataPropName: false,
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => name === "item" || name === "entry" || name === "link",
});

/** Canonical form of an article link: http(s) only, no fragment, no tracking parameters. */
export function normalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const kept = [...url.searchParams].filter(([k]) => !TRACKING_PARAMS.test(k));
  const search = kept.length ? `?${new URLSearchParams(kept).toString()}` : "";
  return `${url.protocol}//${url.host}${url.pathname}${search}`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z0-9#]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Plain text from a feed field that may hold HTML, CDATA or a { #text } node. */
function text(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") {
    const stripped = decodeEntities(String(node).replace(/<[^>]*>/g, " "));
    return decodeEntities(stripped).replace(/\s+/g, " ").trim();
  }
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === "object" && "#text" in node) return text((node as Record<string, unknown>)["#text"]);
  return "";
}

function clip(s: string): string {
  if (s.length <= SNIPPET_MAX) return s;
  const cut = s.slice(0, SNIPPET_MAX);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > SNIPPET_MAX * 0.6 ? space : SNIPPET_MAX).trimEnd()}…`;
}

function date(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    const t = Date.parse(text(c));
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/** Atom links are elements with href attributes; RSS links are text. Prefer rel="alternate". */
function link(links: unknown): string {
  if (!Array.isArray(links)) return text(links);
  const nodes = links as (string | Record<string, string>)[];
  const pick =
    nodes.find((l) => typeof l === "object" && (l["@rel"] ?? "alternate") === "alternate" && l["@href"]) ??
    nodes.find((l) => typeof l === "string" || (typeof l === "object" && l["#text"]));
  if (!pick) return "";
  return typeof pick === "string" ? pick : (pick["@href"] ?? pick["#text"] ?? "");
}

type RawEntry = Record<string, unknown>;

/** An https image URL, or null. Plain-http images would be blocked as mixed content anyway. */
function httpsImage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(decodeEntities(raw.trim()));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const asList = (v: unknown): Record<string, unknown>[] =>
  (Array.isArray(v) ? v : v ? [v] : []).filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null);

const isImage = (n: Record<string, unknown>) => {
  const type = String(n["@type"] ?? "");
  const medium = String(n["@medium"] ?? "");
  return medium === "image" || type.startsWith("image/") || (!type && !medium);
};

/** The item's picture: media:content, media:thumbnail, an image enclosure, or the first <img> in its HTML. */
function image(e: RawEntry): string | null {
  const group = asList(e["media:group"])[0] ?? {};
  const candidates = [
    ...asList(e["media:content"]).filter(isImage),
    ...asList(group["media:content"]).filter(isImage),
    ...asList(e["media:thumbnail"]),
    ...asList(group["media:thumbnail"]),
    ...asList(e.enclosure).filter((n) => String(n["@type"] ?? "").startsWith("image/")),
  ];
  for (const c of candidates) {
    const url = httpsImage(c["@url"]);
    if (url) return url;
  }
  for (const html of [e["content:encoded"], e.description, e.content]) {
    const raw = typeof html === "string" ? html : typeof html === "object" && html ? (html as Record<string, unknown>)["#text"] : null;
    const src = typeof raw === "string" ? raw.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] : undefined;
    const url = httpsImage(src);
    if (url) return url;
  }
  return null;
}

/** Items from an RSS 2.0 or Atom document. Anything else, or anything malformed, yields an empty list. */
export function parseFeed(xml: string, fetchedAt: number): FeedItem[] {
  let doc: Record<string, any>;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }
  const entries: RawEntry[] = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? doc?.["rdf:RDF"]?.item ?? [];
  if (!Array.isArray(entries)) return [];

  return entries.flatMap((e) => {
    const title = text(e.title);
    const url = normalizeUrl(link(e.link) || text(e.guid));
    if (!title || !url) return [];
    const snippet = clip(text(e.description ?? e.summary ?? e.content));
    const publishedAt = date(e.pubDate, e.published, e.updated, e["dc:date"]) ?? fetchedAt;
    return [{ title, url, snippet, publishedAt, imageUrl: image(e) }];
  });
}
