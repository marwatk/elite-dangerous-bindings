import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BindsDocument } from '../../core/binds/binds-document';
import { describeSlot } from '../../core/state/bindings-store.service';
import { countDeviceUse } from './bulk-model';
import { flagValueText, parseDescribedSlot } from './changes-model';
import { backupFileName, bindsFileName, presetNameError } from './export-model';
import { applyMerge, effectiveMerge, groupCandidates, mergeCandidates } from './merge';
import { describeSettings, enumLabel, formatSettingNumber, settingFamily } from './settings-model';
import { buildWarnings } from './warnings-model';

const fixture = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const CUSTOM = fixture('src/testing/fixtures/Custom.4.2.binds');
const EMPTY = fixture('public/data/templates/Empty.4.2.binds');
const GROUPS: Record<string, string> = Object.fromEntries(
  (JSON.parse(fixture('public/data/actions.json')) as { code: string; group: string }[]).map((a) => [a.code, a.group]),
);
const group = (c: string) => GROUPS[c] ?? 'Misc';

describe('settings', () => {
  const doc = BindsDocument.parse(CUSTOM);
  const tpl = BindsDocument.parse(EMPTY);
  const reference = new Map(tpl.settingCodes().map((c) => [c, tpl.getSetting(c) ?? '']));
  const fields = describeSettings(doc.settingCodes(), (c) => doc.getSetting(c), (c) => c, reference);
  const f = (code: string) => fields.find((x) => x.code === code)!;

  it('lists each setting once (the game writes MouseGUI twice)', () => {
    expect(doc.settingCodes().filter((c) => c === 'MouseGUI').length).toBe(2);
    expect(fields.filter((x) => x.code === 'MouseGUI').length).toBe(1);
  });

  it('recognises 8-decimal numbers, integers and enums', () => {
    expect(f('MouseSensitivity')).toMatchObject({ type: 'decimal', decimals: 8, value: '1.00000000' });
    expect(f('MouseGUI').type).toBe('integer');
    const yMode = f('MouseTurretYMode');
    expect(yMode.type).toBe('enum');
    expect(yMode.options).toContain('Bindings_MousePitch');
    expect(yMode.options).toContain('Bindings_MouseYaw');
    expect(yMode.options[0]).toBe('');
    // Blank in the file but the family's values are known.
    expect(f('MouseXMode').type).toBe('enum');
    expect(f('MuteButtonMode').options).toEqual(['', 'mute_pushToTalk', 'mute_toggle']);
    expect(f('LeftPanelFocusOptions').options).toContain('FocusOption_Show');
  });

  it('formats numbers as the file does', () => {
    expect(formatSettingNumber({ type: 'decimal', decimals: 8 }, 0.5)).toBe('0.50000000');
    expect(formatSettingNumber({ type: 'decimal', decimals: 8 }, 31.54279137)).toBe('31.54279137');
    expect(formatSettingNumber({ type: 'integer', decimals: 0 }, 1.6)).toBe('2');
    expect(formatSettingNumber({ type: 'decimal', decimals: 8 }, NaN)).toBe('');
  });

  it('groups related settings and labels values', () => {
    expect(settingFamily('FSSMouseXMode')).toBe('mouseAxis');
    expect(settingFamily('PitchCameraMouse')).toBe('mouseAxis');
    expect(settingFamily('YawToRollMode_FAOff')).toBe('yawToRoll');
    expect(enumLabel('Bindings_MousePitchInverted')).toBe('Mouse Pitch Inverted');
    expect(enumLabel('mute_pushToTalk')).toBe('Push To Talk');
    expect(enumLabel('')).toBe('Not set');
  });
});

describe('merge', () => {
  it('finds actions in both files, applies the chosen ones and nothing else', () => {
    const target = BindsDocument.parse(EMPTY);
    const source = BindsDocument.parse(CUSTOM);
    const list = mergeCandidates(target.actions(), source.actions(), group);
    expect(list.length).toBeGreaterThan(300);
    const yaw = list.find((c) => c.code === 'YawAxisRaw')!;
    expect(yaw).toMatchObject({ differs: true, sourceBound: true, group: 'Ship' });
    const groups = groupCandidates(list);
    expect([...groups.keys()]).toContain('SRV');

    const srv = new Set(groups.get('SRV')!.map((c) => c.code));
    const codes = effectiveMerge(list, srv);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.every((c) => group(c) === 'SRV')).toBe(true);

    const n = applyMerge(target, source.actions(), codes);
    expect(n).toBe(codes.length);
    for (const c of codes) {
      const a = target.getAction(c)!;
      const b = source.getAction(c)!;
      for (const s of Object.keys(b.slots) as ('Primary' | 'Secondary' | 'Binding')[]) {
        expect(describeSlot(a.slots[s])).toBe(describeSlot(b.slots[s]));
      }
    }
    // Ship bindings untouched.
    expect(describeSlot(target.getAction('YawAxisRaw')!.slots.Binding)).toBe('');
  });

  it('ignores selected actions that are identical', () => {
    const a = BindsDocument.parse(CUSTOM);
    const list = mergeCandidates(a.actions(), a.actions(), group);
    expect(list.every((c) => !c.differs)).toBe(true);
    expect(effectiveMerge(list, new Set(list.map((c) => c.code)))).toEqual([]);
  });
});

