import { normalizeUrl } from "../ingest/rss";
import { CODEX_RESPONSES_URL, GROK_API_BASE, modelFor, PROVIDER_LABEL, type AiTokens } from "./oauth";

// Ported from Ballotwise (lib/grok/research.ts): one streamed Responses request to the reader's provider,
// optionally with web search, returning the final text and every URL the model actually retrieved.

const TIMEOUT_MS = 280_000;

export class AiError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
  }
}

type StreamEvent = {
  type?: string;
  item?: { type?: string; action?: { query?: string; url?: string; sources?: { url?: string }[] } };
  annotation?: { url?: string };
  response?: { output?: { type?: string; content?: { text?: string }[] }[] };
};

async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data) as StreamEvent;
      } catch {
        // A malformed keep-alive line carries no content.
      }
    }
  }
}

type Message = { role: "system" | "user" | "assistant"; content: string };

/** The Responses request for the reader's provider. ChatGPT's backend takes the system prompt as `instructions` and typed parts. */
async function request(tokens: AiTokens, input: Message[], webSearch: boolean): Promise<[string, RequestInit]> {
  const common = {
    model: await modelFor(tokens.provider),
    reasoning: { effort: "low" },
    store: false,
    stream: true,
    ...(webSearch ? { tools: [{ type: "web_search" }] } : {}),
  };
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  if (tokens.provider === "grok") {
    return [`${GROK_API_BASE}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens.accessToken}` },
      body: JSON.stringify({ ...common, input }),
      signal,
    }];
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
    authorization: `Bearer ${tokens.accessToken}`,
    originator: "codex_cli_rs",
    "OpenAI-Beta": "responses=v1",
  };
  if (tokens.accountId) headers["chatgpt-account-id"] = tokens.accountId;
  return [CODEX_RESPONSES_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...common,
      instructions: input.filter((m) => m.role === "system").map((m) => m.content).join("\n\n"),
      input: input.filter((m) => m.role !== "system").map((m) => ({
        role: m.role,
        content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }],
      })),
    }),
    signal,
  }];
}

export async function respond(tokens: AiTokens, input: Message[], opts: { webSearch?: boolean } = {}): Promise<{ text: string; retrieved: Set<string> }> {
  const name = PROVIDER_LABEL[tokens.provider];
  let res: Response;
  try {
    res = await fetch(...(await request(tokens, input, opts.webSearch ?? false)));
  } catch {
    throw new AiError(`Could not reach ${name}. Try again.`, 502);
  }
  if (res.status === 401 || res.status === 403) throw new AiError(`${name} rejected this connection. Reconnect ${name} from your account page.`, 401);
  if (res.status === 429) throw new AiError(`Your ${name} account hit its usage limit. Try again later.`, 429);
  if (!res.ok || !res.body) {
    console.error(`${tokens.provider} responses failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
    throw new AiError(`${name} returned an error (${res.status}). Try again.`, 502);
  }

  const retrieved = new Set<string>();
  let text = "";
  try {
    for await (const ev of sseEvents(res.body)) {
      if (ev.type === "response.output_item.done" && ev.item?.type === "web_search_call") {
        const action = ev.item.action ?? {};
        for (const url of [action.url, ...(action.sources ?? []).map((s) => s.url)]) {
          const n = url ? normalizeUrl(url) : null;
          if (n) retrieved.add(n);
        }
      } else if (ev.type === "response.output_text.annotation.added" && ev.annotation?.url) {
        const n = normalizeUrl(ev.annotation.url);
        if (n) retrieved.add(n);
      } else if (ev.type === "response.completed") {
        text = (ev.response?.output ?? [])
          .filter((o) => o.type === "message")
          .flatMap((o) => o.content ?? [])
          .map((c) => c.text ?? "")
          .join("\n")
          .trim();
      } else if (ev.type === "response.failed" || ev.type === "error") {
        throw new AiError(`${name} stopped partway through. Try again.`, 502);
      }
    }
  } catch (err) {
    if (err instanceof AiError) throw err;
    throw new AiError(`${name} took too long or the connection dropped. Try again.`, 504);
  }
  if (!text) throw new AiError(`${name} returned an empty answer. Try again.`, 502);
  return { text, retrieved };
}
