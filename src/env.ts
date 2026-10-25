import type { D1Migration } from "cloudflare:test";
import type { BriefingJob } from "./briefing";

export interface Env {
  DB: D1Database;
  AI: Ai;
  SIGNUP_LIMIT: RateLimit;
  BRIEFING_QUEUE: Queue<BriefingJob>;
  APP_URL: string;
  MAIL_FROM: string;
  // Secrets, set with `wrangler secret put`.
  RESEND_API_KEY?: string;
  ADMIN_TOKEN?: string;
  LINK_SECRET?: string;
  /** 32 random bytes, base64: seals readers' connected AI tokens. */
  AI_TOKEN_KEY?: string;
  /** Push notifications: the APNs auth key (.p8 contents), its key ID, the Apple team ID and the app's bundle ID. */
  APNS_KEY?: string;
  APNS_KEY_ID?: string;
  APPLE_TEAM_ID?: string;
  APNS_TOPIC?: string;
}

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      AI: Ai;
      SIGNUP_LIMIT: RateLimit;
      BRIEFING_QUEUE: Queue<BriefingJob>;
      APP_URL: string;
      MAIL_FROM: string;
      RESEND_API_KEY?: string;
      ADMIN_TOKEN?: string;
      LINK_SECRET?: string;
      AI_TOKEN_KEY?: string;
      APNS_KEY?: string;
      APNS_KEY_ID?: string;
      APPLE_TEAM_ID?: string;
      APNS_TOPIC?: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
