import type { Child, FC } from "hono/jsx";
import { BALANCE, BLINDSPOT, MIN_OUTLETS, SECTION_MIN_OUTLETS } from "../build/select";
import { IMPORTANCE_RUBRIC } from "../build/classify";
import type { Edition, Source, Story } from "../editions";
import { longDate, shortDate } from "../format";
import { LEAN_LABEL, OUTLETS, SIDE_SIZE } from "../outlets";
import { TOPICS, topicName, type TopicId } from "../topics";
import { CompactStory, editionLine, HowToRead, IntroStrip, Layout, orderedSources, SourceList, StoryCard, SubscribeForm, TopicChips, useViewer } from "./components";
import { AiConnection, BriefingBlock } from "./ai";
import { STALE_MS, type BriefingRow } from "../briefing";
import type { AiProvider } from "../ai/oauth";

type Sources = Map<string, Source>;

const Section: FC<{ title: string; id?: string; children?: Child }> = ({ title, id, children }) => (
  <section class="section" id={id} aria-label={title}>
    <div class="section-head"><h2>{title}</h2></div>
    {children}
  </section>
);

export const EditionPage: FC<{ edition: Edition; stories: Story[]; sources: Sources; isToday: boolean }> = ({ edition, stories, sources, isToday }) => {
  const front = stories.filter((s) => s.front);
  const [lead, ...restFront] = front;
  const blindspots = stories.filter((s) => !s.front && s.blindspot);
  const following = new Set<string>(useViewer()?.topics ?? []);
  // Signed-in readers see the topics they follow first.
  const byTopic = TOPICS.map((t) => ({ topic: t, followed: following.has(t.id), list: stories.filter((s) => !s.front && !s.blindspot && s.topic === t.id) }))
    .filter((g) => g.list.length > 0)
    .sort((a, b) => Number(b.followed) - Number(a.followed));

  return (
    <Layout
      title={isToday ? "Tare · Today's edition" : `Tare · ${longDate(edition.date)}`}
      nav={isToday ? "today" : "archive"}
      editionLine={editionLine(edition.date, edition.number, stories.length, isToday ? edition.builtAt : null)}
    >
      <IntroStrip />
      <nav class="jump" aria-label="Sections">
        {lead ? <a href="#front">Front page</a> : null}
        {blindspots.length > 0 ? <a href="#blindspots">Blindspots</a> : null}
        {byTopic.map((g) => <a href={`#${g.topic.id}`}>{g.topic.name}</a>)}
      </nav>
      <HowToRead />
      {lead ? (
        <Section title="Front page" id="front">
          <StoryCard story={lead} sources={sources} lead />
          <div class="compact-grid">{restFront.map((s) => <CompactStory story={s} sources={sources} />)}</div>
        </Section>
      ) : null}
      {blindspots.length > 0 ? (
        <Section title="Blindspots" id="blindspots">
          <div class="compact-grid">{blindspots.map((s) => <CompactStory story={s} sources={sources} />)}</div>
        </Section>
      ) : null}
      {byTopic.map((g) => (
        <Section title={g.followed ? `${g.topic.name} · Following` : g.topic.name} id={g.topic.id}>
          <div class="compact-grid">{g.list.map((s) => <CompactStory story={s} sources={sources} />)}</div>
        </Section>
      ))}
      <p class="end">That's the edition.</p>
      <SubscribeForm />
    </Layout>
  );
};

export const EmptyPage: FC = () => (
  <Layout title="Tare" nav="today">
    <div class="prose">
      <h1>The first edition is on the press.</h1>
      <p>Tare reads headlines from {OUTLETS.length} outlets across the spectrum and publishes one edition each morning. Check back tomorrow morning, or get it by email.</p>
    </div>
    <SubscribeForm />
  </Layout>
);

