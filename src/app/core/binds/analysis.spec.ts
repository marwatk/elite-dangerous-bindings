import { ActionMeta, conflictsFor, findAxisMisuse, findConflicts, isAxisKey, usesByInput } from './analysis';
import { BindsDocument } from './binds-document';

const FILE = `<?xml version="1.0" encoding="UTF-8" ?>
<Root PresetName="T" MajorVersion="4" MinorVersion="2">
\t<PrimaryFire>
\t\t<Primary Device="X" Key="Joy_1" />
\t\t<Secondary Device="{NoDevice}" Key="" />
\t</PrimaryFire>
\t<SecondaryFire>
\t\t<Primary Device="X" Key="Joy_1" />
\t\t<Secondary Device="{NoDevice}" Key="" />
\t</SecondaryFire>
\t<CycleFireGroupNext>
\t\t<Primary Device="X" Key="Joy_1">
\t\t\t<Modifier Device="X" Key="Joy_5" />
\t\t</Primary>
\t\t<Secondary Device="{NoDevice}" Key="" />
\t</CycleFireGroupNext>
\t<BuggyPrimaryFireButton>
\t\t<Primary Device="X" Key="Joy_1" />
\t\t<Secondary Device="{NoDevice}" Key="" />
\t</BuggyPrimaryFireButton>
\t<CamPitchUp>
\t\t<Primary Device="X" Key="Joy_2" />
\t\t<Secondary Device="{NoDevice}" Key="" />
\t</CamPitchUp>
\t<PitchUpButton>
\t\t<Primary Device="X" Key="Joy_2" />
\t\t<Secondary Device="{NoDevice}" Key="" />
\t</PitchUpButton>
\t<LandingGearToggle>
\t\t<Primary Device="X" Key="Joy_ZAxis" />
\t\t<Secondary Device="X" Key="Pos_Joy_ZAxis" />
\t</LandingGearToggle>
\t<ThrottleAxis>
\t\t<Binding Device="X" Key="Joy_ZAxis" />
\t\t<Inverted Value="0" />
\t\t<Deadzone Value="0.00000000" />
\t</ThrottleAxis>
</Root>
`;

const META: Record<string, ActionMeta> = {
  PrimaryFire: { group: 'Ship', type: 'digital' },
  SecondaryFire: { group: 'Ship', type: 'digital' },
  CycleFireGroupNext: { group: 'Ship', type: 'digital' },
  BuggyPrimaryFireButton: { group: 'SRV', type: 'digital' },
  CamPitchUp: { group: 'Ship', type: 'digital', hideIfSameAs: ['PitchUpButton'] },
  PitchUpButton: { group: 'Ship', type: 'digital' },
  LandingGearToggle: { group: 'Ship', type: 'digital' },
  ThrottleAxis: { group: 'Ship', type: 'analogue' },
};
const meta = (code: string) => META[code];
const actions = BindsDocument.parse(FILE).actions();

describe('findConflicts', () => {
  const conflicts = findConflicts(actions, meta);

  it('reports two actions on the same input, group and modifiers', () => {
    const c = conflicts.find((x) => x.input === 'X::0::Joy_1');
    expect(c).toBeDefined();
    expect(c!.uses.map((u) => u.code).sort()).toEqual(['PrimaryFire', 'SecondaryFire']);
  });

  it('ignores the same input with different modifiers or in another group', () => {
    const codes = conflicts.flatMap((c) => c.uses.map((u) => u.code));
    expect(codes).not.toContain('CycleFireGroupNext');
    expect(codes).not.toContain('BuggyPrimaryFireButton');
  });

  it('ignores intentional specialisations (hideIfSameAs)', () => {
    expect(conflicts.find((c) => c.input === 'X::0::Joy_2')).toBeUndefined();
  });
});

describe('findAxisMisuse', () => {
  it('flags digital actions bound to a whole axis but not to axis halves', () => {
    const misuse = findAxisMisuse(actions, meta);
    expect(misuse.map((u) => `${u.code}/${u.slot}`)).toEqual(['LandingGearToggle/Primary']);
  });

  it('recognises axis keys', () => {
    expect(isAxisKey('Joy_RZAxis')).toBe(true);
    expect(isAxisKey('GamePad_LStickX')).toBe(true);
    expect(isAxisKey('Pos_Joy_ZAxis')).toBe(false);
    expect(isAxisKey('Joy_3')).toBe(false);
    expect(isAxisKey('GamePad_LTrigger')).toBe(false);
  });
});

describe('conflictsFor', () => {
  it('lists what a proposed binding would clash with', () => {
    const clash = conflictsFor(actions, meta, 'PitchUpButton', 'Secondary', { device: 'X', key: 'Joy_1', modifiers: [] });
    expect(clash.map((u) => u.code).sort()).toEqual(['PrimaryFire', 'SecondaryFire']);
  });

  it('respects modifiers and the action being edited', () => {
    expect(
      conflictsFor(actions, meta, 'PrimaryFire', 'Primary', { device: 'X', key: 'Joy_1', modifiers: [{ device: 'X', key: 'Joy_5' }] })
        .map((u) => u.code),
    ).toEqual(['CycleFireGroupNext']);
  });
});

describe('usesByInput', () => {
  it('groups uses by physical input', () => {
    const map = usesByInput(actions);
    expect(map.get('X::0::Joy_1')!.length).toBe(4);
    expect(map.get('X::0::Joy_ZAxis')!.map((u) => u.code).sort()).toEqual(['LandingGearToggle', 'ThrottleAxis']);
  });
});
