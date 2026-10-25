import { utcDate } from "../util";
import { editionLayout } from "../layout";
import { zoneName, type EditionChoice } from "../slots";
import { REPORT_MAX, REPORT_MIN } from "../reports";
import { useContext, type Child, type FC } from "hono/jsx";
import { BALANCE, BLINDSPOT, FRESH_HOURS, SECTION_CAPS, FRONT_BY_BREADTH, MIN_OUTLETS, SECTION_MIN_OUTLETS } from "../build/select";
import { IMPORTANCE_RUBRIC } from "../build/classify";
import type { Edition, Source, Story } from "../editions";
import { longDate, shortDate } from "../format";
import { LEAN_LABEL, OUTLETS, SIDE_SIZE } from "../outlets";
import { interestName, isSubtopicId, isTopicId, sectionOf, subtopicsOf, topicName, type InterestId } from "../topics";
import { CompactStory, editionLine, HowToRead, IntroStrip, Layout, orderedSources, SourceList, StoryCard, SubscribeForm, TimeZoneContext, TopicChips, useViewer, EditionChoices } from "./components";
import { AiConnection, BriefingBlock } from "./ai";
import { STALE_MS, type BriefingRow } from "../briefing";
import type { AiProvider } from "../ai/oauth";

type Sources = Map<string, Source>;

/** `href` links the section's name to its topic page; `note` follows it unlinked (" · Following"). */
const Section: FC<{ title: string; id?: string; href?: string; note?: string; children?: Child }> = ({ title, id, href, note, children }) => (
  <section class="section" id={id} aria-label={title}>
    <div class="section-head"><h2>{href ? <a href={href}>{title}</a> : title}{note}</h2></div>
    {children}
  </section>
);

/** Stories only one side covered (with no center coverage) go after the section's main stories. */
export const EditionPage: FC<{ edition: Edition; stories: Story[]; sources: Sources; isToday: boolean }> = ({ edition, stories, sources, isToday }) => {
  // Signed-in readers see the topics they follow first.
  const layout = editionLayout(stories, useViewer()?.topics ?? []);
  const [lead, ...restFront] = layout.front;
  const blindspots = layout.blindspots;
  const byTopic = layout.topics.map((g) => ({ topic: { id: g.id, name: g.name }, followed: g.followed, list: g.stories }));

  return (
    <Layout
      title={isToday ? "Tare · Today's edition" : `Tare · ${longDate(edition.date)}`}
      nav={isToday ? "today" : "archive"}
      editionLine={editionLine(edition.date, edition.number, stories.length, isToday ? edition.builtAt : null, useContext(TimeZoneContext))}
    >
      <IntroStrip />
      <nav class="jump" aria-label="Sections">
        {lead ? <a href="#front">Front page</a> : null}
        {blindspots.length > 0 ? <a href="#blindspots">Blindspots</a> : null}
        {byTopic.map((g) => <a href={`#${g.topic.id}`}>{g.topic.name}</a>)}
      </nav>
      {lead ? (
        <Section title="Front page" id="front">
          <StoryCard story={lead} sources={sources} lead />
          <div class="compact-grid">{restFront.map((s) => <CompactStory story={s} sources={sources} />)}</div>
        </Section>
      ) : null}
      {/* After the front page, so the news comes first; readers who want the key are one tap away. */}
      <HowToRead />
      {blindspots.length > 0 ? (
        <Section title="Blindspots" id="blindspots">
          <div class="compact-grid">{blindspots.map((s) => <CompactStory story={s} sources={sources} />)}</div>
        </Section>
      ) : null}
      {byTopic.map((g) => (
        <Section title={g.topic.name} id={g.topic.id} href={`/topic/${g.topic.id}`} note={g.followed ? " · Following" : undefined}>
          <div class="compact-grid">{g.list.map((s) => <CompactStory story={s} sources={sources} />)}</div>
        </Section>
      ))}
      <p class="end">That's the edition.</p>
      <SubscribeForm />
    </Layout>
  );
};

/**
 * One section's or subtopic's stories in today's edition. A section page links to its subtopics; a subtopic
 * page links back to its section.
 */
