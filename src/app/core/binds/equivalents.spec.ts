import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ActionState, BindsDocument, SlotBinding } from './binds-document';
import { EQUIVALENT_FAMILIES, LinkGroup, familyOf, followAxisOption, suggestLinks } from './equivalents';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
// Axis vs button from the game's own template (<Binding> = axis); it matches the current game exactly.
const TEMPLATE = BindsDocument.parse(read('public/data/templates/Empty.4.2.binds'));
const TYPES = new Map(TEMPLATE.actions().map((a) => [a.code, a.kind === 'axis' ? 'analogue' : 'digital']));
const x52 = BindsDocument.parse(read('src/testing/fixtures/X52.4.2.binds'));
const X52 = new Map(x52.actions().map((a) => [a.code, a]));

const joy = (key: string): SlotBinding => ({ device: 'SaitekX52', key, modifiers: [], hold: false });
const act = (code: string): ActionState => X52.get(code)!;
/** Flatten groups to "code:slot:checked" for compact assertions. */
const flat = (groups: LinkGroup[]) =>
  Object.fromEntries(groups.flatMap((g) => g.items.map((i) => [i.code, `${i.slot}:${i.checked ? 'on' : 'off'}${i.replaces ? ':replaces' : ''}`])));

describe('equivalent families', () => {
  it('only contains current game actions of the family kind, each in one family', () => {
    const seen = new Set<string>();
    for (const f of EQUIVALENT_FAMILIES) {
      expect(f.members.length, f.id).toBeGreaterThan(1);
      for (const m of f.members) {
        expect(TYPES.get(m), `${f.id}: ${m}`).toBe(f.kind);
        expect(seen.has(m), `${m} in two families`).toBe(false);
        seen.add(m);
      }
    }
  });

  it('matches how the X52 preset binds the families it covers', () => {
    for (const f of ['throttle', 'stick-x', 'stick-y', 'primary-fire', 'fire-group-next', 'select-target', 'assist', 'boost', 'gear-brake']) {
      const family = EQUIVALENT_FAMILIES.find((x) => x.id === f)!;
      const inputs = new Set<string>();
      for (const m of family.members) {
        for (const s of Object.values(X52.get(m)?.slots ?? {})) if (s && s.device === 'SaitekX52') inputs.add(s.key);
      }
      expect(inputs.size, `${f}: ${[...inputs].join(', ')}`).toBe(1);
    }
  });

  it('finds the family of an action', () => {
    expect(familyOf('ThrottleAxis')!.members).toContain('DriveSpeedAxis');
    expect(familyOf('YawAxis_Landing')).toBeUndefined();
  });
});

