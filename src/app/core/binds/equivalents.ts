/**
 * Equivalent actions: commands that do the same job in different game modes
 * (ship, SRV, on foot, cameras…), so a HOTAS control usually does the same
 * thing in all of them. The binding editor offers to apply an edit to the other
 * members of the family.
 *
 * Built from the X52 default preset (which binds most of these together) plus
 * the obvious counterparts it leaves unbound (e.g. SRV power distribution).
 * Landing and alternate-flight overrides are deliberately left out: they exist
 * to be different.
 */

import { ActionState, SlotBinding, SlotName, isBound, sameInput } from './binds-document';

export interface EquivalentFamily {
  id: string;
  /** What the family does, e.g. "Throttle". */
  label: string;
  kind: 'digital' | 'analogue';
  members: readonly string[];
}

export const EQUIVALENT_FAMILIES: readonly EquivalentFamily[] = [
  // ------------------------------------------------------------ axes
  {
    id: 'throttle',
    label: 'Throttle',
    kind: 'analogue',
    members: ['ThrottleAxis', 'DriveSpeedAxis', 'MoveFreeCamY', 'MovePlacementCamY'],
  },
  {
    id: 'stick-x',
    label: 'Stick left / right',
    kind: 'analogue',
    members: [
      'RollAxisRaw',
      'SteeringAxis',
      'BuggyRollAxisRaw',
      'RollCamera',
      'MultiCrewThirdPersonYawAxisRaw',
      'SAAThirdPersonYawAxisRaw',
      'ExplorationFSSCameraYaw',
      'StoreYawCamera',
      'CamTranslateXAxis',
      'RotateSettlement',
    ],
  },
  {
    id: 'stick-y',
    label: 'Stick forward / back',
    kind: 'analogue',
    members: [
      'PitchAxisRaw',
      'BuggyPitchAxis',
      'PitchCamera',
      'CamPitchAxis',
      'MultiCrewThirdPersonPitchAxisRaw',
      'SAAThirdPersonPitchAxisRaw',
      'ExplorationFSSCameraPitch',
      'StorePitchCamera',
      'PitchPlacementCamera',
    ],
  },
  {
    id: 'twist',
    label: 'Twist / rudder',
    kind: 'analogue',
    members: ['YawAxisRaw', 'YawCamera', 'CamYawAxis', 'YawPlacementCamera'],
  },
  {
    id: 'lateral',
    label: 'Lateral thrust',
    kind: 'analogue',
    members: ['LateralThrustRaw', 'MoveFreeCamX', 'MovePlacementCamX'],
  },
  {
    id: 'vertical',
    label: 'Vertical thrust',
    kind: 'analogue',
    members: ['VerticalThrustRaw', 'MoveFreeCamZ', 'MovePlacementCamZ'],
  },
  // ------------------------------------------------------------ weapons and targeting
  {
    id: 'primary-fire',
    label: 'Primary fire',
    kind: 'digital',
    members: ['PrimaryFire', 'BuggyPrimaryFireButton', 'HumanoidPrimaryFireButton', 'MultiCrewPrimaryFire'],
  },
  {
    id: 'secondary-fire',
    label: 'Secondary fire',
    kind: 'digital',
    members: ['SecondaryFire', 'BuggySecondaryFireButton', 'MultiCrewSecondaryFire'],
  },
  {
    id: 'fire-group-next',
    label: 'Next fire group',
    kind: 'digital',
    members: ['CycleFireGroupNext', 'BuggyCycleFireGroupNext'],
  },
  {
    id: 'fire-group-prev',
    label: 'Previous fire group',
    kind: 'digital',
    members: ['CycleFireGroupPrevious', 'BuggyCycleFireGroupPrevious'],
  },
  { id: 'select-target', label: 'Target ahead', kind: 'digital', members: ['SelectTarget', 'SelectTarget_Buggy'] },
  {
    id: 'deploy-weapons',
    label: 'Deploy weapons',
    kind: 'digital',
    members: ['DeployHardpointToggle', 'ToggleBuggyTurretButton'],
  },
  // ------------------------------------------------------------ systems
  { id: 'pips-engines', label: 'Power to engines', kind: 'digital', members: ['IncreaseEnginesPower', 'IncreaseEnginesPower_Buggy'] },
  { id: 'pips-weapons', label: 'Power to weapons', kind: 'digital', members: ['IncreaseWeaponsPower', 'IncreaseWeaponsPower_Buggy'] },
  { id: 'pips-systems', label: 'Power to systems', kind: 'digital', members: ['IncreaseSystemsPower', 'IncreaseSystemsPower_Buggy'] },
  { id: 'pips-reset', label: 'Reset power', kind: 'digital', members: ['ResetPowerDistribution', 'ResetPowerDistribution_Buggy'] },
  { id: 'cargo-scoop', label: 'Cargo scoop', kind: 'digital', members: ['ToggleCargoScoop', 'ToggleCargoScoop_Buggy'] },
  { id: 'eject-cargo', label: 'Jettison all cargo', kind: 'digital', members: ['EjectAllCargo', 'EjectAllCargo_Buggy'] },
  { id: 'assist', label: 'Flight / drive assist', kind: 'digital', members: ['ToggleFlightAssist', 'ToggleDriveAssist'] },
  { id: 'boost', label: 'Boost / SRV thrusters', kind: 'digital', members: ['UseBoostJuice', 'VerticalThrustersButton'] },
  { id: 'gear-brake', label: 'Landing gear / handbrake', kind: 'digital', members: ['LandingGearToggle', 'AutoBreakBuggyButton'] },
  { id: 'lights', label: 'Lights', kind: 'digital', members: ['ShipSpotLightToggle', 'HeadlightsBuggyButton', 'HumanoidToggleFlashlightButton'] },
  { id: 'night-vision', label: 'Night vision', kind: 'digital', members: ['NightVisionToggle', 'HumanoidToggleNightVisionButton'] },
  { id: 'reverse-throttle', label: 'Reverse throttle', kind: 'digital', members: ['ToggleReverseThrottleInput', 'BuggyToggleReverseThrottleInput', 'ToggleReverseThrottleInputFreeCam'] },
  // ------------------------------------------------------------ panels and modes
  { id: 'ui-focus', label: 'UI focus', kind: 'digital', members: ['UIFocus', 'UIFocus_Buggy'] },
  { id: 'panel-left', label: 'External panel', kind: 'digital', members: ['FocusLeftPanel', 'FocusLeftPanel_Buggy'] },
  { id: 'panel-comms', label: 'Comms panel', kind: 'digital', members: ['FocusCommsPanel', 'FocusCommsPanel_Buggy', 'FocusCommsPanel_Humanoid'] },
  { id: 'quick-comms', label: 'Quick comms', kind: 'digital', members: ['QuickCommsPanel', 'QuickCommsPanel_Buggy', 'QuickCommsPanel_Humanoid'] },
  { id: 'panel-role', label: 'Role panel', kind: 'digital', members: ['FocusRadarPanel', 'FocusRadarPanel_Buggy'] },
  { id: 'panel-right', label: 'Internal panel', kind: 'digital', members: ['FocusRightPanel', 'FocusRightPanel_Buggy'] },
  { id: 'galaxy-map', label: 'Open galaxy map', kind: 'digital', members: ['GalaxyMapOpen', 'GalaxyMapOpen_Buggy', 'GalaxyMapOpen_Humanoid'] },
  { id: 'system-map', label: 'Open system map', kind: 'digital', members: ['SystemMapOpen', 'SystemMapOpen_Buggy', 'SystemMapOpen_Humanoid'] },
  { id: 'codex', label: 'Codex', kind: 'digital', members: ['OpenCodexGoToDiscovery', 'OpenCodexGoToDiscovery_Buggy'] },
  { id: 'hud-mode', label: 'HUD mode', kind: 'digital', members: ['PlayerHUDModeToggle', 'PlayerHUDModeToggle_Buggy'] },
  { id: 'head-look', label: 'Head look', kind: 'digital', members: ['HeadLookToggle', 'HeadLookToggle_Buggy'] },
  { id: 'camera-suite', label: 'Camera suite', kind: 'digital', members: ['PhotoCameraToggle', 'PhotoCameraToggle_Buggy', 'PhotoCameraToggle_Humanoid'] },
  // ------------------------------------------------------------ cameras
  { id: 'cam-left', label: 'Camera left', kind: 'digital', members: ['MoveFreeCamLeft', 'MovePlacementCamLeft'] },
  { id: 'cam-right', label: 'Camera right', kind: 'digital', members: ['MoveFreeCamRight', 'MovePlacementCamRight'] },
  { id: 'cam-up', label: 'Camera up', kind: 'digital', members: ['MoveFreeCamUp', 'MovePlacementCamUp'] },
  { id: 'cam-down', label: 'Camera down', kind: 'digital', members: ['MoveFreeCamDown', 'MovePlacementCamDown'] },
  { id: 'cam-speed-up', label: 'Camera speed up', kind: 'digital', members: ['FreeCamSpeedInc', 'PlacementCamSpeedInc'] },
  { id: 'cam-speed-down', label: 'Camera speed down', kind: 'digital', members: ['FreeCamSpeedDec', 'PlacementCamSpeedDec'] },
];