export const TopicPage: FC<{ id: InterestId; edition: Edition | null; stories: Story[]; sources: Sources }> = ({ id, edition, stories, sources }) => {
  const name = interestName(id) ?? id;
  const parent = isSubtopicId(id) ? sectionOf(id) : null;
  const subs = isTopicId(id) ? subtopicsOf(id) : [];
  return (
    <Layout title={`${name} · Tare`} editionLine={edition ? editionLine(edition.date, edition.number, stories.length) : undefined}>
      <p class="meta"><a href="/">← Today's edition</a>{parent ? <> · <a href={`/topic/${parent}`}>{topicName(parent)}</a></> : null}</p>
      {subs.length > 0 ? (
        <nav class="jump" aria-label={`Narrower topics in ${name}`}>{subs.map((s) => <a href={`/topic/${s.id}`}>{s.name}</a>)}</nav>
      ) : null}
      <Section title={name}>
        {stories.length > 0 ? (
          <div class="compact-grid">{stories.map((s) => <CompactStory story={s} sources={sources} />)}</div>
        ) : (
          <p class="meta">No {name} stories in today's edition yet. The edition updates every hour.</p>
        )}
      </Section>
    </Layout>
  );
};

export const EmptyPage: FC = () => (
  <Layout title="Tare" nav="today">
    <div class="prose">
      <h1>The first edition is on the press.</h1>
      <p>Tare reads headlines from {OUTLETS.length} outlets across the spectrum and updates every hour, with a morning and an evening edition by email. Check back soon, or get it by email.</p>
    </div>
    <SubscribeForm />
  </Layout>
);

export const StoryPage: FC<{ story: Story; sources: Sources; edition: Edition; briefing: BriefingRow | null; connected: AiProvider | null; reported?: boolean }> = ({ story, sources, edition, briefing, connected, reported = false }) => {
  const writing = briefing?.status === "writing" && Date.now() - briefing.requestedAt < STALE_MS;
  return (
    <Layout
      title={`${story.headline} · Tare`}
      description={story.summary.map((s) => s.text).join(" ")}
      editionLine={editionLine(edition.date, edition.number, 1).replace(/ · 1 story$/, "")}
      refreshSeconds={writing ? 5 : undefined}
    >
      <div class="article">
        <p class="meta"><a href={`/e/${edition.date}`}>← {shortDate(edition.date)} edition</a></p>
        <StoryCard story={story} sources={sources} page />
        {story.correction ? (
          <p class="correction"><span class="why-label">Correction, {shortDate(utcDate(story.correction.at))}</span> {story.correction.note}</p>
        ) : null}
        <BriefingBlock storyId={story.id} briefing={briefing} connected={connected} numbers={orderedSources(story, sources).length} />
        <SourceList story={story} sources={sources} />
        <ReportError storyId={story.id} reported={reported} />
      </div>
    </Layout>
  );
};

export const ArchivePage: FC<{ editions: (Edition & { stories: number })[] }> = ({ editions }) => (
  <Layout title="Archive · Tare" nav="archive">
    <div class="prose">
      <h1>Archive</h1>
      {editions.length === 0 ? <p>No editions yet.</p> : (
        <ul class="archive">
          {editions.map((e) => (
            <li><a href={`/e/${e.date}`}>{longDate(e.date)}</a><span class="meta">No. {e.number} · {e.stories} stories</span></li>
          ))}
        </ul>
      )}
    </div>
  </Layout>
);

const fmt = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(2);