export const StoryPage: FC<{ story: Story; sources: Sources; edition: Edition; briefing: BriefingRow | null; connected: AiProvider | null }> = ({ story, sources, edition, briefing, connected }) => {
  const writing = briefing?.status === "writing" && Date.now() - briefing.requestedAt < STALE_MS;
  return (
    <Layout
      title={`${story.headline} · Tare`}
      description={story.summary.map((s) => s.text).join(" ")}
      editionLine={editionLine(edition.date, edition.number, 1).replace(/ · 1 story$/, "")}
      refreshSeconds={writing ? 10 : undefined}
    >
      <div class="article">
        <p class="meta"><a href={`/e/${edition.date}`}>← {shortDate(edition.date)} edition</a></p>
        <StoryCard story={story} sources={sources} page />
        <BriefingBlock storyId={story.id} briefing={briefing} connected={connected} numbers={orderedSources(story, sources).length} />
        <SourceList story={story} sources={sources} />
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
        <li>The <b>front page</b> is the {BALANCE.front} most important stories that outlets on both the left and the right reported, using the importance scale below, with the most widely covered first when two are equally important. Everyone gets it, whatever topics they choose.</li>
        <li>Every <b>section</b> (world, U.S., politics, business, technology, science, climate, culture and sports) gets up to {BALANCE.perSection} of its most widely covered stories with at least {MIN_OUTLETS} outlets. A quiet section still gets its single best story if {SECTION_MIN_OUTLETS} outlets covered it, so one busy topic can't crowd out the rest.</li>
        <li>A <b>blindspot</b> is a story at least {BLINDSPOT.minCount} outlets and {Math.round(BLINDSPOT.minShare * 100)}% of one side covered while at most {BLINDSPOT.maxOther} outlet on the other side did, with at least {BLINDSPOT.minTotal} outlets in all. Before calling it one, Tare checks every headline the other side published that day for a looser match; if it finds one, it isn't a blindspot. Up to {BALANCE.blindspots} make each edition.</li>
      </ol>
      <p>Picking topics in your account only changes the order: your sections come first. You still see everything else.</p>

      <h2>How importance is judged</h2>
      <p>Counting outlets measures attention, not consequence: a widely shared joke shouldn't outrank a fight over an election. So each story is also rated on this scale, by the same AI model, with the same instructions every time. Front-page stories and blindspots must be a 3 or higher.</p>
      <table>
        <thead><tr><th>Rating</th><th>Meaning</th></tr></thead>
        <tbody>{IMPORTANCE_RUBRIC.map((r) => <tr><td class="mono">{r.level}</td><td>{r.meaning}</td></tr>)}</tbody>
      </table>

      <h2>The scale</h2>
      <p>Each story shows what share of each side's outlets covered it. The needle uses shares, not raw counts, so a side can't tip the scale just by having more outlets on the list. Right now Tare reads {SIDE_SIZE.left} left-leaning, {SIDE_SIZE.center} center and {SIDE_SIZE.right} right-leaning outlets, plus {OUTLETS.length - SIDE_SIZE.left - SIDE_SIZE.center - SIDE_SIZE.right} not rated.</p>

      <h2>The writing</h2>
      <p>An AI model (OpenAI's open-weight gpt-oss-120b, running on Cloudflare) writes each headline, summary and "where accounts differ" note from the headlines and descriptions alone. It's told to use neutral wording, attribute claims, and never decide which outlet is right. Every sentence has to name the sources it relies on; Tare drops any sentence that cites nothing or cites a source that isn't in the group. The numbers after each sentence link to those sources.</p>
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
        read mostly by one side lands on that side even if its reporting is straight. Outlets the study didn't cover (mostly international ones,
        like the BBC) are <b>not rated</b>: their coverage counts, but never toward the left or the right.
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

export const ManagePage: FC<{ token: string; email: string; topics: TopicId[]; status: string; saved?: boolean }> = ({ token, email, topics, status, saved }) => (
  <Layout title="Your subscription · Tare">
    <div class="prose">
      <h1>Your subscription</h1>
      <p>{email} · {status === "active" ? "getting the daily edition" : status === "pending" ? "not confirmed yet" : "unsubscribed"}</p>
      {saved ? <p class="meta" role="status">Saved. Tomorrow's edition will use these topics.</p> : null}
      <form method="post" action={`/manage/${token}`}>
        <TopicChips selected={topics} />
        <div class="actions"><button class="primary" type="submit">Save topics</button></div>
      </form>
      {status !== "unsubscribed" ? (
        <form method="post" action={`/unsubscribe/${token}`} style="margin-top:36px">
          <p>Stop getting the edition:</p>
          <button type="submit">Unsubscribe</button>
        </form>
      ) : null}
      <p class="meta" style="margin-top:28px">Topics you follow: {topics.length ? topics.map(topicName).join(", ") : "front page only"}.</p>
    </div>
  </Layout>
);

export const UnsubscribeConfirmPage: FC<{ token: string }> = ({ token }) => (
  <MessagePage title="Unsubscribe from Tare?">
    <p>You'll stop getting the daily edition. You can sign up again any time.</p>
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

        <h2>Daily email</h2>
        <form method="post" action="/account/email">
          <p>{emailOn ? "On. The edition arrives each morning by 7 a.m. Eastern." : "Off. You can still read every edition here."}</p>
          <input type="hidden" name="on" value={emailOn ? "0" : "1"} />
          <div class="actions"><button type="submit">{emailOn ? "Turn off the daily email" : "Turn on the daily email"}</button></div>
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