describe('changes', () => {
  it('parses the store’s slot description back into a binding', () => {
    const slot = {
      device: 'SaitekX56Joystick',
      key: 'Joy_3',
      deviceIndex: 1,
      modifiers: [{ device: 'Keyboard', key: 'Key_LeftShift' }],
      hold: true,
    };
    const text = describeSlot(slot);
    expect(parseDescribedSlot(text)).toEqual(slot);
    expect(parseDescribedSlot('')).toBeNull();
    expect(parseDescribedSlot(describeSlot({ device: 'XB360 Pad', key: 'Pad_A', modifiers: [], hold: false }))).toEqual({
      device: 'XB360 Pad',
      key: 'Pad_A',
      modifiers: [],
      hold: false,
    });
  });

  it('describes flag values', () => {
    expect(flagValueText({ slot: 'Deadzone' }, '0.05')).toBe('5%');
    expect(flagValueText({ slot: 'Inverted' }, 'true')).toBe('on');
    expect(flagValueText({ slot: 'ToggleOn' }, '')).toBe('not set');
  });
});

describe('export helpers', () => {
  it('names files and backups the way the game and README expect', () => {
    expect(bindsFileName('MyHOTAS', 4, 1)).toBe('MyHOTAS.4.1.binds');
    expect(bindsFileName('', 3, 0)).toBe('Custom.3.0.binds');
    expect(backupFileName('Custom.4.2.binds', new Date(2026, 8, 26, 7, 5, 3))).toBe('Custom.4.2.20260926-070503.bak');
  });

  it('rejects preset names Windows can’t store', () => {
    expect(presetNameError('My HOTAS')).toBeNull();
    expect(presetNameError('')).not.toBeNull();
    expect(presetNameError('a/b')).not.toBeNull();
    expect(presetNameError('what?')).not.toBeNull();
    expect(presetNameError('trailing.')).not.toBeNull();
  });
});

describe('warnings and bulk counts', () => {
  const meta = (c: string) => ({ group: group(c), type: 'digital' as const });

  it('reports unknown devices, the TARGET virtual device and no-supported files', () => {
    const doc = BindsDocument.parse(CUSTOM);
    const known = new Set(['ThrustMasterTFlightHOTASX', '044FB68F', '044FB351', '044FB352']);
    const r = buildWarnings(doc.actions(), meta, doc.devicesUsed(), (d) => known.has(d));
    expect(r.unknownDevices).toEqual([]);
    expect(r.targetVirtual).toBe(false);
    expect(r.noSupported).toBe(false);

    doc.replaceDevice('ThrustMasterTFlightHOTASX', 'ThrustMasterWarthogCombined');
    const r2 = buildWarnings(doc.actions(), meta, doc.devicesUsed(), (d) => known.has(d));
    expect(r2.targetVirtual).toBe(true);
    expect(r2.unknownDevices.map((d) => d.device)).toEqual(['ThrustMasterWarthogCombined']);

    const onlyUnknown = buildWarnings([], meta, [{ device: 'ABCD1234', deviceIndex: 0 }], () => false);
    expect(onlyUnknown.noSupported).toBe(true);
    expect(onlyUnknown.count).toBe(2);
    const empty = buildWarnings([], meta, [], () => false);
    expect(empty).toMatchObject({ empty: true, noSupported: false, count: 0 });
  });

  it('counts slots and modifier references for a device', () => {
    const doc = BindsDocument.parse(CUSTOM);
    const c = countDeviceUse(doc.actions(), 'Mouse', 0);
    expect(c.slots).toBeGreaterThan(0);
    expect(c.refs).toBeGreaterThanOrEqual(c.slots);
    const n = doc.clearDevice('Mouse', 0);
    expect(n).toBe(c.slots);
  });
});
