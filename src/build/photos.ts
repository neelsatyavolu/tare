import { outletById, sideOf, type Side } from "../outlets";

function sideOfOutlet(id: string): Side | "unrated" {
  const o = outletById(id);
  return (o && sideOf(o.lean)) ?? "unrated";
}

/**
 * The photo a story shows. A photo frames a story as much as a headline, so it comes from a center outlet
 * when one has a picture, then from whichever side covered the story less, so the larger side doesn't
 * also get to pick the image. Ties go by outlet id, which keeps it deterministic.
 */
export function pickImage(sources: readonly { id: string; outletId: string; imageUrl: string | null }[]): string | null {
  const withImage = sources.filter((s) => s.imageUrl);
  if (withImage.length === 0) return null;
  // A sharp photo beats the side rule: video frames and small thumbnails come last whoever published them.
  const weak = (s: { imageUrl: string | null }) => (weakImage(s.imageUrl!) ? 1 : 0);
  const sideCount = (side: Side) => sources.filter((s) => sideOfOutlet(s.outletId) === side).length;
  const minority: Side = sideCount("left") <= sideCount("right") ? "left" : "right";
  // Unrated outlets (mostly international) rank with the minority side: neither side's pick.
  const rank = (s: { outletId: string }) => ({ center: 0, [minority]: 1, unrated: 1 } as Record<string, number>)[sideOfOutlet(s.outletId)] ?? 2;
  return [...withImage].sort((a, b) => weak(a) - weak(b) || rank(a) - rank(b) || a.outletId.localeCompare(b.outletId))[0]!.id;
}

/** Smallest width a lead photo can be shown at without looking soft. */
const MIN_WIDTH = 640;

/**
 * A photo that will look soft: a frame grabbed from a broadcast video (NBC's "mpx" player, "video"/"clip" paths),
 * or a thumbnail whose URL says it's narrower than MIN_WIDTH ("_384.jpg", "/standard/240/", "w_300").
 */
export function weakImage(url: string): boolean {
  if (/\/mpx\/|\/videos?\/|\/clips?\/|_vid[_.]|video[-_]?still/i.test(url)) return true;
  const width = url.match(/(?:_|\/standard\/|\/|w_|t_fit_)(\d{3,4})(?:w|x\d{3,4})?(?:\.jpe?g|\.png|\.webp|\/|$|,)/i)?.[1];
  return width !== undefined && Number(width) < MIN_WIDTH && !upsized(url);
}

/** A larger rendition when the host's URL scheme allows it: BBC's image server takes the width in the path. */
export function upsized(url: string): string | null {
  const m = url.match(/^(https:\/\/ichef\.bbci\.co\.uk\/.*?\/standard\/)(\d{2,4})(\/.*)$/);
  return m && Number(m[2]) < 976 ? `${m[1]}976${m[3]}` : null;
}

/** The URL to show: the larger rendition when there is one. */
export const displayImage = (url: string) => upsized(url) ?? url;
