import { createContext, useContext, type Child, type FC } from "hono/jsx";
import type { Subscriber } from "../subscribers";
import { LEAN_THRESHOLD, type Coverage } from "../build/select";
import type { Source, Story } from "../editions";
import { longDate } from "../format";
import { LEAN_LABEL, sideOf, SIDE_SIZE, type Side } from "../outlets";
import { TOPICS, topicName, type TopicId } from "../topics";
import { whyText } from "../build/select";
import { CSS_VERSION } from "./styles";

const FONTS = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Libre+Caslon+Display&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap";

type Nav = "today" | "archive" | "method" | "subscribe" | "account" | null;

/** The signed-in reader, if any. Set once per request in index.tsx, read by the layout and pages. */
export const ViewerContext = createContext<Subscriber | null>(null);
export const useViewer = () => useContext(ViewerContext);

export const Layout: FC<{ title: string; description?: string; nav?: Nav; editionLine?: Child; children?: Child }> = ({ title, description, nav = null, editionLine, children }) => {
  const viewer = useViewer();
  return (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      <meta name="description" content={description ?? "A daily news edition that weighs how outlets across the spectrum covered each story."} />
      <meta name="color-scheme" content="light dark" />
      <link rel="icon" href="/icon.svg" type="image/svg+xml" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
      <link rel="stylesheet" href={FONTS} />
      <link rel="stylesheet" href={`/styles.css?v=${CSS_VERSION}`} />
    </head>
    <body>
      <a class="skip" href="#main">Skip to the edition</a>
      <div class="wrap">
        <header class="masthead">
          <a class="wordmark" href="/">Tare</a>
          <p class="tagline">The news, zeroed.</p>
        </header>
        <div class="edition-line">
          <span>{editionLine ?? "Daily edition"}</span>
          <nav aria-label="Main">
            <a href="/" aria-current={nav === "today" ? "page" : undefined}>Today</a>
            <a href="/archive" aria-current={nav === "archive" ? "page" : undefined}>Archive</a>
            <a href="/method" aria-current={nav === "method" ? "page" : undefined}>Method</a>
            {viewer ? (
              <a href="/account" aria-current={nav === "account" ? "page" : undefined}>Account</a>
            ) : (
              <>
                <a href="/#subscribe" aria-current={nav === "subscribe" ? "page" : undefined}>Subscribe</a>
                <a href="/signin" aria-current={nav === "account" ? "page" : undefined}>Sign in</a>
              </>
            )}
          </nav>
        </div>
        <main id="main">{children}</main>
        <footer>
          <span>Tare</span>
          <span><a href="/method">How Tare works</a> · <a href="https://github.com/neelsatyavolu/tare">Open source (MIT)</a></span>
        </footer>
      </div>
    </body>
  </html>
  );
};

export function editionLine(date: string, number: number, stories: number): string {
  return `${longDate(date)} · No. ${number} · ${stories} ${stories === 1 ? "story" : "stories"}`;
}

const SIDES: Side[] = ["left", "center", "right"];
const SIDE_NAME: Record<Side, string> = { left: "Left", center: "Center", right: "Right" };

function reading(balance: number): string {
  if (balance <= -LEAN_THRESHOLD) return "Mostly covered by the left";
  if (balance >= LEAN_THRESHOLD) return "Mostly covered by the right";
  if (balance <= -0.2) return "More coverage from the left";
  if (balance >= 0.2) return "More coverage from the right";
  return "Balanced coverage";
}

/** The coverage scale: three pans (share of each side's outlets) over a ruler with a brass needle. */
export const Scale: FC<{ c: Coverage }> = ({ c }) => {
  const pct = (side: Side) => Math.round((c[side] / SIDE_SIZE[side]) * 100);
  const needle = ((c.balance + 1) / 2) * 100;
  return (
    <div class="scale" role="img" aria-label={`${c.left} of ${SIDE_SIZE.left} left outlets, ${c.center} of ${SIDE_SIZE.center} center, ${c.right} of ${SIDE_SIZE.right} right. ${reading(c.balance)}.`}>
      <div class="pans" aria-hidden="true">
        {SIDES.map((side) => (
          <div class={`pan ${side[0]}`}>
            <span class="pan-label">{SIDE_NAME[side]}</span> {c[side]} of {SIDE_SIZE[side]}
            <div class="bar"><i style={`width:${pct(side)}%`} /></div>
          </div>
        ))}
      </div>
      <div class="ruler" aria-hidden="true"><span class="needle" style={`left:${needle.toFixed(1)}%`} /></div>
      <div class="reading" aria-hidden="true"><span>← Left</span><b>{reading(c.balance)}</b><span>Right →</span></div>
    </div>
  );
};