const BY_CODE = new Map<string, EquivalentFamily>();
for (const f of EQUIVALENT_FAMILIES) for (const m of f.members) BY_CODE.set(m, f);

export function familyOf(code: string): EquivalentFamily | undefined {
  return BY_CODE.get(code);
}

/** One command the edit could also be applied to. */
export interface LinkSuggestion {
  code: string;
  /** Slot of that command to write. */
  slot: SlotName;
  /** Suggested checkbox state. */
  checked: boolean;
  /** A different binding that writing would overwrite (never the shared input itself). */
  replaces: SlotBinding | null;
  /** Why it's suggested checked: same equivalents family, or bound identically to the edited command. */
  reason: 'equivalent' | 'identical' | null;
}

export type LinkGroup =
  | {
      kind: 'shared';
      /** The input this command shares with the edited one. */
      via: SlotBinding;
      /** 'replacing': the edited slot held `via`; 'alongside': `via` is the edited command's other binding. */
      relation: 'replacing' | 'alongside';
      items: LinkSuggestion[];
    }
  | { kind: 'equivalent'; family: EquivalentFamily; items: LinkSuggestion[] };

function bound(b: SlotBinding | null | undefined): SlotBinding | null {
  return b && isBound(b) ? b : null;
}

/** Same input, modifiers and hold/tap. Two unbound slots count as equal. */
export function sameBinding(a: SlotBinding | null | undefined, b: SlotBinding | null | undefined): boolean {
  const x = bound(a);
  const y = bound(b);
  if (!x || !y) return !x && !y;
  return (
    sameInput(x, y) &&
    !!x.hold === !!y.hold &&
    x.modifiers.length === y.modifiers.length &&
    x.modifiers.every((m) => y.modifiers.some((n) => sameInput(m, n)))
  );
}

