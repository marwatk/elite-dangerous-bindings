/**
 * Group member markers: which member of a hat/rocker/encoder is which. Known
 * symbols are drawn as vector paths (card fonts don't reliably have arrow
 * glyphs); anything else is short text.
 */
import { Box } from '../data/catalog.types';

export interface MarkerSymbol {
  /** Path in a 24 × 24 box. */
  d: string;
  /** Filled rather than stroked. */
  fill?: boolean;
  /** Extra transform inside the 24 × 24 box (rotations, mirroring). */
  transform?: string;
}

const ARROW = 'M12 20V4.5M5.5 11L12 4.5L18.5 11';
const arrow = (deg: number): MarkerSymbol => ({ d: ARROW, transform: deg ? `rotate(${deg} 12 12)` : undefined });
const DOUBLE = 'M12 2.5V21.5M7 7.5L12 2.5L17 7.5M7 16.5L12 21.5L17 16.5';
const CLOCKWISE = 'M19.5 12A7.5 7.5 0 1 1 17.3 6.7M17.3 6.7L16.9 2.2M17.3 6.7L12.8 6.3';

/** The marker palette, in the order the editor offers it. */
export const MARKER_SYMBOLS: Readonly<Record<string, MarkerSymbol>> = {
  '↑': arrow(0),
  '↗': arrow(45),
  '→': arrow(90),
  '↘': arrow(135),
  '↓': arrow(180),
  '↙': arrow(225),
  '←': arrow(270),
  '↖': arrow(315),
  '●': { d: 'M12 5.5A6.5 6.5 0 1 1 11.99 5.5Z', fill: true },
  '⟳': { d: CLOCKWISE },
  '⟲': { d: CLOCKWISE, transform: 'matrix(-1 0 0 1 24 0)' },
  '↕': { d: DOUBLE },
  '↔': { d: DOUBLE, transform: 'rotate(90 12 12)' },
  '±': { d: 'M12 3.5V14M6.5 8.75H17.5M6.5 19.5H17.5' },
  '+': { d: 'M12 5V19M5 12H19' },
  '−': { d: 'M5 12H19' },
};

export const MARKER_PALETTE = Object.keys(MARKER_SYMBOLS);
export const MAX_MARKER_TEXT = 6;

/** Tidy typed marker text; ASCII "-" becomes the minus symbol. */
export function normalizeMarker(raw: string): string {
  const s = raw.trim();
  if (s === '-') return '−';
  return s.slice(0, MAX_MARKER_TEXT);
}

export function markerSymbol(marker: string): MarkerSymbol | null {
  return MARKER_SYMBOLS[marker] ?? null;
}

const POV = /(?:POV\d+|DPad|Dpad|Hat\d*)_?(Up|Right|Down|Left)$/;

/** The marker a key implies: hat directions become arrows, axis halves + and −; otherwise "" (the user picks). */
export function autoMarker(key: string): string {
  if (/^Pos_/.test(key)) return '+';
  if (/^Neg_/.test(key)) return '−';
  const m = POV.exec(key);
  if (m) return { Up: '↑', Right: '→', Down: '↓', Left: '←' }[m[1] as 'Up' | 'Right' | 'Down' | 'Left'];
  return '';
}

/**
 * Markers for a group's members: the key's own marker where it has one and it
 * isn't taken yet, otherwise the current one (if unique), otherwise "".
 */
export function fillMarkers(members: readonly { key: string; marker?: string }[]): string[] {
  const used = new Set<string>();
  return members.map((m) => {
    for (const c of [m.marker ?? '', autoMarker(m.key)]) {
      if (c && !used.has(c)) {
        used.add(c);
        return c;
      }
    }
    return '';
  });
}

/** Where to draw a symbol in a rectangle: a centred square `share` of its smaller side, as an SVG transform. */
export function markerTransform(rect: Box, share = 0.66): string {
  const side = Math.min(rect.w, rect.h) * share;
  const k = side / 24;
  const x = rect.x + (rect.w - side) / 2;
  const y = rect.y + (rect.h - side) / 2;
  const r = (n: number) => Math.round(n * 100) / 100;
  return `translate(${r(x)} ${r(y)}) scale(${r(k * 1000) / 1000})`;
}

/** A symbol as SVG markup in a rectangle (for string renderers). Null for text markers. */
export function markerSvg(marker: string, rect: Box, colour: string, share = 0.66): string | null {
  const sym = markerSymbol(marker);
  if (!sym) return null;
  const inner = sym.transform ? `<g transform="${sym.transform}">` : '';
  const paint = sym.fill
    ? `fill="${colour}" stroke="none"`
    : `fill="none" stroke="${colour}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"`;
  return `<g class="marker" transform="${markerTransform(rect, share)}">${inner}<path d="${sym.d}" ${paint}/>${inner ? '</g>' : ''}</g>`;
}