/** A story's sources in display order (left, center, right, then by outlet), which fixes the citation numbers. */
export function orderedSources(story: Story, sources: Map<string, Source>): Source[] {
  const rank: Record<Side, number> = { left: 0, center: 1, right: 2 };
  return story.itemIds
    .map((id) => sources.get(id))
    .filter((s): s is Source => !!s)
    .sort((a, b) => rank[sideOf(a.outlet.lean)] - rank[sideOf(b.outlet.lean)] || a.outlet.name.localeCompare(b.outlet.name));
}

const KIND_LABEL = { fact: "Facts differ", framing: "Framing", emphasis: "Emphasis", omission: "Left out" } as const;

const MAX_CITES = 3;

/** Source markers after a sentence, kept on one line: [1, 5, 7 +3]. "+3" jumps to the full source list. */
const Cites: FC<{ cites: string[]; numbers: Map<string, number>; base: string }> = ({ cites, numbers, base }) => {
  const ns = [...new Set(cites.map((id) => numbers.get(id)).filter((n): n is number => n !== undefined))].sort((a, b) => a - b);
  if (ns.length === 0) return null;
  const shown = ns.slice(0, MAX_CITES);
  const more = ns.length - shown.length;
  return (
    // U+2060 (word joiner) keeps the bracket on the same line as the sentence's last word.
    <sup class="cites">
      {"\u2060["}{shown.map((n, i) => (
        <>{i > 0 ? ", " : null}<a href={`${base}#src-${n}`} aria-label={`Source ${n}`}>{n}</a></>
      ))}
      {more > 0 ? <> <a href={`${base}#sources`} aria-label={`${more} more sources`}>+{more}</a></> : null}]
    </sup>
  );
};

/**
 * The outlet's own photo for the story, credited. It loads from the outlet's server without a referrer, so
 * the outlet doesn't learn which Tare page it was shown on. Cards lazy-load theirs.
 */
const Photo: FC<{ source: Source; href?: string; eager?: boolean }> = ({ source, href, eager = false }) => {
  const img = <img src={source.imageUrl!} alt="" loading={eager ? "eager" : "lazy"} decoding="async" referrerpolicy="no-referrer" />;
  return (
    <figure class="photo">
      {href ? <a href={href} tabindex={-1} aria-hidden="true">{img}</a> : img}
      <figcaption>Photo: {source.outlet.name}</figcaption>
    </figure>
  );
};

