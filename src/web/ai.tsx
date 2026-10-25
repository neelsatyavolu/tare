import type { FC } from "hono/jsx";
import { PROVIDER_LABEL, type AiProvider } from "../ai/oauth";
import { STALE_MS, type BriefingRow } from "../briefing";
import { useViewer } from "./components";

/** Account-page block for connecting a ChatGPT or Grok account (used only for detailed briefings). */
export const AiConnection: FC<{ provider: AiProvider | null }> = ({ provider }) => (
  <>
    <h2>Detailed briefings</h2>
    {provider ? (
      <form method="post" action="/account/ai/disconnect">
        <p>Connected: <b>{PROVIDER_LABEL[provider]}</b>. When you ask for a detailed briefing on a story, Tare uses your {PROVIDER_LABEL[provider]} account to read the full articles and write it. Once written, it's shown to every reader.</p>
        <div class="actions"><button type="submit">Disconnect {PROVIDER_LABEL[provider]}</button></div>
      </form>
    ) : (
      <form method="post" action="/account/ai/start">
        <p>Connect your own Grok or ChatGPT account to ask for a detailed briefing on any story: a longer, cited write-up made from the full articles. It uses your subscription, not a Tare one.</p>
        <fieldset>
          <legend>Account to connect</legend>
          <div class="chips">
            <label class="chip"><input type="radio" name="provider" value="grok" checked /><span>Grok</span></label>
            <label class="chip"><input type="radio" name="provider" value="codex" /><span>ChatGPT</span></label>
          </div>
        </fieldset>
        <div class="actions"><button class="primary" type="submit">Connect</button></div>
      </form>
    )}
  </>
);

/** Step two of connecting: open the provider's sign-in in a new tab, then paste back what it shows. */
export const AiPaste: FC<{ provider: AiProvider; authorizeUrl: string; error?: string }> = ({ provider, authorizeUrl, error }) => {
  const name = PROVIDER_LABEL[provider];
  return (
    <div class="prose">
      <h1>Connect {name}</h1>
      <ol>
        <li><a href={authorizeUrl} target="_blank" rel="noopener noreferrer">Open the {name} sign-in</a> (it opens in a new tab) and approve.</li>
        <li>
          {provider === "grok"
            ? "Grok then shows you a code. Copy it."
            : "ChatGPT then sends you to a page that won't load. That's expected: copy that page's full address from the address bar."}
        </li>
        <li>Paste it here.</li>
      </ol>
      <form method="post" action="/account/ai/complete">
        <label class="field" for="callback">Code or address</label>
        <input id="callback" class="text" type="text" name="callback" required autocomplete="off" spellcheck={false} />
        {error ? <p class="error" role="alert">{error}</p> : null}
        <div class="actions"><button class="primary" type="submit">Finish connecting</button><a class="btn" href="/account">Cancel</a></div>
      </form>
    </div>
  );
};

/** The briefing on a story page, or how to get one. */
export const BriefingBlock: FC<{ storyId: string; briefing: BriefingRow | null; connected: AiProvider | null; numbers: number }> = ({ storyId, briefing, connected, numbers }) => {
  const viewer = useViewer();
  const writing = briefing?.status === "writing" && Date.now() - briefing.requestedAt < STALE_MS;
  return (
    <section class="briefing" id="briefing" aria-labelledby="briefing-h">
      <div class="section-head"><h2 id="briefing-h">Detailed briefing</h2></div>
      {briefing?.status === "ready" && briefing.body ? (
        <>
          {briefing.body.sections.map((sec) => (
            <>
              <h3>{sec.heading}</h3>
              {sec.paragraphs.map((p) => (
                <p>
                  {p.text}
                  <sup class="cites">
                    {"⁠["}
                    {p.cites.filter((n) => n <= numbers).map((n, i) => <>{i > 0 ? ", " : null}<a href={`#src-${n}`} aria-label={`Source ${n}`}>{n}</a></>)}
                    {p.web.map((id, i) => <>{i > 0 || p.cites.length ? ", " : null}<a href={`#web-${id}`} aria-label={`Web source ${id}`}>{id}</a></>)}
                    ]
                  </sup>
                </p>
              ))}
            </>
          ))}
          {briefing.body.web.length > 0 ? (
            <>
              <h4>Also read for this briefing</h4>
              <ol class="web-sources">
                {briefing.body.web.map((w) => <li id={`web-${w.id}`}><span class="n">{w.id}</span> <a href={w.url} rel="noopener noreferrer nofollow" target="_blank">{w.title}</a></li>)}
              </ol>
            </>
          ) : null}
          <p class="meta">Written by {briefing.provider === "codex" ? "ChatGPT" : "Grok"} from the full articles, at a reader's request. AI can get details wrong; check the sources.</p>
        </>
      ) : writing ? (
        <p class="notice" role="status">Writing the briefing from the full articles. This takes a minute or two; the page refreshes on its own.</p>
      ) : (
        <>
          {briefing?.status === "failed" ? <p class="error">The last try didn't work: {briefing.error}</p> : null}
          <p>A longer write-up made from the full articles: what happened, the background, how coverage differs and what's still unclear, with every paragraph sourced.</p>
          {viewer && connected ? (
            <form method="post" action={`/s/${storyId}/briefing`}>
              <div class="actions"><button class="primary" type="submit">Write the briefing</button><span class="meta">Uses your {connected === "codex" ? "ChatGPT" : "Grok"} account. About a minute.</span></div>
            </form>
          ) : viewer ? (
            <div class="actions"><a class="btn" href="/account#ai">Connect Grok or ChatGPT to ask for one</a></div>
          ) : (
            <div class="actions"><a class="btn" href="/signin">Sign in to ask for one</a><span class="meta">Free. You'll connect your own Grok or ChatGPT.</span></div>
          )}
        </>
      )}
    </section>
  );
};
