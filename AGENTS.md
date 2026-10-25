# Tare: notes for agents

- Read DESIGN.md before touching anything visual. No red/blue for political sides, no client JavaScript (CSP has `script-src 'none'`).
- `npm test` runs inside the Workers runtime with a local D1; `npm run typecheck` must stay clean.
- Never store or show article bodies. Items hold headline, feed description (400 chars max) and link only.
- Every summary sentence must cite real sources; `validateWriteup` in `src/build/summarize.ts` enforces this. Don't loosen it to get more stories through.
- `SAME_EVENT` in `src/build/build.ts` was tuned on real feeds (0.80 chained a day of election coverage into one group). Re-tune against live data before changing it.
- Lean labels in `src/outlets.ts` are published on /method. Keep the left and right sides the same size (a test checks this).
- Changing `LINK_SECRET` invalidates every manage/unsubscribe link already emailed.
- `npm run dev` calls Workers AI on the real Cloudflare account; builds cost about 5,000 neurons each.
