/**
 * Best-fit text layout for control boxes (EDRefCard's layoutText /
 * calculateBestFitFontSize): choose the largest font size at which all items
 * fit in the box, flowing items onto more lines when the box is tall enough.
 * Pure: text widths come from a `measure` function.
 */

/** Font size (px) at which `Measure` reports widths; widths scale linearly with size. */
export const REF_SIZE = 100;

/** Width of `text` in px at REF_SIZE. */
export type Measure = (text: string, bold: boolean) => number;

export interface FitItem {
  text: string;
  bold?: boolean;
}

export interface FitOptions {
  maxSize?: number;
  minSize?: number;
  /** Line height as a multiple of the font size. */
  lineHeight?: number;
  /** Size step when searching. */
  step?: number;
  /** Text drawn between items on the same line; ignored with `onePerLine`. */
  separator?: string;
  /** Start every item on a new line (keyboard keys). */
  onePerLine?: boolean;
}

export interface FitRun {
  /** Index into the items, or -1 for a separator / ellipsis. */
  item: number;
  text: string;
  /** Offset from the box's left edge, px. */
  x: number;
  width: number;
  bold: boolean;
}

export interface FitResult {
  size: number;
  lineHeight: number;
  lines: FitRun[][];
  /** Some text did not fit even at the minimum size. */
  truncated: boolean;
}

const ELLIPSIS = '…';

interface Metrics {
  full: number[];
  words: { text: string; w: number }[][];
  space: number[];
  sep: number;
  ellipsis: number;
}

function metrics(items: FitItem[], measure: Measure, sep: string): Metrics {
  return {
    full: items.map((i) => measure(i.text, !!i.bold)),
    words: items.map((i) => i.text.split(/ +/).map((t) => ({ text: t, w: measure(t, !!i.bold) }))),
    space: items.map((i) => measure(' ', !!i.bold)),
    sep: sep ? measure(sep, false) : 0,
    ellipsis: measure(ELLIPSIS, false),
  };
}

/**
 * Flow the items at `size` into lines of `width`. Items are kept whole when
 * they fit on a line; longer items wrap at spaces. Returns null when a single
 * word is wider than the box.
 */
function flow(items: FitItem[], m: Metrics, size: number, width: number, opts: Required<FitOptions>): FitRun[][] | null {
  const k = size / REF_SIZE;
  const sepW = opts.onePerLine ? 0 : m.sep * k;
  const lines: FitRun[][] = [[]];
  let x = 0;
  const newline = () => {
    lines.push([]);
    x = 0;
  };
  for (let i = 0; i < items.length; i++) {
    const bold = !!items[i].bold;
    const w = m.full[i] * k;
    if (x > 0 && opts.onePerLine) newline();
    const gap = x > 0 ? sepW : 0;
    if (x + gap + w <= width) {
      if (gap) lines.at(-1)!.push({ item: -1, text: opts.separator, x, width: gap, bold: false });
      lines.at(-1)!.push({ item: i, text: items[i].text, x: x + gap, width: w, bold });
      x += gap + w;
      continue;
    }
    if (w <= width) {
      newline();
      lines.at(-1)!.push({ item: i, text: items[i].text, x: 0, width: w, bold });
      x = w;
      continue;
    }
    // Wrap a long item at word boundaries, starting on its own line.
    if (x > 0) newline();
    const space = m.space[i] * k;
    let run: { text: string; w: number } | null = null;
    for (const word of m.words[i]) {
      const ww = word.w * k;
      if (ww > width) return null;
      if (!run) run = { text: word.text, w: ww };
      else if (run.w + space + ww <= width) run = { text: `${run.text} ${word.text}`, w: run.w + space + ww };
      else {
        lines.at(-1)!.push({ item: i, text: run.text, x: 0, width: run.w, bold });
        newline();
        run = { text: word.text, w: ww };
      }
    }
    if (run) {
      lines.at(-1)!.push({ item: i, text: run.text, x: 0, width: run.w, bold });
      x = run.w;
    }
  }
  return lines.filter((l) => l.length);
}

