import {
  authorizeUrl,
  bundledModels,
  exchangeCode,
  generatePkce,
  loadModels,
  parseCallback,
  refreshTokens,
  selectModels,
  type Tokens,
} from "@neelsatyavolu/shared-ai-auth";

// Ported from Ballotwise (lib/grok/oauth.ts). The sign-in flows are the CLIs' own, through shared-ai-auth:
// the reader approves in a new tab, then pastes back the code or address the provider shows them.
export const AI_PROVIDERS = ["grok", "codex"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const PROVIDER_LABEL: Record<AiProvider, string> = { grok: "Grok", codex: "ChatGPT" };

export type AiTokens = Tokens & { provider: AiProvider };
export const GROK_API_BASE = "https://api.x.ai/v1";
export const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";

export const isProvider = (p: unknown): p is AiProvider => AI_PROVIDERS.includes(p as AiProvider);

export function startSignIn(provider: AiProvider): { verifier: string; state: string; url: string } {
  const pkce = generatePkce();
  return { verifier: pkce.verifier, state: pkce.state, url: authorizeUrl(provider, pkce) };
}

export const readCallback = (input: string) => parseCallback(input);

export async function exchange(code: string, verifier: string, provider: AiProvider): Promise<AiTokens> {
  return { ...(await exchangeCode(provider, code, verifier)), provider };
}

export async function refresh(previous: AiTokens): Promise<AiTokens> {
  return { ...(await refreshTokens(previous.provider, previous.refreshToken, { previous })), provider: previous.provider };
}

let catalog = bundledModels;
let catalogRefreshAt = 0;

// Fast models at low effort: a briefing reads several articles, and Ballotwise measured Grok 4.6 at
// roughly half the time of 4.7 for similar research (2026-10-16).
const PREFERRED_MODEL: Record<AiProvider, string> = { grok: "grok-4.6", codex: "gpt-6.1-sol" };

/** The preferred model while the shared catalog lists it, otherwise the catalog's first model for that provider. */
export async function modelFor(provider: AiProvider): Promise<string> {
  if (Date.now() >= catalogRefreshAt) {
    catalog = await loadModels({ fallback: catalog });
    catalogRefreshAt = Date.now() + 5 * 60_000;
  }
  const models = selectModels(catalog, provider);
  return models.find((m) => m.id === PREFERRED_MODEL[provider])?.id ?? models[0]!.id;
}
