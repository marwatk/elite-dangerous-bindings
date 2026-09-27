/**
 * Renders a card to a standalone SVG string. The same markup is shown on the
 * page, downloaded as SVG, rasterised to PNG and converted to PDF, so what
 * you see is what you print. All text is XML-escaped here.
 */
import { InputRef } from '../../core/binds/binds-document';
import { Card, CardEntry, DeviceCard, KeyboardCard, ModifierInfo, cardEntries, modifiersOnCard } from './card-model';
import { KEYBOARD_HEIGHT_U, KEYBOARD_WIDTH_U, KeyCap, keyboardLayout } from './keyboard-layout';
import {
  CARD_GROUPS,
  CATEGORY_COLOURS,
  CATEGORY_ORDER,
  ColourScheme,
  GROUP_COLOURS,
  INK,
  MUTED_INK,
  colourFor,
  groupLabel,
  modifierColour,
} from './palette';
import { FitItem, FitResult, Measure, fitStacked, fitText } from './text-fit';

export type KeyboardStyle = 'graphic' | 'list';

export interface RenderContext {
  scheme: ColourScheme;
  measure: Measure;
  /** SVG font-family for all text. */
  fontFamily: string;
  /** Optional @font-face rules embedded in the SVG. */
  fontCss?: string;
  /** Device artwork URL (device cards). */
  imageHref?: string | null;
  image?: { width: number; height: number } | null;
  keyboardStyle: KeyboardStyle;
  /** Keyboard cap text for an Elite key name. */
  keyLabel: (key: string) => string;
  /** "Device › Control" for the modifier legend. */
  inputLabel: (ref: InputRef) => string;
  /** Short control name for keyboard-list chips. */
  controlLabel: (ref: InputRef) => string;
  modifiers: readonly ModifierInfo[];
  footer: { preset: string; file: string; date: string };
}

export interface RenderedCard {
  id: string;
  name: string;
  svg: string;
  width: number;
  height: number;
}

export const CARD_WIDTH = 3840;
const SEP_COLOUR = '#9a9a9a';

// ------------------------------------------------------------ helpers

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function n(v: number): string {
  return String(Math.round(v * 10) / 10);
}

interface Coloured extends FitItem {
  fill: string;
}

/** Draw a fit result into a box: lines vertically centred, left aligned. */
function drawFit(
  fit: FitResult,
  items: Coloured[],
  x: number,
  y: number,
  height: number,
  opts: { align?: 'start' | 'middle'; width?: number } = {},
): string {
  if (!fit.lines.length) return '';
  const total = fit.size + (fit.lines.length - 1) * fit.lineHeight;
  const top = y + (height - total) / 2;
  let out = '';
  fit.lines.forEach((line, i) => {
    // Baseline: roughly centre the cap height within the line's em box.
    const base = top + i * fit.lineHeight + fit.size * 0.8;
    const lineWidth = line.length ? line.at(-1)!.x + line.at(-1)!.width : 0;
    const dx = opts.align === 'middle' && opts.width ? (opts.width - lineWidth) / 2 : 0;
    out += `<text y="${n(base)}" font-size="${n(fit.size)}" xml:space="preserve">`;
    for (const r of line) {
      const it = r.item >= 0 ? items[r.item] : null;
      const fill = it ? it.fill : SEP_COLOUR;
      const weight = r.bold ? ' font-weight="700"' : '';
      out += `<tspan x="${n(x + dx + r.x)}" fill="${fill}"${weight}>${esc(r.text)}</tspan>`;
    }
    out += '</text>';
  });
  return out;
}

function fitLine(
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  measure: Measure,
  opts: { size: number; bold?: boolean; fill?: string; min?: number; align?: 'start' | 'middle' },
): string {
  const items: Coloured[] = [{ text, bold: opts.bold, fill: opts.fill ?? INK }];
  const fit = fitText(items, width, height, measure, { maxSize: opts.size, minSize: opts.min ?? 8, onePerLine: true });
  return drawFit(fit, items, x, y, height, { align: opts.align, width });
}

function entryItems(entries: CardEntry[], scheme: ColourScheme): Coloured[] {
  return entries.map((e) => ({ text: e.text, bold: e.kind === 'modifier', fill: colourFor(e, scheme) }));
}

