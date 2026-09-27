import { HidCollectionInfo, HidReportItem, isControllerCollection } from './hid-types';

/**
 * Turns WebHID's parsed report descriptor (`device.collections`) into a list
 * of fields with bit offsets, named the way DirectInput (and so Elite) names
 * them, and decodes input reports with it.
 *
 * Chromium adds every report item to its innermost collection *and to every
 * ancestor*, so a top-level collection's `inputReports` already lists all of
 * its items in descriptor order. We therefore read the top-level collections
 * only and recurse into children just when a top-level collection carries no
 * items itself (other implementations / hand-written test data).
 */

export const PAGE_GENERIC_DESKTOP = 0x01;
export const PAGE_SIMULATION = 0x02;
export const PAGE_BUTTON = 0x09;

export type HidFieldKind = 'button' | 'buttonArray' | 'axis' | 'hat' | 'other';

export interface HidField {
  kind: HidFieldKind;
  reportId: number;
  bitOffset: number;
  bitSize: number;
  usagePage: number;
  usage: number;
  logicalMin: number;
  logicalMax: number;
  signed: boolean;
  /**
   * Elite key: `Joy_5`, `Joy_XAxis`; `Joy_POV2` (prefix) for hats; '' when
   * the field has no Elite equivalent (shown in diagnostics only).
   */
  key: string;
  /** Hats: 1-based POV number. */
  pov?: number;
  /** Button arrays: usage range the values index into. */
  usageMin?: number;
  usageMax?: number;
}

export interface HidLayout {
  fields: HidField[];
  /** Fields per report ID. */
  reports: Map<number, HidField[]>;
  /** Bit length per report ID (without the report ID byte). */
  reportBits: Map<number, number>;
  buttons: number;
  axes: number;
  hats: number;
}

/** Generic Desktop usage -> Elite axis (X..Rz). Slider/Dial are assigned U then V in order. */
const GD_AXES: Record<number, string> = {
  0x30: 'Joy_XAxis',
  0x31: 'Joy_YAxis',
  0x32: 'Joy_ZAxis',
  0x33: 'Joy_RXAxis',
  0x34: 'Joy_RYAxis',
  0x35: 'Joy_RZAxis',
};
const GD_SLIDER = 0x36;
const GD_DIAL = 0x37;
const GD_WHEEL = 0x38;
const GD_HAT = 0x39;
const SIM_RUDDER = 0xba;
const SIM_THROTTLE = 0xbb;
const SIM_OTHER_AXES = new Set([0xb0, 0xb1, 0xb2, 0xc4, 0xc5, 0xc8]); // aileron/elevator/.., accelerator, brake, steering

export const HAT_DIRECTIONS = ['Up', 'Right', 'Down', 'Left'] as const;
export type HatDirection = (typeof HAT_DIRECTIONS)[number];
/** 8-way hat sectors clockwise from Up. */
export const HAT8: readonly HatDirection[][] = [
  ['Up'],
  ['Up', 'Right'],
  ['Right'],
  ['Right', 'Down'],
  ['Down'],
  ['Down', 'Left'],
  ['Left'],
  ['Up', 'Left'],
];

function splitUsage(u: number, item: HidReportItem): { page: number; id: number } {
  if (u > 0xffff) return { page: (u >>> 16) & 0xffff, id: u & 0xffff };
  return { page: item.usagePage ?? 0, id: u };
}

/** Usage for the k-th value of an item (the last usage repeats if there are fewer usages than values). */
function usageAt(item: HidReportItem, k: number): number | undefined {
  if (item.usages && item.usages.length) return item.usages[Math.min(k, item.usages.length - 1)];
  if (item.usageMinimum !== undefined) {
    const max = item.usageMaximum ?? item.usageMinimum;
    return Math.min(item.usageMinimum + k, max);
  }
  return undefined;
}

/** Fix logical ranges from descriptors that encode e.g. 65535 in two bytes (read back as -1). */
function logicalRange(item: HidReportItem, size: number): { min: number; max: number } {
  let min = item.logicalMinimum ?? 0;
  let max = item.logicalMaximum ?? (size >= 31 ? 0x7fffffff : 2 ** size - 1);
  if (max < min && min >= 0 && size < 32) max = max + 2 ** size;
  if (max < min && size < 32) max = 2 ** size - 1;
  return { min, max };
}

function reportsOf(col: HidCollectionInfo): HidCollectionInfo['inputReports'] {
  const own = col.inputReports ?? [];
  if (own.some((r) => (r.items ?? []).length)) return own;
  const out: NonNullable<HidCollectionInfo['inputReports']> = [];
  for (const child of col.children ?? []) out.push(...(reportsOf(child) ?? []));
  return out;
}

