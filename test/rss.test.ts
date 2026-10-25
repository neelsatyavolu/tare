import { describe, expect, it } from "vitest";
import { normalizeUrl, parseFeed } from "../src/ingest/rss";

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Example</title>
<item><title><![CDATA[Senate passes &amp; sends bill]]></title><link>https://ex.com/a?utm_source=rss#top</link>
<description><![CDATA[<p>The Senate voted <b>52-48</b> on Tuesday.</p><img src="x.jpg"/>]]></description>
<pubDate>Sat, 24 Oct 2026 14:00:00 GMT</pubDate></item>
<item><title>No date story</title><link>https://ex.com/b</link></item>
<item><title></title><link>https://ex.com/c</link></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title>
<entry><title type="html">Court rules on case</title><link rel="alternate" href="https://ex.org/x"/>
<summary>Justices split 5-4.</summary><updated>2026-10-24T12:00:00Z</updated></entry>
</feed>`;

describe("parseFeed", () => {
  it("reads RSS items, decodes entities and strips HTML from descriptions", () => {
    const items = parseFeed(RSS, 1_000);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      title: "Senate passes & sends bill",
      url: "https://ex.com/a",
      snippet: "The Senate voted 52-48 on Tuesday.",
      publishedAt: Date.parse("2026-10-24T14:00:00Z"),
      imageUrl: null,
    });
  });

  it("falls back to the fetch time when an item has no date", () => {
    expect(parseFeed(RSS, 1_000)[1]?.publishedAt).toBe(1_000);
  });

  it("reads Atom entries", () => {
    expect(parseFeed(ATOM, 0)).toEqual([
      { title: "Court rules on case", url: "https://ex.org/x", snippet: "Justices split 5-4.", publishedAt: Date.parse("2026-10-24T12:00:00Z"), imageUrl: null },
    ]);
  });

  it("returns nothing for something that is not a feed", () => {
    expect(parseFeed("<html><body>hi</body></html>", 0)).toEqual([]);
    expect(parseFeed("not xml at all", 0)).toEqual([]);
  });

  it("caps snippets at 400 characters on a word boundary", () => {
    const long = Array.from({ length: 200 }, () => "word").join(" ");
    const xml = `<rss><channel><item><title>T</title><link>https://ex.com/l</link><description>${long}</description></item></channel></rss>`;
    const snippet = parseFeed(xml, 0)[0]?.snippet ?? "";
    expect(snippet.length).toBeLessThanOrEqual(401);
    expect(snippet.endsWith("…")).toBe(true);
  });
});

describe("feed images", () => {
  const item = (inner: string) =>
    parseFeed(`<rss xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>T</title><link>https://ex.com/i</link>${inner}</item></channel></rss>`, 0)[0]?.imageUrl;

  it("reads media:content, media:thumbnail and image enclosures", () => {
    expect(item('<media:content url="https://img.test/a.jpg" medium="image" width="1200"/>')).toBe("https://img.test/a.jpg");
    expect(item('<media:thumbnail url="https://img.test/t.jpg"/>')).toBe("https://img.test/t.jpg");
    expect(item('<enclosure url="https://img.test/e.png" type="image/png" length="1"/>')).toBe("https://img.test/e.png");
    expect(item('<media:group><media:content url="https://img.test/g.jpg" type="image/jpeg"/></media:group>')).toBe("https://img.test/g.jpg");
  });

  it("falls back to the first <img> in the item's HTML and skips video and http", () => {
    expect(item('<description><![CDATA[<p><img src="https://img.test/d.jpg?w=800&amp;h=400"/></p>]]></description>')).toBe("https://img.test/d.jpg?w=800&h=400");
    expect(item('<media:content url="https://vid.test/v.mp4" medium="video"/>')).toBeNull();
    expect(item('<media:thumbnail url="http://img.test/insecure.jpg"/>')).toBeNull();
  });
});

describe("normalizeUrl", () => {
  it("drops tracking parameters and fragments", () => {
    expect(normalizeUrl("https://ex.com/a?utm_source=x&id=3&fbclid=9#frag")).toBe("https://ex.com/a?id=3");
  });

  it("rejects non-http links", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });
});
