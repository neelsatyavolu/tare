import type { D1Migration } from "cloudflare:test";

export interface Env {
  DB: D1Database;
  AI: Ai;
  SIGNUP_LIMIT: RateLimit;
  APP_URL: string;
  MAIL_FROM: string;
  // Secrets, set with `wrangler secret put`.
  RESEND_API_KEY?: string;
  ADMIN_TOKEN?: string;
  LINK_SECRET?: string;
}

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      AI: Ai;
      SIGNUP_LIMIT: RateLimit;
      APP_URL: string;
      MAIL_FROM: string;
      RESEND_API_KEY?: string;
      ADMIN_TOKEN?: string;
      LINK_SECRET?: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