export function parseHidLayout(collections: readonly HidCollectionInfo[]): HidLayout {
  const tops = collections.some(isControllerCollection) ? collections.filter(isControllerCollection) : collections;
  const fields: HidField[] = [];
  const offsets = new Map<number, number>();
  const sims: HidField[] = [];
  let sliders = 0;
  let povs = 0;

  for (const col of tops) {
    for (const rep of reportsOf(col) ?? []) {
      const rid = rep.reportId ?? 0;
      let bit = offsets.get(rid) ?? 0;
      for (const item of rep.items ?? []) {
        const size = item.reportSize ?? 0;
        const count = item.reportCount ?? 0;
        if (!item.isConstant && size > 0) {
          const { min, max } = logicalRange(item, size);
          const signed = min < 0;
          const base = { reportId: rid, bitSize: size, logicalMin: min, logicalMax: max, signed };
          if (item.isArray) {
            // Array item: each value is an index into the usage list (0/out of range = nothing).
            const first = usageAt(item, 0);
            const { page, id } = first === undefined ? { page: 0, id: 0 } : splitUsage(first, item);
            const lastRaw = item.usageMaximum ?? item.usages?.at(-1) ?? first ?? 0;
            const last = splitUsage(lastRaw, item).id;
            for (let k = 0; k < count; k++) {
              fields.push({
                ...base,
                kind: page === PAGE_BUTTON ? 'buttonArray' : 'other',
                bitOffset: bit + k * size,
                usagePage: page,
                usage: id,
                usageMin: id,
                usageMax: last,
                key: '',
              });
            }
          } else {
            for (let k = 0; k < count; k++) {
              const raw = usageAt(item, k);
              const { page, id } = raw === undefined ? { page: 0, id: 0 } : splitUsage(raw, item);
              const f: HidField = { ...base, kind: 'other', bitOffset: bit + k * size, usagePage: page, usage: id, key: '' };
              if (page === PAGE_BUTTON && id > 0) {
                f.kind = 'button';
                f.key = `Joy_${id}`;
              } else if (page === PAGE_GENERIC_DESKTOP && GD_AXES[id]) {
                f.kind = 'axis';
                f.key = GD_AXES[id];
              } else if (page === PAGE_GENERIC_DESKTOP && (id === GD_SLIDER || id === GD_DIAL)) {
                f.kind = 'axis';
                f.key = sliders === 0 ? 'Joy_UAxis' : sliders === 1 ? 'Joy_VAxis' : '';
                sliders++;
              } else if (page === PAGE_GENERIC_DESKTOP && id === GD_HAT) {
                f.kind = 'hat';
                f.pov = ++povs;
                f.key = `Joy_POV${f.pov}`;
              } else if (
                (page === PAGE_SIMULATION && (id === SIM_RUDDER || id === SIM_THROTTLE || SIM_OTHER_AXES.has(id))) ||
                (page === PAGE_GENERIC_DESKTOP && id === GD_WHEEL)
              ) {
                f.kind = 'axis';
                sims.push(f);
              }
              fields.push(f);
            }
          }
        }
        bit += size * count;
      }
      offsets.set(rid, bit);
    }
  }

  // Simulation-page axes: DirectInput puts them in free axis slots. Rudder
  // prefers Rz, throttle prefers Z/slider. (Uncertain; confirm on hardware.)
  const used = new Set(fields.filter((f) => f.kind === 'axis' && f.key).map((f) => f.key));
  const take = (prefs: string[]) => {
    const k = prefs.find((p) => !used.has(p)) ?? '';
    if (k) used.add(k);
    return k;
  };
  for (const f of sims) {
    if (f.usagePage === PAGE_SIMULATION && f.usage === SIM_RUDDER) f.key = take(['Joy_RZAxis', 'Joy_ZAxis', 'Joy_UAxis', 'Joy_VAxis']);
    else f.key = take(['Joy_ZAxis', 'Joy_UAxis', 'Joy_VAxis', 'Joy_RXAxis', 'Joy_RYAxis', 'Joy_RZAxis']);
  }
  // A duplicated axis usage can't be told apart by the game: keep the first.
  const seenAxes = new Set<string>();
  for (const f of fields) {
    if (f.kind !== 'axis' || !f.key) continue;
    if (seenAxes.has(f.key)) f.key = '';
    else seenAxes.add(f.key);
  }

  const reports = new Map<number, HidField[]>();
  for (const f of fields) {
    const list = reports.get(f.reportId);
    if (list) list.push(f);
    else reports.set(f.reportId, [f]);
  }
  const buttonKeys = new Set<string>();
  for (const f of fields) {
    if (f.kind === 'button') buttonKeys.add(f.key);
    if (f.kind === 'buttonArray') for (let u = f.usageMin ?? 1; u <= (f.usageMax ?? 0); u++) buttonKeys.add(`Joy_${u}`);
  }
  return {
    fields,
    reports,
    reportBits: offsets,
    buttons: buttonKeys.size,
    axes: fields.filter((f) => f.kind === 'axis' && f.key).length,
    hats: povs,
  };
}

