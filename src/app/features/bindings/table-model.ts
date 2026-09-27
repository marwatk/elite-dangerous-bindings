import { ActionKind, ActionState, InputRef, SlotBinding, SlotName, isBound } from '../../core/binds/binds-document';
import { ActionInfo } from '../../core/data/catalog.types';

/** Table columns, in display order. */
export const ALL_COLUMNS = ['status', 'area', 'section', 'action', 'primary', 'secondary', 'flags', 'variable'] as const;
export type ColumnId = (typeof ALL_COLUMNS)[number];

export const COLUMN_LABELS: Record<ColumnId, string> = {
  status: 'Status',
  area: 'Group / Area',
  section: 'Category',
  action: 'Action',
  primary: 'Primary',
  secondary: 'Secondary',
  flags: 'Flags',
  variable: 'VoiceAttack variable',
};

/** Columns that can't be hidden. */
export const FIXED_COLUMNS: readonly ColumnId[] = ['action'];

export type StatusFilter = 'all' | 'bound' | 'unbound' | 'conflicts' | 'changed';

export interface TableFilter {
  text: string;
  /** Action group (Ship, SRV, …) or '' for all. */
  group: string;
  /** `device::index` or '' for all. */
  device: string;
  status: StatusFilter;
}

export const EMPTY_FILTER: TableFilter = { text: '', group: '', device: '', status: 'all' };

export interface TableSort {
  active: ColumnId | '';
  direction: 'asc' | 'desc' | '';
}

export interface LabelledRef {
  ref: InputRef;
  label: string;
}

export interface RowSlot {
  slot: SlotName;
  binding: SlotBinding;
  /** "Device › Control". */
  label: string;
  modifiers: LabelledRef[];
}

export interface BindingRow {
  code: string;
  name: string;
  group: string;
  area: string;
  section: string;
  order: number;
  index: number;
  kind: ActionKind;
  /** Primary column: the Primary slot, or the Binding for axis actions. */
  primary: RowSlot | null;
  secondary: RowSlot | null;
  toggleOn: boolean | null;
  inverted: boolean | null;
  deadzone: number | null;
  hold: boolean;
  variable: string;
  bound: boolean;
  conflict: boolean;
  /** Set when a binding is shared on purpose with another action (why, for a tooltip). */
  shared: string | null;
  changed: boolean;
  /** `device::index` of every device the action uses (slots and modifiers). */
  devices: string[];
  /** Lower-cased text the filter searches. */
  haystack: string;
}

export function deviceKey(r: { device: string; deviceIndex?: number }): string {
  return `${r.device}::${r.deviceIndex ?? 0}`;
}

/** bindED / VoiceAttack variable name for an action. */
export function variableName(code: string): string {
  return `ed${code}`;
}

/** Modifiers then control, e.g. "Keyboard › Left Shift + Keyboard › A". */
export function slotText(s: RowSlot | null): string {
  if (!s) return '';
  return [...s.modifiers.map((m) => m.label), s.label].join(' + ');
}

export function buildRows(
  actions: readonly ActionState[],
  info: (code: string) => ActionInfo,
  label: (ref: InputRef) => string,
  conflicts: ReadonlySet<string>,
  changed: ReadonlySet<string>,
  /** Code -> note for inputs this action shares on purpose with another action. */
  shared: ReadonlyMap<string, string> = new Map(),
): BindingRow[] {
  return actions.map((a, index) => {
    const meta = info(a.code);
    const rowSlot = (name: SlotName): RowSlot | null => {
      const b = a.slots[name];
      if (!b || !isBound(b)) return null;
      return {
        slot: name,
        binding: b,
        label: label(b),
        modifiers: b.modifiers.map((ref) => ({ ref, label: label(ref) })),
      };
    };
    const primary = a.kind === 'axis' ? rowSlot('Binding') : rowSlot('Primary');
    const secondary = a.kind === 'axis' ? null : rowSlot('Secondary');
    const devices = new Set<string>();
    for (const s of [primary, secondary]) {
      if (!s) continue;
      devices.add(deviceKey(s.binding));
      s.binding.modifiers.forEach((m) => devices.add(deviceKey(m)));
    }
    const variable = variableName(a.code);
    const haystack = [meta.longName, meta.name, a.code, meta.area, meta.section, meta.group, slotText(primary), slotText(secondary)]
      .join('\n')
      .toLowerCase();
    return {
      code: a.code,
      name: meta.longName,
      group: meta.group,
      area: meta.area,
      section: meta.section,
      order: meta.order,
      index,
      kind: a.kind,
      primary,
      secondary,
      toggleOn: a.toggleOn,
      inverted: a.inverted,
      deadzone: a.deadzone,
      hold: !!(primary?.binding.hold || secondary?.binding.hold),
      variable,
      bound: !!(primary || secondary),
      conflict: conflicts.has(a.code),
      shared: shared.get(a.code) ?? null,
      changed: changed.has(a.code),
      devices: [...devices],
      haystack,
    };
  });
}