function svgOpen(width: number, height: number, ctx: RenderContext, title: string): string {
  const style = ctx.fontCss ? `<defs><style>${ctx.fontCss.replace(/<\//g, '<\\/')}</style></defs>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
    `font-family="${esc(ctx.fontFamily)}" role="img" aria-label="${esc(title)}">` +
    `<title>${esc(title)}</title>${style}<rect width="${width}" height="${height}" fill="#ffffff"/>`
  );
}

// ------------------------------------------------------------ footer + legend

export const FOOTER_HEIGHT = 250;

function legendItems(card: Card, ctx: RenderContext): Coloured[] {
  const entries = cardEntries(card).filter((e) => e.kind === 'action');
  const items: Coloured[] = [];
  if (ctx.scheme === 'group') {
    const groups = new Set(entries.map((e) => e.group));
    for (const g of CARD_GROUPS) {
      if (groups.has(g.value)) items.push({ text: g.label, fill: GROUP_COLOURS[g.value] ?? INK, bold: true });
    }
  } else if (ctx.scheme === 'category') {
    const cats = new Set(entries.map((e) => e.category));
    for (const c of CATEGORY_ORDER) {
      if (cats.has(c)) items.push({ text: c, fill: CATEGORY_COLOURS[c] ?? INK, bold: true });
    }
  }
  const used = modifiersOnCard(card);
  for (const m of ctx.modifiers) {
    if (!used.has(m.number)) continue;
    const keys = m.keys.map((k) => ctx.inputLabel(k)).join(' + ');
    items.push({
      text: `[${m.number}] = ${keys}`,
      fill: ctx.scheme === 'modifier' ? modifierColour(m.number) : INK,
      bold: false,
    });
  }
  if (entries.some((e) => e.hold)) items.push({ text: '(hold) = hold down', fill: INK });
  return items;
}

function footer(card: Card, ctx: RenderContext, y: number, width: number): string {
  const s = width / CARD_WIDTH;
  const m = ctx.measure;
  const pad = 40 * s;
  const leftW = 1300 * s;
  let out = `<line x1="${n(pad)}" x2="${n(width - pad)}" y1="${n(y + 12 * s)}" y2="${n(y + 12 * s)}" stroke="#999" stroke-width="${n(3 * s)}"/>`;
  out += fitLine(card.name, pad, y + 36 * s, leftW, 64 * s, m, { size: 60 * s, bold: true });
  const meta = [ctx.footer.preset && `Preset: ${ctx.footer.preset}`, ctx.footer.file, ctx.footer.date].filter(Boolean).join(' · ');
  out += fitLine(meta, pad, y + 110 * s, leftW, 46 * s, m, { size: 40 * s });
  out += fitLine('Made with Elite Dangerous Bindings', pad, y + 170 * s, leftW, 40 * s, m, {
    size: 32 * s,
    fill: MUTED_INK,
  });
  const items = legendItems(card, ctx);
  if (items.length) {
    const lx = pad + leftW + 60 * s;
    const lw = width - lx - pad;
    const lh = FOOTER_HEIGHT * s - 50 * s;
    const fit = fitText(items, lw, lh, m, { maxSize: 38 * s, minSize: 10 * s, separator: '     ' });
    out += drawFit(fit, items, lx, y + 36 * s, lh);
  }
  return out;
}

// ------------------------------------------------------------ device card

function renderDevice(card: DeviceCard, ctx: RenderContext): RenderedCard {
  const img = ctx.image ?? { width: CARD_WIDTH, height: 2160 };
  const s = img.width / CARD_WIDTH;
  const width = img.width;
  const height = img.height + FOOTER_HEIGHT * s;
  let out = svgOpen(width, height, ctx, card.name);
  if (ctx.imageHref) {
    out += `<image href="${esc(ctx.imageHref)}" xlink:href="${esc(ctx.imageHref)}" x="0" y="0" width="${img.width}" height="${img.height}" preserveAspectRatio="none"/>`;
  }
  const padX = 6 * s;
  const padY = 2 * s;
  for (const spot of card.spots) {
    if (spot.image !== 0 || !spot.entries.length) continue;
    const items = entryItems(spot.entries, ctx.scheme);
    const b = spot.box;
    const fit = fitText(items, b.w - 2 * padX, b.h - 2 * padY, ctx.measure, {
      maxSize: 40 * s,
      minSize: 9 * s,
      lineHeight: 1.08,
    });
    out += `<g class="spot" data-controls="${esc(spot.controls.join(' '))}">`;
    out += drawFit(fit, items, b.x + padX, b.y + padY, b.h - 2 * padY);
    out += '</g>';
  }
  out += footer(card, ctx, img.height, width);
  out += '</svg>';
  return { id: card.id, name: card.name, svg: out, width, height };
}

// ------------------------------------------------------------ keyboard: graphic

const KB_MARGIN = 60;
const KB_TITLE = 220;
const KB_UNIT_H = 345;

function keyText(ctx: RenderContext, cap: KeyCap): string {
  return (cap.cap ?? ctx.keyLabel(cap.key)).replace(/\\n|\n/g, ' ');
}

function renderKeyboardGraphic(card: KeyboardCard, ctx: RenderContext): RenderedCard {
  const width = CARD_WIDTH;
  const u = (width - 2 * KB_MARGIN) / KEYBOARD_WIDTH_U;
  const layout = keyboardLayout(card.keys.has('Key_OEM_102'));
  const onLayout = new Set(layout.flatMap((c) => [c.key, ...(c.aliases ?? [])]));
  const extra = [...card.keys.entries()].filter(([k]) => !onLayout.has(k));
  const extraH = extra.length ? 180 : 0;
  const kbTop = KB_TITLE;
  const kbBottom = kbTop + KEYBOARD_HEIGHT_U * KB_UNIT_H;
  const footY = kbBottom + 30 + extraH;
  const height = footY + FOOTER_HEIGHT;
  const m = ctx.measure;

  let out = svgOpen(width, height, ctx, card.name);
  out += fitLine('Elite: Dangerous Keyboard Bindings', 36, 40, width - 72, 130, m, { size: 118, bold: true });
  const gap = 10;
  for (const cap of layout) {
    const entries = [cap.key, ...(cap.aliases ?? [])].flatMap((k) => card.keys.get(k) ?? []);
    const x = KB_MARGIN + cap.x * u + gap / 2;
    const y = kbTop + cap.y * KB_UNIT_H + gap / 2;
    const w = cap.w * u - gap;
    const h = cap.h * KB_UNIT_H - gap;
    const bound = entries.length > 0;
    out += `<g class="key" data-key="${esc(cap.key)}">`;
    out += `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="14" fill="${bound ? '#ffffff' : '#f2f2f2'}" stroke="${bound ? '#222' : '#c4c4c4'}" stroke-width="${bound ? 4 : 3}"/>`;
    if (bound) {
      out += `<path d="M${n(x + 2)} ${n(y + 46)}h${n(w - 4)}" stroke="#d0d0d0" stroke-width="2"/>`;
    }
    out += fitLine(keyText(ctx, cap), x + 12, y + 6, w - 24, 38, m, {
      size: 30,
      bold: true,
      fill: bound ? INK : '#9a9a9a',
      min: 14,
    });
    if (bound) {
      const items = entryItems(entries, ctx.scheme);
      const fit = fitStacked(items, w - 20, h - 58, m, { maxSize: 32, minSize: 9, lineHeight: 1.1 });
      out += drawFit(fit, items, x + 10, y + 52, h - 58);
    }
    out += '</g>';
  }
  if (extra.length) {
    const items: Coloured[] = [];
    for (const [k, entries] of extra) {
      items.push({ text: `${ctx.keyLabel(k)}:`, bold: true, fill: INK });
      items.push(...entryItems(entries, ctx.scheme));
    }
    out += fitLine('Other keys', KB_MARGIN, kbBottom + 20, 600, 44, m, { size: 38, bold: true });
    const fit = fitText(items, width - 2 * KB_MARGIN, extraH - 60, m, { maxSize: 32, minSize: 10 });
    out += drawFit(fit, items, KB_MARGIN, kbBottom + 70, extraH - 60);
  }
  out += footer(card, ctx, footY, width);
  out += '</svg>';
  return { id: card.id, name: card.name, svg: out, width, height };
}

// ------------------------------------------------------------ keyboard: list

interface ListItem {
  kind: 'heading' | 'row';
  h: number;
  render: (x: number, y: number, w: number) => string;
}

function renderKeyboardList(card: KeyboardCard, ctx: RenderContext): RenderedCard {
  const width = CARD_WIDTH;
  const m = ctx.measure;
  const colGap = 50;
  const rowH = 52;
  const headH = 80;
  const chipSize = 26;
  const chipPad = 10;

  const chip = (label: string, x: number, y: number): { svg: string; w: number } => {
    const tw = (m(label, true) * chipSize) / 100;
    const w = tw + 2 * chipPad;
    const svg =
      `<rect x="${n(x)}" y="${n(y + 7)}" width="${n(w)}" height="${rowH - 14}" rx="7" fill="#f1f1f1" stroke="#555" stroke-width="2"/>` +
      `<text x="${n(x + chipPad)}" y="${n(y + rowH / 2 + chipSize * 0.36)}" font-size="${chipSize}" font-weight="700" fill="${INK}">${esc(label)}</text>`;
    return { svg, w };
  };

  const items: ListItem[] = [];
  const byGroup = new Map<string, KeyboardCard['rows']>();
  for (const r of card.rows) {
    const list = byGroup.get(r.entry.group) ?? [];
    list.push(r);
    byGroup.set(r.entry.group, list);
  }
  const groupOrder = [...CARD_GROUPS.map((g) => g.value), ...[...byGroup.keys()].filter((g) => !CARD_GROUPS.some((c) => c.value === g))];
  for (const g of groupOrder) {
    const rows = byGroup.get(g);
    if (!rows?.length) continue;
    const fill = ctx.scheme === 'group' ? (GROUP_COLOURS[g] ?? INK) : INK;
    items.push({
      kind: 'heading',
      h: headH,
      render: (x, y, w) => fitLine(groupLabel(g), x, y + 18, w, 54, m, { size: 46, bold: true, fill }),
    });
    for (const r of rows) {
      items.push({
        kind: 'row',
        h: rowH,
        render: (x, y, w) => {
          let out = '';
          let cx = x;
          for (const mod of r.modifiers) {
            const label = mod.device === 'Keyboard' ? ctx.keyLabel(mod.key) : ctx.controlLabel(mod);
            const c = chip(label.replace(/\\n|\n/g, ' '), cx, y);
            out += c.svg;
            cx += c.w;
            out += `<text x="${n(cx + 4)}" y="${n(y + rowH / 2 + 10)}" font-size="28" fill="${MUTED_INK}">+</text>`;
            cx += 26;
          }
          const c = chip(ctx.keyLabel(r.key).replace(/\\n|\n/g, ' '), cx, y);
          out += c.svg;
          cx += c.w + 14;
          const fill = colourFor(r.entry, ctx.scheme);
          out += fitLine(r.entry.text, cx, y + 4, x + w - cx, rowH - 8, m, { size: 32, fill, min: 14 });
          return out;
        },
      });
    }
  }

  // Balance columns; never leave a heading at the bottom of a column.
  const total = items.reduce((a, i) => a + i.h, 0);
  const cols = total > 130 * rowH ? 5 : 4;
  const colW = (width - 2 * KB_MARGIN - (cols - 1) * colGap) / cols;
  const target = Math.max(total / cols, rowH * 4);
  const columns: ListItem[][] = [[]];
  let colHeight = 0;
  items.forEach((it, i) => {
    const needed = it.kind === 'heading' ? it.h + (items[i + 1]?.h ?? 0) : it.h;
    if (colHeight > 0 && colHeight + needed > target + rowH && columns.length < cols) {
      columns.push([]);
      colHeight = 0;
    }
    columns.at(-1)!.push(it);
    colHeight += it.h;
  });
  const maxCol = Math.max(...columns.map((c) => c.reduce((a, i) => a + i.h, 0)), rowH);
  const top = KB_TITLE;
  const footY = top + maxCol + 40;
  const height = footY + FOOTER_HEIGHT;

  let out = svgOpen(width, height, ctx, card.name);
  out += fitLine('Elite: Dangerous Keyboard Bindings', 36, 40, width - 72, 130, m, { size: 118, bold: true });
  columns.forEach((col, ci) => {
    const x = KB_MARGIN + ci * (colW + colGap);
    let y = top;
    for (const it of col) {
      out += it.render(x, y, colW);
      y += it.h;
    }
  });
  if (!items.length) {
    out += fitLine('No keyboard bindings in the selected groups.', KB_MARGIN, top, 2000, 60, m, { size: 44, fill: MUTED_INK });
  }
  out += footer(card, ctx, footY, width);
  out += '</svg>';
  return { id: card.id, name: card.name, svg: out, width, height };
}

// ------------------------------------------------------------ entry point

export function renderCard(card: Card, ctx: RenderContext): RenderedCard {
  if (card.kind === 'device') return renderDevice(card, ctx);
  return ctx.keyboardStyle === 'list' ? renderKeyboardList(card, ctx) : renderKeyboardGraphic(card, ctx);
}
