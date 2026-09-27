import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ActionMeta, analyseOverlaps, conflictsFor } from './analysis';
import { BindsDocument } from './binds-document';
import { CONTEXT_LABELS, SHARED_BY_DESIGN, contextsFor, contextsOverlap } from './contexts';

interface Action extends ActionMeta {
  code: string;
  section: string;
}

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const ACTIONS = JSON.parse(read('public/data/actions.json')) as Action[];
const BY_CODE = new Map(ACTIONS.map((a) => [a.code, { ...a, contexts: contextsFor(a) }]));
const meta = (code: string): ActionMeta => BY_CODE.get(code) ?? { group: 'Misc', type: 'digital', contexts: ['ship'] };
const ctx = (code: string) => BY_CODE.get(code)!.contexts;

describe('contextsFor', () => {
  it('gives every catalogue action at least one known context', () => {
    for (const a of ACTIONS) {
      const c = contextsFor(a);
      expect(c.length, a.code).toBeGreaterThan(0);
      for (const x of c) expect(Object.keys(CONTEXT_LABELS), `${a.code} -> ${x}`).toContain(x);
    }
  });

  it('separates the cameras, scanners and SRV modes', () => {
    expect(ctx('VanityCameraScrollLeft')).toEqual(['camera-suite']);
    expect(ctx('MoveFreeCamLeft')).toEqual(['free-camera']);
    expect(ctx('StoreCamZoomIn')).toEqual(['store']);
    expect(ctx('MovePlacementCamUp')).toEqual(['placement']);
    expect(ctx('ExplorationFSSQuit')).toEqual(['fss']);
    expect(ctx('ExplorationSAAExitThirdPerson')).toEqual(['surface-scanner']);
    expect(ctx('ExplorationFSSEnter')).toEqual(['ship']);
    expect(ctx('BuggyTurretYawAxisRaw')).toEqual(['srv-turret']);
    expect(ctx('SteeringAxis')).toEqual(['srv']);
    expect(ctx('BuggyPrimaryFireButton')).toEqual(['srv', 'srv-turret']);
    expect(ctx('HumanoidUtilityWheelCycleMode')).toEqual(['on-foot-wheel']);
    expect(ctx('HumanoidJumpButton')).toEqual(['on-foot']);
    expect(ctx('UI_Up')).toEqual(['ui-panel']);
    expect(ctx('Pause')).toEqual(['global']);
    expect(ctx('HeadLookPitchUp')).toEqual(['head-look']);
    expect(ctx('HeadLookToggle')).toEqual(['ship']);
  });

  it('treats global actions as overlapping everything', () => {
    expect(contextsOverlap(['global'], ['fss'])).toBe(true);
    expect(contextsOverlap(['ship'], ['srv'])).toBe(false);
    expect(contextsOverlap(['ship', 'srv'], ['srv', 'srv-turret'])).toBe(true);
  });

  it('only lists shared-by-design pairs that exist and are live together', () => {
    for (const [a, b] of SHARED_BY_DESIGN) {
      expect(BY_CODE.has(a), a).toBe(true);
      expect(BY_CODE.has(b), b).toBe(true);
      expect(contextsOverlap(ctx(a), ctx(b)), `${a} + ${b}`).toBe(true);
    }
  });
});

describe('conflicts in a nearly default X52 file', () => {
  const doc = BindsDocument.parse(read('src/testing/fixtures/X52.4.2.binds'));
  const { conflicts, shared } = analyseOverlaps(doc.actions(), meta);

  it('reports no conflicts', () => {
    expect(conflicts.map((c) => `${c.input}: ${c.uses.map((u) => u.code).join(', ')}`)).toEqual([]);
  });

  it('reports the intentional overlaps as shared by design', () => {
    const pairs = shared.map((s) => s.uses.map((u) => u.code).sort().join(' + '));
    expect(pairs).toContain('BuggyRollAxisRaw + SteeringAxis');
    expect(pairs).toContain('HumanoidReloadButton + HumanoidToggleToolModeButton');
    expect(pairs).toContain('HumanoidConflictContextualUIButton + HumanoidPrimaryInteractButton + HumanoidToggleMissionHelpPanelButton');
    const steering = shared.find((s) => s.uses.some((u) => u.code === 'SteeringAxis'))!;
    expect(steering.group).toBe('SRV driving');
    expect(steering.reasons[0]).toMatch(/airborne/);
  });
});