export function filterRows(rows: readonly BindingRow[], f: TableFilter): BindingRow[] {
  const terms = f.text.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (f.group && r.group !== f.group) return false;
    if (f.device && !r.devices.includes(f.device)) return false;
    switch (f.status) {
      case 'bound':
        if (!r.bound) return false;
        break;
      case 'unbound':
        if (r.bound) return false;
        break;
      case 'conflicts':
        if (!r.conflict) return false;
        break;
      case 'changed':
        if (!r.changed) return false;
        break;
    }
    return terms.every((t) => r.haystack.includes(t));
  });
}

function sortKey(r: BindingRow, col: ColumnId): string | number {
  switch (col) {
    case 'status':
      return (r.conflict ? 2 : 0) + (r.changed ? 1 : 0);
    case 'area':
      return `${r.area}\u0000${r.group}`;
    case 'section':
      return r.section;
    case 'action':
      return r.name;
    case 'primary':
      return r.primary ? slotText(r.primary) : '';
    case 'secondary':
      return r.secondary ? slotText(r.secondary) : '';
    case 'flags':
      return (r.toggleOn ? 4 : 0) + (r.hold ? 2 : 0) + (r.inverted ? 1 : 0);
    case 'variable':
      return r.variable;
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Sort a copy of `rows`. Empty cells always go last; ties keep file order.
 * With no active sort the file order is returned.
 */
export function sortRows(rows: readonly BindingRow[], sort: TableSort): BindingRow[] {
  const out = [...rows];
  if (!sort.active || !sort.direction) return out.sort((a, b) => a.index - b.index);
  const col = sort.active;
  const dir = sort.direction === 'asc' ? 1 : -1;
  return out.sort((a, b) => {
    const x = sortKey(a, col);
    const y = sortKey(b, col);
    if (x === '' && y !== '') return 1;
    if (y === '' && x !== '') return -1;
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
    return c !== 0 ? c * dir : a.index - b.index;
  });
}

// ------------------------------------------------------------ CSV

/** One CSV field (RFC 4180), with spreadsheet formula injection neutralised. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADER = [
  'Group',
  'Area',
  'Category',
  'Action',
  'Code',
  'Type',
  'Primary',
  'Primary modifiers',
  'Secondary',
  'Secondary modifiers',
  'Hold',
  'Toggle on',
  'Inverted',
  'Deadzone',
  'VoiceAttack variable',
  'Conflict',
];

function yesNo(v: boolean | null): string {
  return v === null ? '' : v ? 'yes' : 'no';
}

/** CSV for the given rows (CRLF line endings, as spreadsheets expect). */
export function toCsv(rows: readonly BindingRow[]): string {
  const lines = [CSV_HEADER.map(csvCell).join(',')];
  for (const r of rows) {
    const mods = (s: RowSlot | null) => (s ? s.modifiers.map((m) => m.label).join(' + ') : '');
    lines.push(
      [
        r.group,
        r.area,
        r.section,
        r.name,
        r.code,
        r.kind === 'axis' ? 'Axis' : 'Button',
        r.primary?.label ?? '',
        mods(r.primary),
        r.secondary?.label ?? '',
        mods(r.secondary),
        r.hold ? 'yes' : '',
        yesNo(r.toggleOn),
        yesNo(r.inverted),
        r.deadzone === null ? '' : r.deadzone,
        r.variable,
        r.conflict ? 'yes' : '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

// ------------------------------------------------------------ persisted view state

export interface ViewState {
  filter: TableFilter;
  hidden: ColumnId[];
  sort: TableSort;
  pageSize: number;
}

export const DEFAULT_VIEW: ViewState = {
  filter: EMPTY_FILTER,
  hidden: [],
  sort: { active: '', direction: '' },
  pageSize: 100,
};

/** Accept only well-formed saved state; fall back to defaults field by field. */
export function sanitizeView(raw: unknown): ViewState {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<ViewState>;
  const f = (v.filter && typeof v.filter === 'object' ? v.filter : {}) as Partial<TableFilter>;
  const statuses: StatusFilter[] = ['all', 'bound', 'unbound', 'conflicts', 'changed'];
  const cols = ALL_COLUMNS as readonly string[];
  return {
    filter: {
      text: typeof f.text === 'string' ? f.text : '',
      group: typeof f.group === 'string' ? f.group : '',
      device: typeof f.device === 'string' ? f.device : '',
      status: statuses.includes(f.status as StatusFilter) ? (f.status as StatusFilter) : 'all',
    },
    hidden: Array.isArray(v.hidden)
      ? (v.hidden.filter((c) => cols.includes(c) && !FIXED_COLUMNS.includes(c)) as ColumnId[])
      : [],
    sort:
      v.sort && (cols.includes(v.sort.active) || v.sort.active === '') && ['asc', 'desc', ''].includes(v.sort.direction)
        ? { active: v.sort.active, direction: v.sort.direction }
        : DEFAULT_VIEW.sort,
    pageSize: typeof v.pageSize === 'number' && v.pageSize > 0 && v.pageSize <= 1000 ? v.pageSize : DEFAULT_VIEW.pageSize,
  };
}
