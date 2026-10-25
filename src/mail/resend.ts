export type Email = { from: string; to: string; subject: string; html: string; text: string; headers?: Record<string, string> };

const API = "https://api.resend.com";
export const BATCH_MAX = 100;

export class MailError extends Error {
  /** 429, 5xx and network failures are worth retrying; other 4xx mean the request itself is wrong. */
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

async function post(apiKey: string, path: string, body: unknown, fetcher: typeof fetch, idempotencyKey?: string): Promise<void> {
  const headers: Record<string, string> = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  let res: Response;
  try {
    res = await fetcher(`${API}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (err) {
    throw new MailError(`Resend ${path} unreachable: ${err instanceof Error ? err.message : String(err)}`, true);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new MailError(`Resend ${path} returned ${res.status}: ${detail}`, res.status === 429 || res.status >= 500);
  }
}

const shape = (e: Email) => ({ from: e.from, to: [e.to], subject: e.subject, html: e.html, text: e.text, headers: e.headers });

export function sendOne(apiKey: string, email: Email, fetcher: typeof fetch = fetch): Promise<void> {
  return post(apiKey, "/emails", shape(email), fetcher);
}

/**
 * Up to BATCH_MAX emails in one request. The idempotency key makes a retry of the same batch a no-op on
 * Resend's side (for 24 hours), so a timeout after Resend accepted it can't double-send.
 */
export function sendBatch(apiKey: string, emails: readonly Email[], idempotencyKey: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (emails.length > BATCH_MAX) throw new MailError(`batch of ${emails.length} is over ${BATCH_MAX}`, false);
  return post(apiKey, "/emails/batch", emails.map(shape), fetcher, idempotencyKey);
}