function blockHeight(lines: number, size: number, lh: number): number {
  return lines <= 0 ? 0 : size + (lines - 1) * size * lh;
}

/** Largest size (≤ maxSize) at which all items fit in width × height. */
export function fitText(
  items: FitItem[],
  width: number,
  height: number,
  measure: Measure,
  options: FitOptions = {},
): FitResult {
  const opts: Required<FitOptions> = {
    maxSize: 40,
    minSize: 10,
    lineHeight: 1.12,
    step: 0.5,
    separator: ' · ',
    onePerLine: false,
    ...options,
  };
  if (!items.length || width <= 0 || height <= 0) {
    return { size: opts.maxSize, lineHeight: opts.maxSize * opts.lineHeight, lines: [], truncated: items.length > 0 };
  }
  const m = metrics(items, measure, opts.separator);
  const cap = Math.min(opts.maxSize, height);
  for (let size = cap; size >= opts.minSize; size -= opts.step) {
    const lines = flow(items, m, size, width, opts);
    if (lines && blockHeight(lines.length, size, opts.lineHeight) <= height) {
      return { size, lineHeight: size * opts.lineHeight, lines, truncated: false };
    }
  }
  return truncate(items, m, measure, width, height, opts);
}

/** Last resort: minimum size, cut words and lines, and end with an ellipsis. */
function truncate(
  items: FitItem[],
  m: Metrics,
  measure: Measure,
  width: number,
  height: number,
  opts: Required<FitOptions>,
): FitResult {
  const size = Math.min(opts.minSize, height);
  const k = size / REF_SIZE;
  // Shorten words wider than the box so the flow can succeed.
  const cut = (text: string, bold: boolean, max: number): string => {
    if (measure(text, bold) * k <= max) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if ((measure(text.slice(0, mid), bold) + m.ellipsis) * k <= max) lo = mid;
      else hi = mid - 1;
    }
    return text.slice(0, lo) + ELLIPSIS;
  };
  const safe = items.map((it) => ({
    ...it,
    text: it.text
      .split(/ +/)
      .map((w) => cut(w, !!it.bold, width))
      .join(' '),
  }));
  const sm = metrics(safe, measure, opts.separator);
  let lines = flow(safe, sm, size, width, opts) ?? [];
  const maxLines = Math.max(1, Math.floor((height - size) / (size * opts.lineHeight)) + 1);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const last = lines.at(-1)!;
    const ell = m.ellipsis * k;
    // Drop runs from the end until the ellipsis fits after the last one.
    while (last.length > 1 && last.at(-1)!.x + last.at(-1)!.width + ell > width) last.pop();
    while (last.length && last.at(-1)!.item === -1) last.pop();
    const end = last.length ? last.at(-1)!.x + last.at(-1)!.width : 0;
    if (end + ell <= width) last.push({ item: -1, text: ELLIPSIS, x: end, width: ell, bold: false });
    else if (last.length) {
      const r = last.at(-1)!;
      r.text = cut(r.text, r.bold, width - r.x);
      r.width = measure(r.text, r.bold) * k;
    }
  }
  return { size, lineHeight: size * opts.lineHeight, lines, truncated: true };
}

/**
 * Prefer one item per line (easiest to read), but fall back to flowing items
 * with separators when that allows a clearly larger font (crowded keys).
 */
export function fitStacked(
  items: FitItem[],
  width: number,
  height: number,
  measure: Measure,
  options: FitOptions = {},
  tolerance = 0.85,
): FitResult {
  const stacked = fitText(items, width, height, measure, { ...options, onePerLine: true });
  if (items.length < 2) return stacked;
  const flowed = fitText(items, width, height, measure, { ...options, onePerLine: false });
  if (stacked.truncated && !flowed.truncated) return flowed;
  return flowed.size * tolerance > stacked.size ? flowed : stacked;
}
