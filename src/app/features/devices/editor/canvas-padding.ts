/**
 * Pure maths for the canvas around a device image: the layout editor lets
 * boxes and leader lines sit beside the photo, and the exported image grows to
 * hold them (plus a margin, optionally to 16:9), filled with a background
 * colour detected from the photo's border. No DOM here, so it is unit-tested
 * directly.
 */
import { Box, ImagePoint } from '../../../core/data/catalog.types';
import { MAX_IMAGE_SIDE } from '../../../core/devices/device-files';

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_PADDING: Padding = { top: 0, right: 0, bottom: 0, left: 0 };

/** Fill for the added area (and anything transparent after rotating). */
export type CanvasBackground = { kind: 'color'; color: string } | { kind: 'transparent' };

/** What the user picks: a colour detected from the photo's border, a fixed colour, or transparent. */
export type BackgroundSetting = { kind: 'auto' } | { kind: 'color'; color: string } | { kind: 'transparent' };

export interface CanvasSettings {
  background: BackgroundSetting;
  /** Space kept around boxes and lines that go beyond the photo, in image pixels. */
  margin: number;
  /** Grow the canvas to 16:9 around the content. */
  aspect169: boolean;
}

export const DEFAULT_CANVAS: CanvasSettings = { background: { kind: 'auto' }, margin: 48, aspect169: false };

/** Swatches for the background colour. */
export const BACKGROUND_SWATCHES = [
  { color: '#ffffff', name: 'White' },
  { color: '#e6e6e6', name: 'Light grey' },
  { color: '#1d1b1a', name: 'App dark' },
  { color: '#000000', name: 'Black' },
];

export function hasPadding(p: Padding | null | undefined): boolean {
  return !!p && (p.top > 0 || p.right > 0 || p.bottom > 0 || p.left > 0);
}

export function paddedSize(width: number, height: number, p: Padding | null | undefined): { width: number; height: number } {
  const q = p ?? NO_PADDING;
  return { width: width + q.left + q.right, height: height + q.top + q.bottom };
}

/**
 * Scale for the final image: `outputWidth` (if given) sets the width, and the
 * longest side never exceeds `maxSide`.
 */
export function outputScale(width: number, height: number, outputWidth?: number | null, maxSide = MAX_IMAGE_SIDE): number {
  const wanted = outputWidth && outputWidth > 0 ? outputWidth / width : 1;
  return Math.min(wanted, maxSide / Math.max(width, height));
}

