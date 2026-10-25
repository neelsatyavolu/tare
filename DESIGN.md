# Tare — Design

Tare is a daily news edition. The name comes from a scale: you tare it to zero so you weigh only what's inside. The design should feel like a well-made broadsheet run by careful people. It should not look like a feed, a dashboard or an AI product.

## 1. Principles

1. **Print first.** Paper, ink, column rules, a masthead, an edition date. Pages are meant to be read top to bottom and finished.
2. **No side gets a color.** Left, center and right are never red, blue or any hue. They are told apart by position and label (L · C · R) in ink tones. Brass, the one accent, never marks a political side.
3. **Show the weighing.** Every story shows its evidence: who covered it, where the coverage sits, why it made the edition. The coverage scale is the signature element.
4. **Quiet confidence.** No breaking-news banners, no urgency, no badges, no "AI-powered" sparkle. The AI is described plainly on the method page and nowhere is it decoration.
5. **Finite.** An edition ends. The last thing on the page is "That's the edition."

## 2. Color

Light (Newsprint) is the default; dark (Night edition) follows `prefers-color-scheme` or `[data-theme="dark"]`.

| Token | Newsprint | Night | Role |
|---|---|---|---|
| `--paper` | `#F3EFE6` | `#151410` | Page background |
| `--sheet` | `#FBF9F4` | `#1C1B16` | Raised panel (subscribe box, story detail) |
| `--ink` | `#1C1A16` | `#EDE7DA` | Headlines, body |
| `--ink-2` | `#5E594F` | `#A59F92` | Secondary text, deks |
| `--ink-3` | `#6F695E` | `#8C8676` | Meta, labels (passes 4.5:1 on paper) |
| `--rule` | `rgba(28,26,22,.16)` | `rgba(237,231,218,.14)` | Hairline column rules |
| `--rule-strong` | `#1C1A16` | `#EDE7DA` | Masthead double rule, section heads |
| `--brass` | `#8A5A12` | `#D9A441` | Links, focus, the scale needle. Only accent |
| `--brass-wash` | `rgba(138,90,18,.10)` | `rgba(217,164,65,.14)` | Selected topic, highlight |
| `--alert` | `#A3341F` | `#E27A5F` | Form errors only |

Coverage tones (scale segments, never hues):
`--lean-l: var(--ink)` · `--lean-c: var(--ink-3)` · `--lean-r: var(--ink)` with the C segment hatched lighter. Segments are always labeled.

## 3. Typography

| Role | Face | Use |
|---|---|---|
| Masthead, headlines | **Libre Caslon Display** (400) | Masthead wordmark, story headlines |
| Body, deks, summaries | **Source Serif 4** (400/600, opsz) | All reading text, 18px, line-height 1.55, max 66ch |
| Labels, data, UI | **IBM Plex Mono** (400/500) | Section kickers, outlet names, counts, dates, buttons |

All from Google Fonts. Scale (px): 12 · 13 · 15 · 18 · 22 · 30 · 44 · 72.

- Kickers: Plex Mono 12, uppercase, letter-spacing .1em, `--ink-3`.
- Lead headline: Caslon Display 44 (30 on mobile), line-height 1.08, `text-wrap: balance`.
- Story headline: Caslon Display 30 (22 on mobile).
- Numbers: `font-variant-numeric: tabular-nums`.
- Italic only for quoted source text.

## 4. Layout

- Max width 1120px, 24px gutters (16px on phones).
- Masthead: centered wordmark between two rules (top 3px double, bottom 1px), edition line beneath in mono: `SATURDAY, OCTOBER 24, 2026 · NO. 12 · 18 STORIES`.
- Front page: lead story spans two columns; the rest sit in a two-column grid separated by a vertical hairline. One column on phones.
- Sections ("Politics", "World"…) open with a mono kicker on a full-width 1px rule.
- 0px corners everywhere. No shadows. No gradients. Separation comes from rules and space.

## 5. The coverage scale (signature)

A horizontal beam with three labeled pans: `L 5/12 · C 4/10 · R 1/12`. Below it, a tick ruler from left to right with a brass needle at the coverage balance: (right share − left share) ÷ (right share + left share), from −1 to 1, where a share is the fraction of that side's outlets that covered the story. A centered needle reads "Balanced coverage"; at or past ±0.5 it reads "Mostly covered by the left" / "…the right". If that story had at least four outlets and the other side had one or none, it gets a **Blindspot** kicker.

Shares, not raw counts, so a side with more outlets in the source list can't tip the scale.

## 6. Components

- **Story card:** kicker (topic · outlet count) → headline → 2–4 summary sentences, each followed by small superscript source markers → coverage scale → "Where accounts differ" (collapsible `<details>`) → "Why it's here" one-liner in mono.
- **Source list:** grouped L / C / R, each row `OUTLET` in mono + headline as a link, opening the outlet's page.
- **Buttons:** mono 13 uppercase, 1px ink border, transparent fill; primary is ink fill on paper text. Hover swaps fill. Focus: 2px brass outline, 2px offset.
- **Inputs:** 1px `--rule-strong` bottom border only, serif text.
- **Topic chips:** checkbox styled as bordered mono label; checked uses `--brass-wash` fill and brass border.

## 7. Motion

Almost none. 120ms color transitions on links and buttons. The scale needle does not animate. Respect `prefers-reduced-motion`.

## 8. Voice

Plain, specific, attributed. "Officials said", not "shocking". Headlines state what happened; they don't tease. UI copy is short and in sentence case except mono kickers.

## 9. Email

Same palette and order, rendered with inline styles and web-safe fallbacks (Georgia for serif, Menlo/Courier for mono). Single 600px column. The coverage scale becomes a mono text line: `Covered by 9 outlets · L 4 · C 3 · R 2`.

## 10. Don'ts

- No red/blue anywhere, no party colors, no gradients from one side to the other.
- No emoji, no icons for sections, no stock photos, no AI-generated images, no AI sparkle glyphs.
- Photos are only the outlets' own feed images, always credited ("Photo: BBC News") in mono under the image. Chosen from a center outlet first, then from the side that covered the story less.
- No infinite scroll, no "trending", no engagement counts.
- No rounded corners, no shadows, no glassmorphism.

## 11. Tokens

```css
:root{
  --paper:#F3EFE6; --sheet:#FBF9F4; --ink:#1C1A16; --ink-2:#5E594F; --ink-3:#6F695E;
  --rule:rgba(28,26,22,.16); --rule-strong:#1C1A16;
  --brass:#8A5A12; --brass-wash:rgba(138,90,18,.10); --alert:#A3341F;
  --font-display:"Libre Caslon Display",Georgia,serif;
  --font-serif:"Source Serif 4",Georgia,serif;
  --font-mono:"IBM Plex Mono",Menlo,monospace;
  color-scheme:light;
}
```