export const StoryCard: FC<{ story: Story; sources: Map<string, Source>; lead?: boolean; page?: boolean }> = ({ story, sources, lead = false, page = false }) => {
  const ordered = orderedSources(story, sources);
  const numbers = new Map(ordered.map((s, i) => [s.id, i + 1]));
  const href = `/s/${story.id}`;
  const base = page ? "" : href;
  const Heading = page ? "h1" : "h3";
  const photoSource = story.imageItemId ? sources.get(story.imageItemId) : undefined;
  const photo = photoSource?.imageUrl ? <Photo source={photoSource} href={page ? undefined : href} eager={lead || page} /> : null;
  const main = (
    <>
      {photo}
      <p class="kicker">
        {story.blindspot ? <b>Blindspot · </b> : null}
        {topicName(story.topic)} · {story.coverage.total} outlets
      </p>
      <Heading>{page ? story.headline : <a href={href}>{story.headline}</a>}</Heading>
      <p class="summary">
        {story.summary.map((s) => (
          <>{s.text}<Cites cites={s.cites} numbers={numbers} base={base} />{" "}</>
        ))}
      </p>
    </>
  );
  const evidence = (
    <>
      <Scale c={story.coverage} />
      {story.differences.length > 0 ? (
        <details class="differ" open={page || lead}>
          <summary>Where accounts differ ({story.differences.length})</summary>
          <ul>
            {story.differences.map((d) => (
              <li><span class="kind">{KIND_LABEL[d.kind]}</span>{d.text}<Cites cites={d.cites} numbers={numbers} base={base} /></li>
            ))}
          </ul>
        </details>
      ) : null}
      {page ? <p class="why"><span class="why-label">Why it's here</span> {whyText(story.coverage, story.blindspot)}</p> : null}
    </>
  );
  // The lead runs across the page: story on the left, the weighing on the right.
  return lead ? (
    <article class="story lead"><div class="lead-main">{main}</div><aside class="lead-side" aria-label="Coverage">{evidence}</aside></article>
  ) : (
    <article class="story">{main}{evidence}</article>
  );
};

export const SourceList: FC<{ story: Story; sources: Map<string, Source> }> = ({ story, sources }) => {
  const ordered = orderedSources(story, sources);
  return (
    <section class="sources" id="sources" aria-labelledby="sources-h">
      <div class="section-head"><h2 id="sources-h">Sources</h2></div>
      <div class="cols">
        {SIDES.map((side) => (
          <div>
            <h4>{SIDE_NAME[side]}</h4>
            <ol>
              {ordered.map((s, i) => sideOf(s.outlet.lean) === side ? (
                <li id={`src-${i + 1}`}>
                  <span class="outlet"><span class="n">{i + 1}</span> {s.outlet.name} · {LEAN_LABEL[s.outlet.lean]}</span>
                  <a href={s.url} rel="noopener noreferrer nofollow" target="_blank">{s.title}</a>
                </li>
              ) : null)}
            </ol>
            {ordered.every((s) => sideOf(s.outlet.lean) !== side) ? <p class="meta">No coverage found.</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
};

/** A short guide for first-time readers. Native <details>, so it works without JavaScript. */
export const HowToRead: FC = () => (
  <details class="howto">
    <summary>New here? How to read this page</summary>
    <div class="howto-body">
      <div>
        <h3>The scale</h3>
        <p>Under each story, the three bars show what share of left-leaning, center and right-leaning outlets covered it. The needle points to the side that covered it more; in the middle means both sides covered it about equally.</p>
      </div>
      <div>
        <h3>The small numbers</h3>
        <p>Every sentence ends with numbers. Each one is a source: tap it to see the outlet's own headline and read the original article.</p>
      </div>
      <div>
        <h3>Where accounts differ</h3>
        <p>Open it to see where outlets reported different facts, used different words, or left something out. Tare doesn't say who is right.</p>
      </div>
      <div>
        <h3>Blindspots</h3>
        <p>Stories one side covered widely and the other side barely touched. They're here so you see what your usual sources might skip.</p>
      </div>
    </div>
  </details>
);

export const TopicChips: FC<{ selected: readonly TopicId[] }> = ({ selected }) => (
  <fieldset>
    <legend>Your topics</legend>
    <div class="chips">
      {TOPICS.map((t) => (
        <label class="chip">
          <input type="checkbox" name="topics" value={t.id} checked={selected.includes(t.id)} />
          <span>{t.name}</span>
        </label>
      ))}
    </div>
    <p class="hint">You always get the front page.</p>
  </fieldset>
);

export const SubscribeForm: FC<{ error?: string }> = ({ error }) => {
  const viewer = useViewer();
  if (viewer && viewer.status !== "pending") {
    return (
      <section class="panel" id="subscribe" aria-labelledby="subscribe-h">
        <h2 id="subscribe-h">{viewer.status === "active" ? "You get the edition by email" : "Get the edition by email"}</h2>
        <p>{viewer.status === "active" ? `Every morning at ${viewer.email}.` : "Your daily email is off."}</p>
        <div class="actions"><a class="btn" href="/account">Your account</a></div>
      </section>
    );
  }
  return (
  <section class="panel" id="subscribe" aria-labelledby="subscribe-h">
    <h2 id="subscribe-h">Get the edition by email</h2>
    <p>One email each morning, by 7 a.m. Eastern.</p>
    <form method="post" action="/subscribe">
      <label class="field" for="email">Email</label>
      <input id="email" type="email" name="email" required autocomplete="email" placeholder="you@example.com" />
      {error ? <p class="error" role="alert">{error}</p> : null}
      <TopicChips selected={[]} />
      <div class="hp" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex={-1} autocomplete="off" /></label></div>
      <div class="actions"><button class="primary" type="submit">Subscribe</button><span class="meta">Free. Unsubscribe in one click. Already have an account? <a href="/signin">Sign in</a>.</span></div>
    </form>
  </section>
  );
};