function slotsOf(a: ActionState): SlotName[] {
  return a.kind === 'axis' ? ['Binding'] : ['Primary', 'Secondary'];
}

function otherSlot(s: SlotName): SlotName | null {
  return s === 'Primary' ? 'Secondary' : s === 'Secondary' ? 'Primary' : null;
}

/** Bound the same way, ignoring which slot holds what. */
function identical(a: ActionState, b: ActionState): boolean {
  const xs = slotsOf(a).map((s) => bound(a.slots[s])).filter((x): x is SlotBinding => !!x);
  const ys = slotsOf(b).map((s) => bound(b.slots[s])).filter((x): x is SlotBinding => !!x);
  return xs.length > 0 && xs.length === ys.length && xs.every((x) => ys.some((y) => sameBinding(x, y)));
}

/**
 * Other commands an edit of `edited`'s `slot` (to `after`, or cleared when
 * null) could also be applied to, in three groups:
 *
 * 1. shared/replacing — commands also using the binding being replaced; the
 *    same slot of theirs that holds it is written (kept in sync).
 * 2. shared/alongside — commands also using the edited command's other
 *    binding; their other slot is written, so the shared binding stays put
 *    (e.g. adding a secondary to everything that has W as primary).
 * 3. equivalent — members of the predefined family not already listed.
 *
 * Checked by default when in the same family or bound identically, and only
 * if nothing different would be overwritten. Each command appears once.
 */
