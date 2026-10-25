import { useContext, type Child, type FC } from "hono/jsx";
import { zoneName } from "../slots";
import { EditionChoices, HOW_TO_READ, Layout, TimeZoneContext, TopicChips, useViewer } from "./components";

/**
 * Three short steps for a reader who just confirmed their email or signed in for the first time: topics, email,
 * then how to read the edition. Plain forms, no JavaScript; every step can be skipped and changed later on the
 * account page.
 */
const Step: FC<{ n: 1 | 2 | 3; name: string; title: string; children?: Child }> = ({ n, name, title, children }) => (
  <Layout title={`${title} · Tare`} nav="account">
    <div class="prose welcome">
      <p class="kicker">Step {n} of 3 · {name}</p>
      <h1>{title}</h1>
      {children}
    </div>
  </Layout>
);

export const WelcomeTopics: FC = () => {
  const viewer = useViewer()!;
  const zone = zoneName(useContext(TimeZoneContext));
  return (
    <Step n={1} name="Topics" title="Welcome to Tare">
      <p class="notice" role="status">
        {viewer.status === "active"
          ? `You're subscribed. The morning edition arrives by 7 a.m. and the evening edition by 6 p.m., ${zone} time.`
          : `You're signed in as ${viewer.email}.`}
      </p>
      <p>Everyone gets the same front page. Pick the sections you care about and they come first, on the site and in your email. You'll still see everything else.</p>
      <form method="post" action="/welcome/topics">
        <TopicChips selected={viewer.topics} />
        <div class="actions"><button class="primary" type="submit">Continue</button><a class="btn" href="/welcome/email">Skip</a></div>
      </form>
    </Step>
  );
};

export const WelcomeEmail: FC = () => {
  const viewer = useViewer()!;
  const emailOn = viewer.status === "active";
  return (
    <Step n={2} name="Email" title={emailOn ? "Which editions?" : "Get the edition by email?"}>
      <p>{emailOn ? "Choose the morning edition, the evening edition, or both." : "A morning and an evening edition, with the front page and your topics. One click to unsubscribe from any email."}</p>
      <form method="post" action="/welcome/email">
        <EditionChoices selected={viewer.editions} />
        <div class="actions">
          {emailOn ? (
            <button class="primary" type="submit">Continue</button>
          ) : (
            <>
              <button class="primary" type="submit" name="on" value="1">Email me the edition</button>
              <button type="submit" name="on" value="0">Not now</button>
            </>
          )}
        </div>
      </form>
    </Step>
  );
};

export const WelcomeDone: FC = () => (
  <Step n={3} name="Reading" title="How to read Tare">
    <p>Each story shows who covered it, where that coverage sits from left to right, and where their accounts differ.</p>
    <dl class="welcome-points">
      {HOW_TO_READ.map((p) => (
        <>
          <dt>{p.title}</dt>
          <dd>{p.text}</dd>
        </>
      ))}
    </dl>
    <p>Want more on a story? Connect your own Grok or ChatGPT account and ask for a detailed briefing, written from the full articles. It's optional and costs Tare nothing.</p>
    <div class="actions">
      <a class="btn primary" href="/">Read today's edition</a>
      <a class="btn" href="/account#ai">Connect Grok or ChatGPT</a>
    </div>
    <p class="meta" style="margin-top:28px">Change your topics and emails any time on <a href="/account">your account page</a>. <a href="/method">How Tare works</a>.</p>
  </Step>
);
