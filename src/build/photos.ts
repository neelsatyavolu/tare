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
  const sideCount = (side: Side) => sources.filter((s) => sideOfOutlet(s.outletId) === side).length;
  const minority: Side = sideCount("left") <= sideCount("right") ? "left" : "right";
  // Unrated outlets (mostly international) rank with the minority side: neither side's pick.
  const rank = (s: { outletId: string }) => ({ center: 0, [minority]: 1, unrated: 1 } as Record<string, number>)[sideOfOutlet(s.outletId)] ?? 2;
  return [...withImage].sort((a, b) => rank(a) - rank(b) || a.outletId.localeCompare(b.outletId))[0]!.id;
}
