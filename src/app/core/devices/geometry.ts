/** Box geometry for the layout editor. All values are image pixels. */
import { Box } from '../data/catalog.types';

export interface Point {
  x: number;
  y: number;
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Normalised rectangle spanning two points. */
export function rectFromPoints(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** True when the boxes share more than `tolerance` pixels in both directions (touching edges don't count). */
export function boxesOverlap(a: Box, b: Box, tolerance = 1): boolean {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > tolerance && h > tolerance;
}

export function sameBox(a: Box, b: Box, tolerance = 0.5): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.w - b.w) <= tolerance &&
    Math.abs(a.h - b.h) <= tolerance
  );
}

/** Pairs of overlapping boxes. Identical boxes are deliberate sharing and are not reported. */
export function findOverlaps<T extends { box: Box }>(items: T[], tolerance = 1): [T, T][] {
  const out: [T, T][] = [];
  const sorted = [...items].sort((a, b) => a.box.x - b.box.x);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (b.box.x >= a.box.x + a.box.w) break;
      if (!sameBox(a.box, b.box) && boxesOverlap(a.box, b.box, tolerance)) out.push([a, b]);
    }
  }
  return out;
}

/** True when any part of the box lies outside the image. */
export function isOffImage(box: Box, width: number, height: number, tolerance = 0.5): boolean {
  return box.x < -tolerance || box.y < -tolerance || box.x + box.w > width + tolerance || box.y + box.h > height + tolerance;
}

/** Move (not shrink) a box so it lies inside the image where possible. */
export function clampBox(box: Box, width: number, height: number): Box {
  const w = Math.min(box.w, width);
  const h = Math.min(box.h, height);
  return { x: Math.min(Math.max(0, box.x), width - w), y: Math.min(Math.max(0, box.y), height - h), w, h };
}

export function nudge(box: Box, dx: number, dy: number): Box {
  return { ...box, x: box.x + dx, y: box.y + dy };
}

/** Resize by dragging a handle by (dx, dy). Never flips; keeps at least `min` px. */
export function resizeBox(box: Box, handle: Handle, dx: number, dy: number, min = 4): Box {
  let { x, y, w, h } = box;
  if (handle.includes('w')) {
    const nx = Math.min(x + dx, x + w - min);
    w = w + (x - nx);
    x = nx;
  }
  if (handle.includes('e')) w = Math.max(min, w + dx);
  if (handle.includes('n')) {
    const ny = Math.min(y + dy, y + h - min);
    h = h + (y - ny);
    y = ny;
  }
  if (handle.includes('s')) h = Math.max(min, h + dy);
  return { x, y, w, h };
}

// ------------------------------------------------------------ snapping

export interface SnapOptions {
  /** Max distance in image pixels for snapping to another box's edge. */
  threshold: number;
  /** Grid size in image pixels; 0 or undefined for no grid. */
  grid?: number;
}

export interface SnapLines {
  /** Vertical guide lines (x positions) and horizontal ones (y). */
  x: number[];
  y: number[];
}

export interface SnapResult {
  box: Box;
  guides: SnapLines;
}

/** Edge positions of boxes to snap to. */
export function snapTargets(boxes: Box[], image?: { width: number; height: number }): SnapLines {
  const x: number[] = [];
  const y: number[] = [];
  for (const b of boxes) {
    x.push(b.x, b.x + b.w);
    y.push(b.y, b.y + b.h);
  }
  if (image) {
    x.push(0, image.width);
    y.push(0, image.height);
  }
  return { x, y };
}

/** Closest candidate within threshold, as a delta to add to `value`. */
export function snapDelta(value: number, candidates: number[], threshold: number): { delta: number; to: number } | null {
  let best: { delta: number; to: number } | null = null;
  for (const c of candidates) {
    const d = c - value;
    if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, to: c };
  }
  return best;
}

function gridDelta(value: number, grid: number | undefined): number {
  return grid && grid > 0 ? Math.round(value / grid) * grid - value : 0;
}

/**
 * Snap a moved box: either of its vertical edges to a target x, either
 * horizontal edge to a target y; otherwise its top-left corner to the grid.
 */
export function snapMove(box: Box, targets: SnapLines, opts: SnapOptions): SnapResult {
  const guides: SnapLines = { x: [], y: [] };
  const axis = (start: number, size: number, cands: number[], lines: number[]): number => {
    const a = snapDelta(start, cands, opts.threshold);
    const b = snapDelta(start + size, cands, opts.threshold);
    const best = a && b ? (Math.abs(a.delta) <= Math.abs(b.delta) ? a : b) : (a ?? b);
    if (best) {
      lines.push(best.to);
      return start + best.delta;
    }
    return start + gridDelta(start, opts.grid);
  };
  const x = axis(box.x, box.w, targets.x, guides.x);
  const y = axis(box.y, box.h, targets.y, guides.y);
  return { box: { ...box, x, y }, guides };
}

/** Snap only the given edges of a box (resizing or drawing). */
export function snapEdges(
  box: Box,
  edges: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean },
  targets: SnapLines,
  opts: SnapOptions,
): SnapResult {
  const guides: SnapLines = { x: [], y: [] };
  let left = box.x;
  let right = box.x + box.w;
  let top = box.y;
  let bottom = box.y + box.h;
  const snap = (v: number, cands: number[], lines: number[]) => {
    const s = snapDelta(v, cands, opts.threshold);
    if (s) {
      lines.push(s.to);
      return s.to;
    }
    return v + gridDelta(v, opts.grid);
  };
  if (edges.left) left = snap(left, targets.x, guides.x);
  if (edges.right) right = snap(right, targets.x, guides.x);
  if (edges.top) top = snap(top, targets.y, guides.y);
  if (edges.bottom) bottom = snap(bottom, targets.y, guides.y);
  if (right - left < 1) (edges.left ? (left = right - 1) : (right = left + 1));
  if (bottom - top < 1) (edges.top ? (top = bottom - 1) : (bottom = top + 1));
  return { box: { x: left, y: top, w: right - left, h: bottom - top }, guides };
}

export function edgesForHandle(h: Handle): { left: boolean; right: boolean; top: boolean; bottom: boolean } {
  return { left: h.includes('w'), right: h.includes('e'), top: h.includes('n'), bottom: h.includes('s') };
}

/** Align boxes to the first one's left or top edge. */
export function alignBoxes(boxes: Box[], edge: 'left' | 'top' | 'right' | 'bottom'): Box[] {
  if (boxes.length < 2) return boxes;
  const ref = boxes[0];
  return boxes.map((b) => {
    switch (edge) {
      case 'left':
        return { ...b, x: ref.x };
      case 'right':
        return { ...b, x: ref.x + ref.w - b.w };
      case 'top':
        return { ...b, y: ref.y };
      case 'bottom':
        return { ...b, y: ref.y + ref.h - b.h };
    }
  });
}

/** Round to whole pixels (device.json keeps integers where it can). */
export function roundBox(b: Box): Box {
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.max(1, Math.round(b.w)), h: Math.max(1, Math.round(b.h)) };
}