export function suggestLinks(
  edited: ActionState,
  slot: SlotName,
  after: SlotBinding | null,
  actions: ReadonlyMap<string, ActionState>,
): LinkGroup[] {
  const before = bound(edited.slots[slot]);
  const next = bound(after);
  if (sameBinding(before, next)) return [];
  const family = familyOf(edited.code);
  const inFamily = (code: string) => !!family && family.members.includes(code);
  const listed = new Set<string>([edited.code]);
  const groups: LinkGroup[] = [];

  const sourceSlots = [slot, ...slotsOf(edited).filter((s) => s !== slot)];
  for (const t of sourceSlots) {
    const via = bound(edited.slots[t]);
    if (!via) continue;
    const relation = t === slot ? 'replacing' : 'alongside';
    // Clearing a slot never touches the other commands' other slots.
    if (relation === 'alongside' && !next) continue;
    const items: LinkSuggestion[] = [];
    for (const other of actions.values()) {
      if (listed.has(other.code) || other.kind !== edited.kind) continue;
      const holds = slotsOf(other).find((s) => sameBinding(other.slots[s], via));
      if (!holds) continue;
      const target = relation === 'replacing' ? holds : otherSlot(holds);
      if (!target) continue;
      const current = bound(other.slots[target]);
      if (relation === 'alongside' && sameBinding(current, next)) continue; // already has it
      const replaces = relation === 'replacing' ? null : current;
      const reason = inFamily(other.code) ? 'equivalent' : identical(other, edited) ? 'identical' : null;
      items.push({ code: other.code, slot: target, checked: !!reason && !replaces, replaces, reason });
      listed.add(other.code);
    }
    if (items.length) groups.push({ kind: 'shared', via, relation, items });
  }

  if (family && next) {
    const items: LinkSuggestion[] = [];
    for (const code of family.members) {
      const other = actions.get(code);
      if (!other || listed.has(code) || other.kind !== edited.kind) continue;
      const slots = slotsOf(other);
      if (slots.some((s) => sameBinding(other.slots[s], next))) continue; // already has it
      const preferred = slots.includes(slot) ? slot : slots[0];
      const free = [preferred, ...slots.filter((s) => s !== preferred)].find((s) => !bound(other.slots[s]));
      const allFree = slots.every((s) => !bound(other.slots[s]));
      if (allFree) items.push({ code, slot: free!, checked: true, replaces: null, reason: 'equivalent' });
      else if (free) items.push({ code, slot: free, checked: false, replaces: null, reason: null });
      else items.push({ code, slot: preferred, checked: false, replaces: bound(other.slots[preferred]), reason: null });
      listed.add(code);
    }
    if (items.length) groups.push({ kind: 'equivalent', family, items });
  }
  return groups;
}

/**
 * Axis options follow the edit only where they matched the edited command
 * before it (e.g. ship and SRV pitch both inverted; galaxy map pitch not).
 */
export function followAxisOption<T>(targetBefore: T | null, sourceBefore: T | null, sourceAfter: T | null): T | null {
  if (sourceAfter === null || sourceBefore === sourceAfter) return targetBefore;
  return targetBefore === sourceBefore ? sourceAfter : targetBefore;
}