describe('real conflicts are still reported', () => {
  const file = `<?xml version="1.0" encoding="UTF-8" ?>
<Root PresetName="Clash" MajorVersion="4" MinorVersion="2">
\t<PrimaryFire>
\t\t<Primary Device="SaitekX52" Key="Joy_1" />
\t\t<Secondary Device="{NoDevice}" Key="" />
\t</PrimaryFire>
\t<LandingGearToggle>
\t\t<Primary Device="SaitekX52" Key="Joy_1" />
\t\t<Secondary Device="{NoDevice}" Key="" />
\t</LandingGearToggle>
\t<SteeringAxis>
\t\t<Binding Device="SaitekX52" Key="Joy_ZAxis" />
\t\t<Inverted Value="0" />
\t\t<Deadzone Value="0.00000000" />
\t</SteeringAxis>
\t<DriveSpeedAxis>
\t\t<Binding Device="SaitekX52" Key="Joy_ZAxis" />
\t\t<Inverted Value="0" />
\t\t<Deadzone Value="0.00000000" />
\t</DriveSpeedAxis>
\t<ExplorationFSSZoomIn>
\t\t<Primary Device="SaitekX52" Key="Joy_2" />
\t\t<Secondary Device="{NoDevice}" Key="" />
\t</ExplorationFSSZoomIn>
\t<ExplorationFSSDiscoveryScan>
\t\t<Primary Device="SaitekX52" Key="Joy_2" />
\t\t<Secondary Device="{NoDevice}" Key="" />
\t</ExplorationFSSDiscoveryScan>
\t<Pause>
\t\t<Primary Device="SaitekX52" Key="Joy_3" />
\t\t<Secondary Device="{NoDevice}" Key="" />
\t</Pause>
\t<HumanoidJumpButton>
\t\t<Primary Device="SaitekX52" Key="Joy_3" />
\t\t<Secondary Device="{NoDevice}" Key="" />
\t</HumanoidJumpButton>
\t<HumanoidReloadButton>
\t\t<Primary Device="Keyboard" Key="Key_R">
\t\t\t<Hold Value="1" />
\t\t</Primary>
\t\t<Secondary Device="{NoDevice}" Key="" />
\t</HumanoidReloadButton>
\t<HumanoidMeleeButton>
\t\t<Primary Device="Keyboard" Key="Key_R" />
\t\t<Secondary Device="{NoDevice}" Key="" />
\t</HumanoidMeleeButton>
</Root>
`;
  const { conflicts } = analyseOverlaps(BindsDocument.parse(file).actions(), meta);
  const found = conflicts.map((c) => c.uses.map((u) => u.code).sort().join(' + '));

  it('flags clashes within one context', () => {
    expect(found).toContain('LandingGearToggle + PrimaryFire');
    expect(found).toContain('DriveSpeedAxis + SteeringAxis');
    expect(found).toContain('ExplorationFSSDiscoveryScan + ExplorationFSSZoomIn');
    expect(conflicts.find((c) => c.uses[0].code === 'PrimaryFire')!.group).toBe('ship flight');
  });

  it('flags a global action clashing with anything', () => {
    expect(found).toContain('HumanoidJumpButton + Pause');
  });

  it('treats a hold and a tap on the same key as different inputs', () => {
    expect(found.some((f) => f.includes('HumanoidMeleeButton'))).toBe(false);
  });

  it('warns live while editing, respecting hold and contexts', () => {
    const actions = BindsDocument.parse(file).actions();
    const joy1 = { device: 'SaitekX52', key: 'Joy_1', modifiers: [] };
    expect(conflictsFor(actions, meta, 'CycleFireGroupNext', 'Primary', joy1).map((u) => u.code).sort()).toEqual([
      'LandingGearToggle',
      'PrimaryFire',
    ]);
    // SRV fire on the ship's fire button: different contexts, fine.
    expect(conflictsFor(actions, meta, 'BuggyPrimaryFireButton', 'Primary', joy1)).toEqual([]);
    const rTap = { device: 'Keyboard', key: 'Key_R', modifiers: [] };
    expect(conflictsFor(actions, meta, 'HumanoidThrowGrenadeButton', 'Primary', rTap).map((u) => u.code)).toEqual(['HumanoidMeleeButton']);
    expect(conflictsFor(actions, meta, 'HumanoidThrowGrenadeButton', 'Primary', { ...rTap, hold: true }).map((u) => u.code)).toEqual([
      'HumanoidReloadButton',
    ]);
  });
});