describe('suggestLinks', () => {
  it('replacing: offers commands on the old binding, in the slot that holds it; family members checked', () => {
    // Ship primary fire: secondary Joy_1 -> Joy_2.
    const g = suggestLinks(act('PrimaryFire'), 'Secondary', joy('Joy_2'), X52);
    const replacing = g.find((x) => x.kind === 'shared' && x.relation === 'replacing')!;
    expect(replacing.kind === 'shared' && replacing.via.key).toBe('Joy_1');
    const f = flat([replacing]);
    expect(f['BuggyPrimaryFireButton']).toBe('Primary:on'); // same family, kept in sync
    expect(f['ExplorationFSSZoomIn']).toBe('Primary:off'); // shares Joy_1 but unrelated
    expect(f['StoreToggle']).toBe('Primary:off');
  });

  it('alongside: offers commands sharing the other binding, writing their other slot (your W example)', () => {
    // UI Panel Up has W (primary) and hat up (secondary); give it a new secondary.
    const g = suggestLinks(act('UI_Up'), 'Secondary', joy('Joy_16'), X52);
    const alongside = g.find((x) => x.kind === 'shared' && x.relation === 'alongside')!;
    expect(alongside.kind === 'shared' && alongside.via.key).toBe('Key_W');
    const f = flat([alongside]);
    expect(f['ForwardKey']).toBe('Secondary:off'); // W primary, secondary free
    expect(f['HumanoidForwardButton']).toBe('Secondary:off');
    expect(f['CamTranslateForward']).toBe('Secondary:off:replaces'); // its secondary is Joy_22
    // Replacing group (hat up): power to engines, head look up, free cam zoom in.
    const replacing = g.find((x) => x.kind === 'shared' && x.relation === 'replacing')!;
    expect(Object.keys(flat([replacing]))).toEqual(expect.arrayContaining(['IncreaseEnginesPower', 'HeadLookPitchUp', 'FreeCamZoomIn']));
  });

  it('keeps the shared binding in place when the other command has it in the other slot', () => {
    // CamZoomIn has Key_Z as *secondary*; CyclePreviousPage has Key_Z as primary. Adding a secondary to
    // CyclePreviousPage must write CamZoomIn's *primary*, not overwrite its Z.
    const g = suggestLinks(act('CyclePreviousPage'), 'Secondary', joy('Joy_3'), X52);
    expect(flat(g)['CamZoomIn']).toBe('Primary:off');
  });

  it('equivalent: offers unbound family members checked (SRV power distribution)', () => {
    const g = suggestLinks(act('IncreaseEnginesPower'), 'Secondary', joy('Joy_16'), X52);
    const eq = g.find((x) => x.kind === 'equivalent')!;
    expect(eq.kind === 'equivalent' && eq.family.id).toBe('pips-engines');
    expect(flat([eq])['IncreaseEnginesPower_Buggy']).toBe('Secondary:on');
  });

  it('lists each command once, preferring the replacing group', () => {
    const g = suggestLinks(act('UI_Up'), 'Secondary', joy('Joy_16'), X52);
    const codes = g.flatMap((x) => x.items.map((i) => i.code));
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('clearing only offers commands in sync with the removed binding', () => {
    const g = suggestLinks(act('PrimaryFire'), 'Secondary', null, X52);
    expect(g.every((x) => x.kind === 'shared' && x.relation === 'replacing')).toBe(true);
    expect(flat(g)['BuggyPrimaryFireButton']).toBe('Primary:on');
  });

  it('links axes through the Binding slot', () => {
    const f = flat(suggestLinks(act('ThrottleAxis'), 'Binding', joy('Joy_UAxis'), X52));
    expect(f['DriveSpeedAxis']).toBe('Binding:on');
    expect(f['MoveFreeCamY']).toBe('Binding:on');
    expect(f['MovePlacementCamY']).toBe('Binding:on');
  });

  it('checks commands bound identically even outside a family', () => {
    // Next panel and next genus are both E + Joy_17 on the X52: a twin outside any family.
    const edited: ActionState = { ...act('CycleNextPanel') };
    const twin: ActionState = { ...act('ExplorationSAANextGenus') }; // also E + Joy_17
    const map = new Map([[edited.code, edited], [twin.code, twin]]);
    expect(flat(suggestLinks(edited, 'Secondary', joy('Joy_9'), map))['ExplorationSAANextGenus']).toBe('Secondary:on');
  });

  it('offers nothing when the binding does not change', () => {
    expect(suggestLinks(act('PrimaryFire'), 'Secondary', joy('Joy_1'), X52)).toEqual([]);
  });
});

describe('followAxisOption', () => {
  it('follows only where the target matched the source before', () => {
    expect(followAxisOption(true, true, false)).toBe(false);
    expect(followAxisOption(false, true, false)).toBe(false);
    expect(followAxisOption(true, false, true)).toBe(true);
    expect(followAxisOption(0.1, 0, 0.2)).toBe(0.1);
    expect(followAxisOption(0, 0, 0.2)).toBe(0.2);
    expect(followAxisOption(true, false, false)).toBe(true);
  });
});
