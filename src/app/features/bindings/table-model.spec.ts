import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BindsDocument, InputRef } from '../../core/binds/binds-document';
import { ActionInfo } from '../../core/data/catalog.types';
import {
  BindingRow,
  EMPTY_FILTER,
  buildRows,
  csvCell,
  filterRows,
  sanitizeView,
  sortRows,
  toCsv,
  variableName,
} from './table-model';

const CUSTOM = readFileSync(resolve(process.cwd(), 'src/testing/fixtures/Custom.4.2.binds'), 'utf-8');
const ACTIONS: ActionInfo[] = JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/actions.json'), 'utf-8'));
const byCode = new Map(ACTIONS.map((a) => [a.code, a]));
const info = (code: string): ActionInfo =>
  byCode.get(code) ?? {
    code,
    name: code,
    longName: code,
    group: 'Misc',
    category: 'General',
    area: 'Other',
    section: 'Other',
    type: 'digital',
    order: 9999,
  };
const label = (r: InputRef) => `${r.device} › ${r.key}`;

function rows(conflicts: string[] = [], changed: string[] = []): BindingRow[] {
  const doc = BindsDocument.parse(CUSTOM);
  return buildRows(doc.actions(), info, label, new Set(conflicts), new Set(changed));
}

describe('buildRows', () => {
  it('makes one row per action with labels, flags and the bindED variable', () => {
    const all = rows(['LandingGearToggle'], ['YawAxisRaw']);
    const doc = BindsDocument.parse(CUSTOM);
    expect(all.length).toBe(doc.actionCodes().length);
    const yaw = all.find((r) => r.code === 'YawAxisRaw')!;
    expect(yaw.kind).toBe('axis');
    expect(yaw.primary?.label).toBe('044FB68F › Joy_ZAxis');
    expect(yaw.secondary).toBeNull();
    expect(yaw.changed).toBe(true);
    expect(yaw.variable).toBe('edYawAxisRaw');
    expect(yaw.devices).toEqual(['044FB68F::0']);
    const gear = all.find((r) => r.code === 'LandingGearToggle')!;
    expect(gear.conflict).toBe(true);
    expect(variableName('UI_Up')).toBe('edUI_Up');
  });

  it('includes modifiers in labels and device lists', () => {
    const doc = BindsDocument.parse(CUSTOM);
    doc.setSlot('BackwardKey', 'Primary', {
      device: 'Keyboard',
      key: 'Key_X',
      modifiers: [{ device: 'Mouse', key: 'Mouse_4' }],
      hold: true,
    });
    const r = buildRows(doc.actions(), info, label, new Set(), new Set()).find((x) => x.code === 'BackwardKey')!;
    expect(r.primary?.modifiers.map((m) => m.label)).toEqual(['Mouse › Mouse_4']);
    expect(r.hold).toBe(true);
    expect(r.devices).toContain('Mouse::0');
    expect(r.haystack).toContain('mouse › mouse_4');
  });
});

describe('filterRows', () => {
  const all = rows(['LandingGearToggle'], ['YawAxisRaw']);

  it('matches every word against name, code, area, section and controls', () => {
    expect(filterRows(all, { ...EMPTY_FILTER, text: 'landing gear' }).map((r) => r.code)).toContain('LandingGearToggle');
    expect(filterRows(all, { ...EMPTY_FILTER, text: 'BuggyTurretYAWAXISRAW' }).map((r) => r.code)).toEqual(['BuggyTurretYawAxisRaw']);
    expect(filterRows(all, { ...EMPTY_FILTER, text: 'joy_zaxis' }).some((r) => r.code === 'YawAxisRaw')).toBe(true);
    expect(filterRows(all, { ...EMPTY_FILTER, text: 'zzzz-nothing' })).toEqual([]);
  });

  it('applies group, device and status facets', () => {
    const srv = filterRows(all, { ...EMPTY_FILTER, group: 'SRV' });
    expect(srv.length).toBeGreaterThan(0);
    expect(srv.every((r) => r.group === 'SRV')).toBe(true);
    const mouse = filterRows(all, { ...EMPTY_FILTER, device: 'Mouse::0' });
    expect(mouse.length).toBeGreaterThan(0);
    expect(mouse.every((r) => r.devices.includes('Mouse::0'))).toBe(true);
    const bound = filterRows(all, { ...EMPTY_FILTER, status: 'bound' });
    const unbound = filterRows(all, { ...EMPTY_FILTER, status: 'unbound' });
    expect(bound.length + unbound.length).toBe(all.length);
    expect(filterRows(all, { ...EMPTY_FILTER, status: 'conflicts' }).map((r) => r.code)).toEqual(['LandingGearToggle']);
    expect(filterRows(all, { ...EMPTY_FILTER, status: 'changed' }).map((r) => r.code)).toEqual(['YawAxisRaw']);
  });
});