/** Bounding box of the image and everything drawn on it (boxes, leader points), in image pixels. */
export function contentExtent(image: { width: number; height: number }, boxes: readonly Box[], points: readonly ImagePoint[]): Box {
  let x1 = 0;
  let y1 = 0;
  let x2 = image.width;
  let y2 = image.height;
  for (const b of boxes) {
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w);
    y2 = Math.max(y2, b.y + b.h);
  }
  for (const p of points) {
    x1 = Math.min(x1, p.x);
    y1 = Math.min(y1, p.y);
    x2 = Math.max(x2, p.x);
    y2 = Math.max(y2, p.y);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Grow a padding so the padded image is 16:9, adding the space evenly on both sides. */
export function expandTo169(width: number, height: number, p: Padding): Padding {
  const W = width + p.left + p.right;
  const H = height + p.top + p.bottom;
  const out = { ...p };
  if (W * 9 < H * 16) {
    const extra = Math.ceil((H * 16) / 9) - W;
    out.left += Math.floor(extra / 2);
    out.right += extra - Math.floor(extra / 2);
  } else if (W * 9 > H * 16) {
    const extra = Math.ceil((W * 9) / 16) - H;
    out.top += Math.floor(extra / 2);
    out.bottom += extra - Math.floor(extra / 2);
  }
  return out;
}

/**
 * Space to add around the image so everything drawn on it fits: on each side
 * where boxes or leader points go beyond the photo (by more than `tolerance`
 * px), up to them plus the margin; nothing where they don't. Optionally grown
 * to 16:9. Whole pixels.
 */
export function canvasPadding(
  image: { width: number; height: number },
  boxes: readonly Box[],
  points: readonly ImagePoint[],
  settings: Pick<CanvasSettings, 'margin' | 'aspect169'>,
  tolerance = 0.5,
): Padding {
  const e = contentExtent(image, boxes, points);
  const m = Math.max(0, settings.margin || 0);
  const beyond = (over: number) => (over > tolerance ? Math.ceil(over + m) : 0);
  const pad: Padding = {
    left: beyond(-e.x),
    top: beyond(-e.y),
    right: beyond(e.x + e.w - image.width),
    bottom: beyond(e.y + e.h - image.height),
  };
  return settings.aspect169 ? expandTo169(image.width, image.height, pad) : pad;
}

/** The canvas as a rectangle in image pixels (the photo is at 0,0). */
export function canvasRect(image: { width: number; height: number }, p: Padding): Box {
  return { x: 0 - p.left || 0, y: 0 - p.top || 0, w: image.width + p.left + p.right, h: image.height + p.top + p.bottom };
}

/**
 * The editor's workspace: the image, its content and the canvas, with room
 * to draw into on every side (`room` × the image size).
 */
export function workspaceRect(image: { width: number; height: number }, extent: Box, room = 0.5): Box {
  const mx = Math.round(image.width * room);
  const my = Math.round(image.height * room);
  const x = Math.floor(Math.min(0, extent.x)) - mx;
  const y = Math.floor(Math.min(0, extent.y)) - my;
  const x2 = Math.ceil(Math.max(image.width, extent.x + extent.w)) + mx;
  const y2 = Math.ceil(Math.max(image.height, extent.y + extent.h)) + my;
  return { x, y, w: x2 - x, h: y2 - y };
}

/** Union of two rectangles. */
export function unionRect(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** The fill to use: "auto" becomes the detected colour (transparent if none). */
export function resolveBackground(setting: BackgroundSetting, detected: string | null | undefined): CanvasBackground {
  if (setting.kind === 'color') return { kind: 'color', color: setting.color };
  if (setting.kind === 'auto' && detected) return { kind: 'color', color: detected };
  return { kind: 'transparent' };
}

// ------------------------------------------------------------ background detection

export interface BorderColour {
  /** `#rrggbb`, or null when the border is mostly transparent. */
  color: string | null;
  /** Share of border samples in the winning colour bucket (0..1). */
  share: number;
  /** The border has no clearly dominant colour; `color` is the median. */
  busy: boolean;
}

export function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function fromHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Pixel offsets (into RGBA data) along the border band of an image, at most ~`max` of them. */
export function borderSamples(width: number, height: number, band: number, max = 6000): number[] {
  const b = Math.max(1, Math.min(band, Math.floor(Math.min(width, height) / 2) || 1));
  const perimeter = 2 * (width + height) * b;
  const step = Math.max(1, Math.ceil(perimeter / max));
  const out: number[] = [];
  let k = 0;
  const take = (x: number, y: number) => {
    if (k++ % step === 0) out.push((y * width + x) * 4);
  };
  for (let y = 0; y < height; y++) {
    const edgeRow = y < b || y >= height - b;
    if (edgeRow) for (let x = 0; x < width; x++) take(x, y);
    else {
      for (let x = 0; x < b; x++) take(x, y);
      for (let x = Math.max(b, width - b); x < width; x++) take(x, y);
    }
  }
  return out;
}

/**
 * The dominant colour of the image border: colours are quantised to 4 bits
 * per channel and the most common bucket wins (its exact average is
 * returned). When no bucket holds `minShare` of the samples the border is
 * "busy" and the per-channel median is returned instead. A mostly
 * transparent border gives `color: null` (keep it transparent).
 */
export function detectBackground(
  data: ArrayLike<number>,
  width: number,
  height: number,
  opts: { band?: number; minShare?: number } = {},
): BorderColour {
  const band = opts.band ?? Math.max(1, Math.round(Math.min(width, height) * 0.02));
  const minShare = opts.minShare ?? 0.35;
  const offsets = borderSamples(width, height, band);
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  let transparent = 0;
  for (const o of offsets) {
    if (data[o + 3] < 16) {
      transparent++;
      continue;
    }
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += r;
    e.g += g;
    e.b += b;
    buckets.set(key, e);
    rs.push(r);
    gs.push(g);
    bs.push(b);
  }
  const total = offsets.length;
  if (!total || transparent / total > 0.5) return { color: null, share: total ? transparent / total : 0, busy: false };
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  const opaque = total - transparent;
  const share = best ? best.n / opaque : 0;
  if (best && share >= minShare) return { color: toHex(best.r / best.n, best.g / best.n, best.b / best.n), share, busy: false };
  const median = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)] ?? 0;
  };
  return { color: toHex(median(rs), median(gs), median(bs)), share, busy: true };
}