/** Read `size` bits little-endian starting at `bitOffset`. */
export function readBits(dv: DataView, bitOffset: number, size: number, signed = false): number {
  let v = 0;
  for (let i = 0; i < size; i++) {
    const bit = bitOffset + i;
    const byte = bit >> 3;
    if (byte >= dv.byteLength) break;
    if ((dv.getUint8(byte) >> (bit & 7)) & 1) v += 2 ** i;
  }
  if (signed && size > 0 && v >= 2 ** (size - 1)) v -= 2 ** size;
  return v;
}

/** Scale a raw axis value to -1..1 over its logical range. */
export function normalizeAxis(raw: number, min: number, max: number): number {
  const span = max - min;
  if (span <= 0) return 0;
  return Math.max(-1, Math.min(1, ((raw - min) / span) * 2 - 1));
}

/** Directions of a hat value; out-of-range (null) values are centred. */
export function hatValueDirections(raw: number, min: number, max: number): HatDirection[] {
  if (raw < min || raw > max) return [];
  const n = max - min + 1;
  if (n < 4) return [];
  const sector = Math.round(((raw - min) * 8) / n) % 8;
  return HAT8[sector] ?? [];
}

export interface DecodedReport {
  /** Pressed buttons and hat directions, e.g. `Joy_3`, `Joy_POV1Up`. */
  pressed: Set<string>;
  /** Axis values -1..1 by Elite key. */
  axes: Map<string, number>;
}

/** Decode one input report (data excludes the report ID byte, as WebHID delivers it). */
export function decodeReport(layout: HidLayout, reportId: number, dv: DataView): DecodedReport | null {
  const fields = layout.reports.get(reportId);
  if (!fields) return null;
  const pressed = new Set<string>();
  const axes = new Map<string, number>();
  for (const f of fields) {
    switch (f.kind) {
      case 'button':
        if (readBits(dv, f.bitOffset, f.bitSize) !== 0) pressed.add(f.key);
        break;
      case 'buttonArray': {
        const v = readBits(dv, f.bitOffset, f.bitSize, f.signed);
        if (v >= f.logicalMin && v <= f.logicalMax) {
          const usage = (f.usageMin ?? 0) + (v - f.logicalMin);
          if (usage > 0 && usage <= (f.usageMax ?? 0)) pressed.add(`Joy_${usage}`);
        }
        break;
      }
      case 'axis':
        if (f.key) axes.set(f.key, normalizeAxis(readBits(dv, f.bitOffset, f.bitSize, f.signed), f.logicalMin, f.logicalMax));
        break;
      case 'hat':
        for (const d of hatValueDirections(readBits(dv, f.bitOffset, f.bitSize, f.signed), f.logicalMin, f.logicalMax)) {
          pressed.add(`${f.key}${d}`);
        }
        break;
    }
  }
  return { pressed, axes };
}

/** Human-readable field list for diagnostics. */
export function describeField(f: HidField): string {
  const where = `r${f.reportId} @${f.bitOffset}+${f.bitSize}`;
  const usage = `${f.usagePage.toString(16).padStart(2, '0')}:${f.usage.toString(16).padStart(2, '0')}`;
  const range = `${f.logicalMin}..${f.logicalMax}`;
  const name =
    f.kind === 'buttonArray' ? `Joy_${f.usageMin}..Joy_${f.usageMax} (array)` : f.key || '(not used by the game)';
  return `${where}  usage ${usage}  ${f.kind}  ${range}  → ${name}`;
}

export function toHex(dv: DataView, max = 64): string {
  const out: string[] = [];
  for (let i = 0; i < Math.min(dv.byteLength, max); i++) out.push(dv.getUint8(i).toString(16).padStart(2, '0'));
  return out.join(' ') + (dv.byteLength > max ? ' …' : '');
}