export const MethodPage: FC = () => (
  <Layout title="Method · Tare" nav="method">
    <div class="prose">
      <h1>How Tare works</h1>
      <p>Tare is named after the button on a scale that zeroes it, so you weigh only what's inside. It doesn't claim to be free of bias. It tries to show its work, so you can check every call it makes.</p>

      <h2>What goes in</h2>
      <p>Every hour Tare reads the public RSS feeds of the {OUTLETS.length} outlets below. It keeps each headline, the short description the outlet puts in its feed, and the link. It never copies article text, and every story links back to the outlets that reported it.</p>

      <h2>How a story makes the edition</h2>
      <p>Every hour Tare groups the last 24 hours of headlines by event, using text embeddings to spot headlines about the same thing, and sorts each group into a section. It does this every hour, so breaking stories appear within the hour, and it applies the same fixed rules every time. There's no algorithm tuned to you: nothing is ranked by clicks, shares or what you've read.</p>
      <ol>
        <li>The <b>front page</b> is the {BALANCE.front} most important stories that outlets on both the left and the right reported. Each story's score is its importance on the scale below plus a small bonus for how many outlets covered it, capped at 1.5, so wide coverage breaks ties but can't lift a minor story past a more important one. Important stories (4 or 5 on the scale) also get a bonus for being new, which fades over {FRESH_HOURS} hours, so the newest important news leads. A story that {FRONT_BY_BREADTH} or more outlets covered also gets a front slot, unless it is rated minor. Everyone gets the front page, whatever topics they choose.</li>
        <li>Every <b>section</b> (world, U.S., politics, business, technology, artificial intelligence, science, climate, culture and sports) gets up to {SECTION_CAPS.world} of its most widely covered stories ({SECTION_CAPS.science} to {SECTION_CAPS.business} in the quieter sections: business, science, climate and culture) with at least {MIN_OUTLETS} outlets, listed most important first (same score as the front page). A section short of that fills up with stories {SECTION_MIN_OUTLETS} outlets covered, after the wider ones, so every section has something to read and one busy topic can't crowd out the rest. One subtopic, such as Formula 1 in sports, takes at most half of a section while other stories are waiting.</li>
        <li>A <b>blindspot</b> is a story at least {BLINDSPOT.minCount} outlets and {Math.round(BLINDSPOT.minShare * 100)}% of one side covered while at most {BLINDSPOT.maxOther} outlet on the other side did, with at least {BLINDSPOT.minTotal} outlets in all. Before calling it one, Tare checks every headline the other side published that day for a looser match; if it finds one, it isn't a blindspot. Up to {BALANCE.blindspots} make each edition.</li>
      </ol>
      <p>The same model that sorts stories into sections also tags a narrower topic when one clearly fits, such as Formula 1 in sports or AI policy in artificial intelligence. Each section and narrower topic has its own page listing today's stories.</p>
      <p>Picking topics in your account only changes the order: your sections come first, and your email includes stories from the sections and narrower topics you chose. You still see everything else.</p>

      <h2>Corrections</h2>
      <p>Every story page has a "Report an error" form. Reports go to the editor, not to the public page. A story found to be wrong is rewritten from its sources or taken off the edition, and its page keeps a dated note saying what was corrected.</p>
      <h2>How importance is judged</h2>
      <p>Counting outlets measures attention, not consequence: a widely shared joke shouldn't outrank a fight over an election. So each story is also rated on this scale, by the same AI model, with the same instructions every time. Front-page stories and blindspots must be a 3 or higher.</p>
      <table>
        <thead><tr><th>Rating</th><th>Meaning</th></tr></thead>
        <tbody>{IMPORTANCE_RUBRIC.map((r) => <tr><td class="mono">{r.level}</td><td>{r.meaning}</td></tr>)}</tbody>
      </table>

      <h2>The scale</h2>
      <p>Each story shows what share of each side's outlets covered it. The needle uses shares, not raw counts, so a side can't tip the scale just by having more outlets on the list. Right now Tare reads {SIDE_SIZE.left} left-leaning, {SIDE_SIZE.center} center and {SIDE_SIZE.right} right-leaning outlets, plus {OUTLETS.length - SIDE_SIZE.left - SIDE_SIZE.center - SIDE_SIZE.right} not rated.</p>

      <h2>The writing</h2>
      <p>An AI model (Z.ai's open-weight GLM 5.3, running on Cloudflare) writes each headline, summary and "where accounts differ" note from the headlines and descriptions alone. A second pass checks every sentence against the sources it cites, and a final read checks the whole story for contradictions before it replaces a published version. It's told to use neutral wording, attribute claims, and never decide which outlet is right. Every sentence has to name the sources it relies on; Tare drops any sentence that cites nothing or cites a source that isn't in the group. The numbers after each sentence link to those sources.</p>
      <p>Then a second, separate check reads every sentence next to the headlines it cites and removes any sentence with a name, place, number, date or title those sources don't state. If nothing survives, the story waits for the next hour instead of going up unchecked.</p>
      <p>AI can still get things wrong, especially from short descriptions. Read the sources before you rely on a detail.</p>

      <h2>Photos</h2>
      <p>Each story shows a photo the outlet itself put in its feed, with a credit and a link back to the outlet. A photo can frame a story as much as a headline, so Tare picks one from a center outlet when it can, and otherwise from the side that covered the story less. Photos load from the outlets' servers; Tare tells them nothing about which page you were on. Tare never generates images.</p>

      <h2>Where the left, center and right labels come from</h2>
      <p>
        Not from Tare. Each outlet's lean comes from a published, peer-reviewed measure of its audience: Eady, Bonneau, Tucker and Nagler (2025),
        "News Sharing and Partisanship on Social Media," <i>Political Analysis</i>. They scored 184 U.S. news sites by who shares their links,
        on a scale where 0 is neutral and 1.24 is the distance between the typical Democratic and the typical Republican member of Congress.
        Their data is public domain (CC0), so anyone can check it.
      </p>
      <p>
        Tare draws the lines at half that distance and the full distance from 0: under −1.24 is <b>left</b>, −1.24 to −0.62 <b>leans left</b>,
        −0.62 to 0.62 <b>center</b>, 0.62 to 1.24 <b>leans right</b>, and over 1.24 <b>right</b>. It measures audiences, not articles: an outlet
        read mostly by one side lands on that side even if its reporting is straight. Outlets the study didn't cover are <b>not rated</b>: international
        ones like the BBC, and specialist tech, science and motorsport outlets like The Verge, Science or Autosport. Their coverage counts,
        but never toward the left or the right, so many technology, AI and Formula 1 stories show few rated outlets.
      </p>
      <table>
        <thead><tr><th>Outlet</th><th>Label</th><th>Score (90% range)</th></tr></thead>
        <tbody>
          {OUTLETS.map((o) => (
            <tr>
              <td>{o.name}</td>
              <td>{LEAN_LABEL[o.lean]}</td>
              <td class="mono">{o.zeta == null ? "—" : `${fmt(o.zeta)} (${fmt(o.zetaLow!)} to ${fmt(o.zetaHigh!)})`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="meta">AP, Reuters, CNN and The Washington Post don't offer working public feeds, so they aren't read.</p>

      <h2>Open source</h2>
      <p>All of Tare's code, the outlet list, the labels and the exact instructions given to the AI are public under the MIT license on <a href="https://github.com/neelsatyavolu/tare">GitHub</a>. If you think a label or a rule is wrong, open an issue.</p>

      <h2>Email</h2>
      <p>Your account is just your email address: there are no passwords, and you sign in with a link we email you. The address is used only to sign you in and send the edition. Tare has no ads and no tracking pixels. Every email has a one-click unsubscribe, and you can delete your account from the account page.</p>
    </div>
  </Layout>
);

export const MessagePage: FC<{ title: string; children?: Child }> = ({ title, children }) => (
  <Layout title={`${title} · Tare`}>
    <div class="prose"><h1>{title}</h1>{children}</div>
  </Layout>
);

export const ManagePage: FC<{ token: string; email: string; topics: InterestId[]; editions: EditionChoice; status: string; saved?: boolean }> = ({ token, email, topics, editions, status, saved }) => (
  <Layout title="Your subscription · Tare">
    <div class="prose">
      <h1>Your subscription</h1>
      <p>{email} · {status === "active" ? "getting Tare by email" : status === "pending" ? "not confirmed yet" : "unsubscribed"}</p>
      {saved ? <p class="meta" role="status">Saved. Your next email will use these settings.</p> : null}
      <form method="post" action={`/manage/${token}`}>
        <EditionChoices selected={editions} />
        <TopicChips selected={topics} />
        <div class="actions"><button class="primary" type="submit">Save</button></div>
      </form>
      {status !== "unsubscribed" ? (
        <form method="post" action={`/unsubscribe/${token}`} style="margin-top:36px">
          <p>Stop getting the edition:</p>
          <button type="submit">Unsubscribe</button>
        </form>
      ) : null}
      <p class="meta" style="margin-top:28px">Topics you follow: {topics.length ? topics.map((t) => interestName(t) ?? t).join(", ") : "front page only"}.</p>
    </div>
  </Layout>
);

export const UnsubscribeConfirmPage: FC<{ token: string }> = ({ token }) => (
  <MessagePage title="Unsubscribe from Tare?">
    <p>You'll stop getting Tare by email. You can sign up again any time.</p>
    <form method="post" action={`/unsubscribe/${token}`}>
      <div class="actions"><button class="primary" type="submit">Unsubscribe</button><a class="btn" href={`/manage/${token}`}>Change topics instead</a></div>
    </form>
  </MessagePage>
);

export const SignInPage: FC<{ error?: string }> = ({ error }) => (
  <Layout title="Sign in · Tare" nav="account">
    <div class="prose">
      <h1>Sign in</h1>
      <p>Enter your email and we'll send you a link to sign in. No password needed. New here? This creates your account.</p>
      <form method="post" action="/signin">
        <label class="field" for="email">Email</label>
        <input id="email" type="email" name="email" required autocomplete="email" placeholder="you@example.com" />
        {error ? <p class="error" role="alert">{error}</p> : null}
        <div class="hp" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex={-1} autocomplete="off" /></label></div>
        <div class="actions"><button class="primary" type="submit">Email me a sign-in link</button></div>
      </form>
    </div>
  </Layout>
);

export const AccountPage: FC<{ saved?: string; aiProvider: AiProvider | null }> = ({ saved, aiProvider }) => {
  const viewer = useViewer()!;
  const emailOn = viewer.status === "active";
  return (
    <Layout title="Your account · Tare" nav="account">
      <div class="prose">
        <h1>Your account</h1>
        <p>Signed in as <b>{viewer.email}</b>.</p>
        {saved ? <p class="notice" role="status">{saved}</p> : null}

        <h2>Topics</h2>
        <p>These come first in the edition, on the site and in your email.</p>
        <form method="post" action="/account/topics">
          <TopicChips selected={viewer.topics} />
          <div class="actions"><button class="primary" type="submit">Save topics</button></div>
        </form>

        <h2>Email</h2>
        {emailOn ? (
          <form method="post" action="/account/editions">
            <EditionChoices selected={viewer.editions} />
            <div class="actions"><button class="primary" type="submit">Save</button></div>
          </form>
        ) : null}
        <form method="post" action="/account/email">
          <p>{emailOn ? `On. The morning edition arrives by 7 a.m., the evening edition by 6 p.m., ${zoneName(useContext(TimeZoneContext))} time.` : "Off. You can still read every edition here."}</p>
          <input type="hidden" name="on" value={emailOn ? "0" : "1"} />
          <div class="actions"><button type="submit">{emailOn ? "Turn off email" : "Turn on email"}</button></div>
        </form>

        <div id="ai"><AiConnection provider={aiProvider} /></div>

        <h2>Sign out</h2>
        <form method="post" action="/signout">
          <div class="actions"><button type="submit">Sign out</button></div>
        </form>

        <details class="danger">
          <summary>Delete account</summary>
          <form method="post" action="/account/delete">
            <p>This removes your email address and topics from Tare for good.</p>
            <div class="actions"><button class="danger" type="submit">Delete my account</button></div>
          </form>
        </details>
      </div>
    </Layout>
  );
};

/** A plain form, no JavaScript: a note that this story got something wrong, kept for the editor. */
const ReportError: FC<{ storyId: string; reported: boolean }> = ({ storyId, reported }) => (
  <details class="report" id="report" open={reported}>
    <summary>Report an error</summary>
    {reported ? (
      <p>Thanks. The editor will read it.</p>
    ) : (
      <form method="post" action={`/s/${storyId}/report`}>
        <label for="report-body">What looks wrong? A short description is enough; a quote or link helps but isn't needed.</label>
        <textarea id="report-body" name="body" required minlength={REPORT_MIN} maxlength={REPORT_MAX} rows={4} />
        <div class="hp" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex={-1} autocomplete="off" /></label></div>
        <button type="submit">Send report</button>
      </form>
    )}
  </details>
);
