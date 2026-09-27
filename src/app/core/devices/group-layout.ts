/**
 * Geometry of a control group's box, shared by the card renderer, the device
 * diagram and the layout editor. Vertical space is scarce, so the group label
 * is a column on the left (text rotated to read bottom-to-top) spanning all
 * members; each member gets a marker cell and a text area:
 *
 *   stack:  | L | ↑ | text |      row:  | L | + text | − text |
 *           | a | → | text |
 *           | b | ↓ | text |
 */
import { Box, GroupLayoutKind } from '../data/catalog.types';
import { markerSymbol } from './markers';

export interface GroupShape {
  box: Box;
  layout?: GroupLayoutKind;
  showLabel?: boolean;
  members: readonly { key: string; marker: string }[];
}

export interface GroupCell {
  index: number;
  key: string;
  marker: string;
  /** The member's whole row (stack) or cell (row). */
  rect: Box;
  markerRect: Box;
  textRect: Box;
}

export interface GroupGeometry {
  /** Column for the rotated group label, or null with showLabel false. */
  labelRect: Box | null;
  /** Everything right of the label column. */
  bodyRect: Box;
  members: GroupCell[];
}

/** Text markers longer than two characters get a wider marker cell. */
function wideMarkers(members: GroupShape['members']): boolean {
  return members.some((m) => !markerSymbol(m.marker) && [...m.marker].length > 2);
}

export function groupLayout(g: GroupShape): GroupGeometry {
  const b = g.box;
  const n = Math.max(1, g.members.length);
  const stack = g.layout !== 'row';
  const rowH = stack ? b.h / n : b.h;
  const labelW = g.showLabel === false ? 0 : Math.min(b.w * 0.2, Math.max(rowH, b.h * 0.26));
  const body: Box = { x: b.x + labelW, y: b.y, w: b.w - labelW, h: b.h };
  const wide = wideMarkers(g.members) ? 1.6 : 1;
  const members = g.members.map((m, index): GroupCell => {
    if (stack) {
      const rect = { x: body.x, y: b.y + index * rowH, w: body.w, h: rowH };
      const mw = Math.min(rowH * wide, body.w * 0.3);
      return { index, key: m.key, marker: m.marker, rect, markerRect: { ...rect, w: mw }, textRect: { ...rect, x: rect.x + mw, w: rect.w - mw } };
    }
    const cw = body.w / n;
    const rect = { x: body.x + index * cw, y: b.y, w: cw, h: b.h };
    const mw = Math.min(b.h * wide, cw * 0.35);
    return { index, key: m.key, marker: m.marker, rect, markerRect: { ...rect, w: mw }, textRect: { ...rect, x: rect.x + mw, w: rect.w - mw } };
  });
  return { labelRect: labelW ? { x: b.x, y: b.y, w: labelW, h: b.h } : null, bodyRect: body, members };
}

/** Separator lines inside a group box (label column, marker column, between members) as SVG path data. */
export function groupDividers(geo: GroupGeometry, layout: GroupLayoutKind = 'stack'): string {
  const r = (v: number) => String(Math.round(v * 10) / 10);
  const b = geo.bodyRect;
  let d = '';
  if (geo.labelRect) d += `M${r(b.x)} ${r(b.y)}V${r(b.y + b.h)}`;
  geo.members.forEach((m, i) => {
    d += `M${r(m.markerRect.x + m.markerRect.w)} ${r(m.rect.y)}V${r(m.rect.y + m.rect.h)}`;
    if (i === 0) return;
    d += layout === 'row' ? `M${r(m.rect.x)} ${r(m.rect.y)}V${r(m.rect.y + m.rect.h)}` : `M${r(m.rect.x)} ${r(m.rect.y)}H${r(m.rect.x + m.rect.w)}`;
  });
  return d;
}