describe('sortRows', () => {
  const all = rows();

  it('keeps file order without a sort', () => {
    expect(sortRows(all, { active: '', direction: '' }).map((r) => r.code)).toEqual(all.map((r) => r.code));
  });

  it('sorts by action name both ways', () => {
    const asc = sortRows(all, { active: 'action', direction: 'asc' }).map((r) => r.name);
    const sorted = [...asc].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    expect(asc).toEqual(sorted);
    const desc = sortRows(all, { active: 'action', direction: 'desc' }).map((r) => r.name);
    expect(desc[0]).toBe(asc[asc.length - 1]);
  });

  it('puts unbound rows last whichever way a binding column is sorted', () => {
    for (const direction of ['asc', 'desc'] as const) {
      const s = sortRows(all, { active: 'primary', direction });
      const firstEmpty = s.findIndex((r) => !r.primary);
      expect(firstEmpty).toBeGreaterThan(0);
      expect(s.slice(firstEmpty).every((r) => !r.primary)).toBe(true);
    }
  });
});

describe('CSV', () => {
  it('quotes commas, quotes and newlines (RFC 4180)', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(' padded ')).toBe('" padded "');
    expect(csvCell(null)).toBe('');
    expect(csvCell(0.05)).toBe('0.05');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM')).toBe("'@SUM");
  });

  it('writes a header and one CRLF line per row', () => {
    const all = rows();
    const csv = toCsv(all.slice(0, 3));
    const lines = csv.split('\r\n');
    expect(lines[0].startsWith('Group,Area,Category,Action,Code,Type,Primary')).toBe(true);
    expect(lines.length).toBe(5); // header + 3 + trailing empty
    expect(lines[4]).toBe('');
    const yaw = toCsv(all.filter((r) => r.code === 'YawAxisRaw')).split('\r\n')[1];
    expect(yaw).toContain('YawAxisRaw,Axis,044FB68F › Joy_ZAxis');
    expect(yaw).toContain('edYawAxisRaw');
  });
});

describe('sanitizeView', () => {
  it('accepts valid saved state and rejects junk field by field', () => {
    const v = sanitizeView({
      filter: { text: 'gear', group: 'Ship', device: 'Keyboard::0', status: 'bound' },
      hidden: ['area', 'action', 'bogus'],
      sort: { active: 'primary', direction: 'desc' },
      pageSize: 50,
    });
    expect(v.filter).toEqual({ text: 'gear', group: 'Ship', device: 'Keyboard::0', status: 'bound' });
    expect(v.hidden).toEqual(['area']);
    expect(v.sort).toEqual({ active: 'primary', direction: 'desc' });
    expect(v.pageSize).toBe(50);
    const junk = sanitizeView({ filter: { status: 'nope', text: 3 }, sort: { active: 'x' }, pageSize: -1 });
    expect(junk.filter.status).toBe('all');
    expect(junk.filter.text).toBe('');
    expect(junk.sort).toEqual({ active: '', direction: '' });
    expect(junk.pageSize).toBe(100);
    expect(sanitizeView(null).hidden).toEqual([]);
  });
});
