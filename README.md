# Tare

A daily news edition that shows how outlets across the political spectrum covered each story. Every morning Tare groups the last 24 hours of headlines from 34 outlets by event, writes a neutral, source-cited summary of each, shows where the accounts differ, and emails readers the edition: the front page everyone gets, plus the topics they picked.

Live at https://tare.news (once the domain is attached).

## How it works

| Step | When (UTC) | Code |
|---|---|---|
| Pull every outlet's RSS feed; keep headline, feed description, link | hourly at :07 | `src/ingest/` |
| Embed headlines (`@cf/baai/bge-base-en-v1.5`), group by event, rank by number of distinct outlets | 10:15 | `src/build/cluster.ts`, `src/build/select.ts` |
| Write headline, summary and "where accounts differ" per story (`@cf/openai/gpt-oss-120b`); drop any sentence that doesn't cite a real source | 10:15 | `src/build/summarize.ts` |
| Email each confirmed subscriber the front page + their topics + blindspots (Resend) | 11:00 | `src/mail/` |

The source list and lean labels are in `src/outlets.ts` (12 left, 10 center, 12 right) and are published on `/method`. Selection rules are deterministic and stated on every story page.

## Stack

Cloudflare Worker (Hono, server-rendered JSX, no client JavaScript), D1, Workers AI, Cron Triggers, Workers Rate Limiting, Resend. Design rules live in [DESIGN.md](DESIGN.md).

## Develop

```sh
npm install
npm run migrate:local
cp .dev.vars.example .dev.vars   # then fill in the values
npm run dev                      # http://localhost:8787 (Workers AI calls go to your Cloudflare account)
npm test                         # vitest inside the Workers runtime, with a local D1
npm run typecheck
```

Run jobs by hand against the dev server:

```sh
curl -X POST -H "authorization: Bearer $ADMIN_TOKEN" http://localhost:8787/admin/run/ingest
curl -X POST -H "authorization: Bearer $ADMIN_TOKEN" "http://localhost:8787/admin/run/build?force=1"
curl -X POST -H "authorization: Bearer $ADMIN_TOKEN" http://localhost:8787/admin/run/send
```

## Deploy

```sh
npx wrangler d1 create tare            # once; put the id in wrangler.jsonc
npm run migrate:remote
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put LINK_SECRET    # 32+ random characters; signs manage/unsubscribe links
npx wrangler secret put ADMIN_TOKEN
npm run deploy
```

Changing `LINK_SECRET` breaks every manage and unsubscribe link already sent.

## Cost

About 5,000 Workers AI neurons per edition (roughly 20 write-ups plus embeddings), inside the 10,000-neuron daily free allocation. Resend's free plan sends 100 emails a day.

## License

MIT
