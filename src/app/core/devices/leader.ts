/**
 * Leader lines: a line from a label box to the control it labels. Stored as
 * image-pixel points (the last one is the anchor on the control, earlier ones
 * are elbows); the start on the box edge is computed here when drawing.
 */
import { Box, ImagePoint } from '../data/catalog.types';

/** The point on the box's outline nearest to `p` (inside points go to the closest edge). */
export function nearestPointOnBox(box: Box, p: ImagePoint): ImagePoint {
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  const inside = p.x > box.x && p.x < right && p.y > box.y && p.y < bottom;
  if (!inside) return { x: Math.min(right, Math.max(box.x, p.x)), y: Math.min(bottom, Math.max(box.y, p.y)) };
  const d = [p.x - box.x, right - p.x, p.y - box.y, bottom - p.y];
  const min = Math.min(...d);
  if (min === d[0]) return { x: box.x, y: p.y };
  if (min === d[1]) return { x: right, y: p.y };
  if (min === d[2]) return { x: p.x, y: box.y };
  return { x: p.x, y: bottom };
}

/** Every point of the drawn line: start on the box edge, elbows, anchor. Empty without a leader. */
export function leaderPath(box: Box, leader: readonly ImagePoint[] | undefined): ImagePoint[] {
  if (!leader?.length) return [];
  return [nearestPointOnBox(box, leader[0]), ...leader];
}

/** SVG path data for a list of points. */
export function pathData(points: readonly ImagePoint[], digits = 1): string {
  const f = 10 ** digits;
  const r = (n: number) => String(Math.round(n * f) / f);
  return points.map((p, i) => `${i ? 'L' : 'M'}${r(p.x)} ${r(p.y)}`).join('');
}

/** Distance from p to segment ab, and the closest point on it. */
export function pointToSegment(p: ImagePoint, a: ImagePoint, b: ImagePoint): { distance: number; point: ImagePoint } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { distance: Math.hypot(p.x - point.x, p.y - point.y), point };
}

/**
 * Add an elbow where the user clicked the line. `path` is leaderPath() output;
 * returns the new leader and the index of the inserted point in it.
 */
export function insertElbow(path: readonly ImagePoint[], leader: readonly ImagePoint[], p: ImagePoint): { leader: ImagePoint[]; index: number } {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const d = pointToSegment(p, path[i], path[i + 1]).distance;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  // Segment i runs from path[i] to path[i + 1] = leader[i]; the new point goes before leader[i].
  const out = [...leader];
  out.splice(best, 0, { x: p.x, y: p.y });
  return { leader: out, index: best };
}

/** Set the anchor (last point), keeping any elbows. */
export function withAnchor(leader: readonly ImagePoint[] | undefined, anchor: ImagePoint): ImagePoint[] {
  return leader?.length ? [...leader.slice(0, -1), anchor] : [anchor];
}

/** Remove one point; removing the anchor removes the whole line (undefined). */
export function removeLeaderPoint(leader: readonly ImagePoint[], index: number): ImagePoint[] | undefined {
  if (index >= leader.length - 1) return undefined;
  return leader.filter((_, i) => i !== index);
}

export function roundPoint(p: ImagePoint): ImagePoint {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}
