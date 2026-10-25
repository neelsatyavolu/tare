import type { Source, Story } from "./editions";
import { sideOf } from "./outlets";

/** Outlets readers know, shown by name so "8 outlets" doesn't read as fringe. Order is display priority. */
export const WELL_KNOWN = ["nyt", "wsj", "fox", "nbc", "cbs", "abc", "npr", "pbs", "bbc", "politico", "thehill", "axios", "bloomberg", "cnbc", "guardian", "nypost", "washtimes", "newsweek", "atlantic", "usnews", "economist", "breitbart", "dailywire", "vox", "time"];

const EXPLAINER = /\b(what to know|what we know|explained|explainer|q&a|key questions|everything you need to know)\b/i;

/**
 * The single article to start with, on the site and in the email: an explainer from any side first; else a
 * center outlet, then unrated, then a side; within each, the one the summary relies on most, then the best-known name.
 */
export function readFirst(story: Story, sources: ReadonlyMap<string, Source>): Source | null {
  const list = story.itemIds.map((id) => sources.get(id)).filter((s): s is Source => !!s);
  const explainer = list.find((s) => EXPLAINER.test(s.title));
  if (explainer) return explainer;
  const group = (s: Source) => ({ center: 0, left: 2, right: 2 } as const)[sideOf(s.outlet.lean) ?? "center"] + (sideOf(s.outlet.lean) === null ? 1 : 0);
  const cited = (s: Source) => story.summary.filter((x) => x.cites.includes(s.id)).length;
  const fame = (s: Source) => (WELL_KNOWN.indexOf(s.outlet.id) + 1) || WELL_KNOWN.length + 1;
  return [...list].sort((a, b) => group(a) - group(b) || cited(b) - cited(a) || fame(a) - fame(b))[0] ?? null;
}

/** "Background" for an explainer, "Read first" for a news report. */
export const readFirstLabel = (s: Source) => (EXPLAINER.test(s.title) ? "Background" : "Read first");
