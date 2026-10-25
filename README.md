# Tare

An independent news edition that shows how outlets across the political spectrum covered each story. Every hour Tare reads the RSS feeds of 117 outlets, groups the last 24 hours of headlines by event, and publishes the stories that matter by fixed, published rules: the front page (most widely covered by both the left and the right), every section (world, U.S., politics, business, tech, science, climate, culture, sports) and blindspots (stories one side covered and the other skipped). Each story gets a neutral, source-cited summary, a coverage scale and "where accounts differ". Readers can get a daily email with the front page plus the topics they follow.

Live at https://tare.news.

## How lean is decided

Not by Tare. Each outlet's left/center/right label comes from Eady, Bonneau, Tucker & Nagler (2025), "News Sharing and Partisanship on Social Media", *Political Analysis*, a published audience-lean score for 184 U.S. news sites (CC0, `data/eady2025/`). The score is scaled so 0 is neutral and 1.24 is the gap between the median Democratic and median Republican member of the 116th Congress; Tare buckets at ±0.62 and ±1.24. Outlets outside that data (mostly international) are "not rated": their coverage counts, but never toward left or right. Research notes: `docs/research/bias-datasets.md`.

## How it works

| Step | When (UTC) | Code |
|---|---|---|
| Pull every feed: headline, feed description, link and photo (never article text) | hourly at :07 | `src/ingest/` |
| Embed new headlines once (`@cf/baai/bge-base-en-v1.5`), group by event, sort groups into sections | hourly | `src/build/embed.ts`, `cluster.ts`, `classify.ts` |
| Pick stories by rule; keep continuing stories (same id and link), write up new ones (`@cf/zai-org/glm-5.3`; sorting uses `@cf/openai/gpt-oss-120b`), check each claim and then the whole story, drop uncited sentences, double-check blindspots | hourly | `src/build/select.ts`, `build.ts`, `summarize.ts`, `match.ts` |
| Email confirmed subscribers | 11:00, retry 13:00 | `src/mail/` |
| Detailed briefing on request, written with the reader's own Grok or ChatGPT (shared-ai-auth) from the full articles, then shown to everyone | on demand (queue) | `src/briefing.ts`, `src/ai/` |

## Stack

Cloudflare Worker (Hono, server-rendered JSX, no client JavaScript), D1, Workers AI, Queues, Cron Triggers, Rate Limiting, Resend. Design rules: [DESIGN.md](DESIGN.md).

## Develop

```sh
npm install
npm run migrate:local
cp .dev.vars.example .dev.vars   # then fill in the values
npm run dev                      # http://localhost:8787 (Workers AI calls go to your Cloudflare account)
npm test                         # vitest inside the Workers runtime, with a local D1
npm run typecheck
```

Run jobs by hand: `curl -X POST -H "authorization: Bearer $ADMIN_TOKEN" http://localhost:8787/admin/run/{ingest|build|send}`.

Refresh the outlet list (feeds change; run it now and then and review the diff):

```sh
npx esbuild src/ingest/rss.ts --bundle --format=esm --platform=node --outfile=.tmp/rss.mjs
node scripts/discover-feeds.mjs   # writes data/outlets.generated.json from data/eady2025 + data/outlets-extra.json
```

## Deploy

```sh
npx wrangler d1 create tare && npx wrangler queues create tare-briefings   # once
npm run migrate:remote
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put LINK_SECRET    # 32+ characters; signs manage/unsubscribe/sign-in links
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put AI_TOKEN_KEY   # 32 random bytes, base64; seals readers' AI tokens
npm run deploy
```

Rotating `LINK_SECRET` breaks links already emailed; rotating `AI_TOKEN_KEY` disconnects every reader's AI account.

## Cost

Write-ups for new stories plus embeddings run around 5,000–15,000 Workers AI neurons a day (the free allocation is 10,000; above it, $0.011 per 1,000). Continuing stories cost nothing per hour. Detailed briefings cost Tare nothing: they run on the reader's own account. Resend's free plan sends 100 emails a day.

## Credits

Audience-lean scores: Eady, G., Bonneau, R., Tucker, J. A., & Nagler, J. (2025). News Sharing and Partisanship on Social Media. *Political Analysis*. Replication data: https://doi.org/10.7910/DVN/1QMLOV (CC0).

## License

MIT
