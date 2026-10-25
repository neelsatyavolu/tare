import type { FC } from "hono/jsx";
import type { Source, Story } from "../editions";
import { acrossSpectrum, BUCKETS, bucketOf, distributionSentence, ratedOf, ZETA_SPAN, type Bucket, type Distribution } from "../distribution";
import { LEAN_LABEL, OUTLETS, ZETA_EDGES, type Outlet, type Side } from "../outlets";

/**
 * Coverage by outlet, not by share: the five-bucket bar on cards and the source spectrum on the story page.
 * Inline SVG and CSS only (no client JavaScript); sides are told apart by position and label, never by hue.
 */

const BUCKET_LABEL: Record<Bucket, string> = { left: LEAN_LABEL.left, leanLeft: LEAN_LABEL["lean-left"], center: LEAN_LABEL.center, leanRight: LEAN_LABEL["lean-right"], right: LEAN_LABEL.right };

const BUCKET_WORDS: Record<Bucket, string> = { left: "left", leanLeft: "leaning left", center: "center", leanRight: "leaning right", right: "right" };

/** "3 left, 2 leaning left, …": every bucket, zeros included, so the counts add up to the total. */
export function distributionLabel(d: Distribution): string {
  const parts = BUCKETS.map((b) => `${d[b]} ${BUCKET_WORDS[b]}`);
  return `Outlets by lean, left to right: ${parts.join(", ")}${d.unrated ? `; ${d.unrated} not rated` : ""}.`;
}

/**
 * A thin bar of the rated outlets that covered a story, left to right, each bucket as wide as its count. Unrated
 * outlets have no place on a left-right line, so they're a count beside it, not a segment.
 */
export const DistBar: FC<{ d: Distribution }> = ({ d }) => {
  if (d.total === 0) return null;
  return (
    <div class="dist" role="img" aria-label={distributionLabel(d)}>
      <span class="dist-end" aria-hidden="true">L</span>
      <span class="dist-bar" aria-hidden="true">
        {ratedOf(d) > 0 ? BUCKETS.map((b) => (d[b] > 0 ? <i class={`seg ${b}`} style={`flex-grow:${d[b]}`} /> : null)) : null}
      </span>
      <span class="dist-end" aria-hidden="true">R</span>
      {d.unrated ? <span class="dist-nr" aria-hidden="true">+{d.unrated} not rated</span> : null}
    </div>
  );
};

// Spectrum geometry, in viewBox units; the SVG scales to its column's width.
const W = 600;
const PAD = 10;
const R = 8;
const STEP = 2 * R + 1.5;
const TOP = 4;
const MIN_LEVELS = 2;

const clampZ = (z: number) => Math.max(-ZETA_SPAN, Math.min(ZETA_SPAN, z));
export const xOf = (z: number) => PAD + ((clampZ(z) + ZETA_SPAN) / (2 * ZETA_SPAN)) * (W - 2 * PAD);

/** −0.81, +1.10: the score as a reader can look it up. */
const score = (z: number) => `${z < 0 ? "−" : "+"}${Math.abs(z).toFixed(2)}`;

export type Mark = { outlet: Outlet; x: number; level: number };

/**
 * Places each rated outlet at its score and stacks outlets that would overlap, lowest free row first (a dot
 * plot). Unrated outlets are left out: they have no score to place.
 */
export function spectrumMarks(outlets: readonly Outlet[]): Mark[] {
  const rated = outlets.filter((o): o is Outlet & { zeta: number } => o.zeta != null && bucketOf(o.lean) !== null).sort((a, b) => a.zeta - b.zeta);
  const lastX: number[] = [];
  return rated.map((outlet) => {
    const x = xOf(outlet.zeta);
    // Sorted by x, so a row is free once its last dot is a full diameter to the left.
    const free = lastX.findIndex((last) => x - last >= 2 * R);
    const level = free === -1 ? lastX.length : free;
    lastX[level] = x;
    return { outlet, x, level };
  });
}

/** Band edges on the axis, left to right, with each band's bucket. */
const BANDS: { bucket: Bucket; from: number; to: number }[] = [
  { bucket: "left", from: -ZETA_SPAN, to: ZETA_EDGES.left },
  { bucket: "leanLeft", from: ZETA_EDGES.left, to: ZETA_EDGES.leanLeft },
  { bucket: "center", from: ZETA_EDGES.leanLeft, to: ZETA_EDGES.leanRight },
  { bucket: "leanRight", from: ZETA_EDGES.leanRight, to: ZETA_EDGES.right },
  { bucket: "right", from: ZETA_EDGES.right, to: ZETA_SPAN },
];

/** Counts on one row, labels under them; two-line labels for the narrow lean bands, so they fit at phone width. */
const BAND_TEXT: Record<Bucket, [string, string?]> = { left: ["Left"], leanLeft: ["Leans", "left"], center: ["Center"], leanRight: ["Leans", "right"], right: ["Right"] };

const RATED_IN_LIST = OUTLETS.filter((o) => o.zeta != null);

/**
 * Every outlet that covered the story, placed left to right by its Eady 2025 score, over ticks for every rated
 * outlet Tare reads, so a one-sided story shows as dots bunched on one side of a full axis. Dots carry an SVG
 * <title> (the outlet, its group and score); a visually hidden list gives screen readers the same.
 */
export const Spectrum: FC<{ outlets: readonly Outlet[]; d: Distribution }> = ({ outlets, d }) => {
  const marks = spectrumMarks(outlets);
  const unrated = outlets.filter((o) => bucketOf(o.lean) === null);
  const levels = Math.max(MIN_LEVELS, ...marks.map((m) => m.level + 1));
  const axis = TOP + levels * STEP + 2;
  const height = axis + 12;
  const cy = (level: number) => axis - 2 - R - level * STEP;
  const cols = BANDS.map((b) => `${(b.to - b.from).toFixed(2)}fr`).join(" ");
  return (
    <figure class="spectrum">
      <figcaption class="spectrum-h">Where the outlets sit</figcaption>
      {marks.length > 0 ? (
        <>
          <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`${distributionSentence(d)} Each outlet is placed by its audience-lean score; the list below names them.`}>
            {BANDS.map((b) => <rect class={`band ${b.bucket}`} x={xOf(b.from)} y={TOP} width={xOf(b.to) - xOf(b.from)} height={axis - TOP} />)}
            {[ZETA_EDGES.left, ZETA_EDGES.leanLeft, ZETA_EDGES.leanRight, ZETA_EDGES.right].map((z) => (
              <line class="edge" x1={xOf(z)} x2={xOf(z)} y1={TOP} y2={axis} />
            ))}
            <line class="zero" x1={xOf(0)} x2={xOf(0)} y1={TOP} y2={height} />
            <line class="axis" x1={PAD} x2={W - PAD} y1={axis} y2={axis} />
            {RATED_IN_LIST.map((o) => <line class="rug" x1={xOf(o.zeta!)} x2={xOf(o.zeta!)} y1={axis + 3} y2={axis + 10} />)}
            {marks.map((m) => (
              <circle class="dot" cx={m.x.toFixed(1)} cy={cy(m.level).toFixed(1)} r={R}>
                <title>{`${m.outlet.name} · ${LEAN_LABEL[m.outlet.lean]} · ${score(m.outlet.zeta!)}`}</title>
              </circle>
            ))}
          </svg>
          <div class="spectrum-bands" aria-hidden="true" style={`grid-template-columns:${cols}`}>
            {BANDS.map((b) => {
              const [a, c] = BAND_TEXT[b.bucket];
              return <span><b>{d[b.bucket]}</b>{a}{c ? <><br />{c}</> : null}</span>;
            })}
          </div>
          <ul class="sr">
            {BUCKETS.map((b) => {
              const here = marks.filter((m) => bucketOf(m.outlet.lean) === b);
              return <li>{BUCKET_LABEL[b]}: {here.length ? here.map((m) => `${m.outlet.name} (${score(m.outlet.zeta!)})`).join(", ") : "none"}.</li>;
            })}
          </ul>
        </>
      ) : (
        <p class="spectrum-key">No rated outlet covered it, so there is nothing to place on the axis.</p>
      )}
      {unrated.length > 0 ? <p class="spectrum-unrated"><span class="why-label">Not rated</span> {unrated.map((o) => o.name).join(", ")}. Not placed: they have no lean score.</p> : null}
      {marks.length > 0 ? (
        <p class="spectrum-key">Each dot is an outlet that covered it, placed by its audience-lean score (Eady et al. 2025), which measures who shares its links, not how accurate it is. The ticks under the line are all {RATED_IN_LIST.length} rated outlets Tare reads.</p>
      ) : null}
    </figure>
  );
};

const SIDE_WORD: Record<Side, string> = { left: "Left-leaning", center: "Center", right: "Right-leaning" };
const SIDE_ORDER: Side[] = ["left", "center", "right"];

/** One headline from each side that covered it. Shown only when at least two sides did; a missing side says so. */
export const ReadAcross: FC<{ story: Story; sources: Map<string, Source> }> = ({ story, sources }) => {
  const picks = acrossSpectrum(story, sources);
  if (SIDE_ORDER.filter((s) => picks[s]).length < 2) return null;
  return (
    <div class="across">
      <h3 class="across-h">Read across the spectrum</h3>
      <ul>
        {SIDE_ORDER.map((side) => {
          const s = picks[side];
          return s ? (
            <li><span class="why-label">{SIDE_WORD[side]}</span> <a href={s.url} rel="noopener noreferrer nofollow" target="_blank">{s.title}</a> <span class="meta">· {s.outlet.name}</span></li>
          ) : (
            <li class="missing"><span class="why-label">{SIDE_WORD[side]}</span> No {side === "center" ? "center" : `${side}-leaning`} outlet in Tare's list covered it.</li>
          );
        })}
      </ul>
    </div>
  );
};
