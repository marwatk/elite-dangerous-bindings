/**
 * Game contexts: the modes in which a binding is live. Two bindings on the same
 * input only conflict when they can be live at the same time, i.e. when their
 * actions share a context.
 *
 * Derived from EDRefCard's group and Frontier's section names, with explicit
 * rules where those are too coarse (EDRefCard's "Camera" covers four separate
 * cameras, "Scanners" covers two separate scanners plus a ship control, etc.).
 */

export type GameContext =
  | 'global'
  | 'ship'
  | 'srv'
  | 'srv-turret'
  | 'head-look'
  | 'on-foot'
  | 'on-foot-wheel'
  | 'ui-panel'
  | 'galaxy-map'
  | 'fss'
  | 'surface-scanner'
  | 'camera-suite'
  | 'free-camera'
  | 'store'
  | 'placement'
  | 'multicrew'
  | 'holo-me';

export const CONTEXT_LABELS: Record<GameContext, string> = {
  global: 'everywhere',
  ship: 'ship flight',
  srv: 'SRV driving',
  'srv-turret': 'SRV turret',
  'head-look': 'head look mode',
  'on-foot': 'on foot',
  'on-foot-wheel': 'on-foot wheels',
  'ui-panel': 'cockpit panels',
  'galaxy-map': 'galaxy map',
  fss: 'FSS scanner',
  'surface-scanner': 'surface scanner',
  'camera-suite': 'camera suite',
  'free-camera': 'free camera',
  store: 'store',
  placement: 'settlement placement',
  multicrew: 'multicrew',
  'holo-me': 'Holo-Me',
};

/** The metadata `contextsFor` needs (a subset of ActionInfo). */
export interface ContextSource {
  code: string;
  group: string;
  section: string;
}

const GLOBAL = /^(Pause|FriendsMenu|HMDReset|OculusReset|MicrophoneMute|GalnetAudio_.*)$/;

/** Rules in priority order: the first match wins. */
const RULES: [RegExp, GameContext[]][] = [
  [GLOBAL, ['global']],
  // Scanners: entering the FSS is a ship control; FSS and surface scanner are separate modes.
  [/^ExplorationFSSEnter$/, ['ship']],
  [/^ExplorationFSS/i, ['fss']],
  [/^(ExplorationSAA|SAAThirdPerson)/, ['surface-scanner']],
  // Cameras: each camera is its own mode. The photo-mode toggles also act from their vehicle.
  [/^PhotoCameraToggle$/, ['ship', 'camera-suite']],
  [/^PhotoCameraToggle_Buggy$/, ['srv', 'camera-suite']],
  [/^PhotoCameraToggle_Humanoid$/, ['on-foot', 'camera-suite']],
  [/^(VanityCamera|ToggleVanityCamera|ToggleFreeCam$)/, ['camera-suite']],
  [/^Store/, ['store']],
  [/^(FocusDistance|FixCameraRelative)/i, ['free-camera']],
  // Settlement placement camera.
  [/^(PlaceSettlement|ChangeConstructionOption|RotateSettlement|ExitSettlementPlacementCamera|.*PlacementCam)/, ['placement']],
  // SRV: turret mode replaces the driving controls; everything else works in both.
  [/^BuggyTurret/, ['srv-turret']],
  [/^(SteeringAxis|Steer(Left|Right)Button|BuggyRoll|BuggyPitch|DriveSpeedAxis|(Increase|Decrease)SpeedButton|VerticalThrustersButton)/, ['srv']],
  // On-foot wheels: only while a wheel is open.
  [/^(HumanoidItemWheelButton_|HumanoidUtilityWheelCycleMode$)/, ['on-foot-wheel']],
  [/^Humanoid/, ['on-foot']],
  // Head look: the toggles belong to their vehicle; the look controls only work in head look mode.
  [/^HeadLookToggle_Buggy$/, ['srv']],
  [/^HeadLookToggle$/i, ['ship']],
  [/^HeadLook(Pitch|Yaw|Reset)/i, ['head-look']],
  // Radar range and night vision are shared by ship and SRV.
  [/^(RadarRangeAxis|Radar(Increase|Decrease)Range|NightVisionToggle)$/, ['ship', 'srv']],
];

const SECTION_CONTEXTS: Record<string, GameContext[]> = {
  'Free Camera': ['free-camera'],
  'Camera Suite': ['camera-suite'],
  'Store Camera': ['store'],
  'Galaxy Map': ['galaxy-map'],
  'Interface Mode': ['ui-panel'],
  'Driving Turret Controls': ['srv-turret'],
};

const GROUP_CONTEXTS: Record<string, GameContext[]> = {
  Ship: ['ship'],
  Fighter: ['ship'], // fighter orders are given from the mothership
  SRV: ['srv', 'srv-turret'],
  OnFoot: ['on-foot'],
  Multicrew: ['multicrew'],
  'Galaxy map': ['galaxy-map'],
  UI: ['ui-panel'],
  'Holo-Me': ['holo-me'],
  'Head look': ['head-look'],
  Scanners: ['fss'],
  Camera: ['free-camera'],
};

/** Contexts in which an action's bindings are live. */
export function contextsFor(a: ContextSource): GameContext[] {
  for (const [re, ctx] of RULES) if (re.test(a.code)) return ctx;
  if (SECTION_CONTEXTS[a.section]) return SECTION_CONTEXTS[a.section];
  // Frontier's taxonomy has a few legacy codes filed under "Misc"; place them by section.
  if (a.section === 'Multi-crew' || a.section === 'Multicrew') return ['multicrew'];
  if (a.section === 'Full Spectrum System Scanner') return ['fss'];
  if (a.group === 'Misc') return ['ship'];
  return GROUP_CONTEXTS[a.group] ?? ['ship'];
}

/** True when two actions can be live at the same time. */
export function contextsOverlap(a: readonly string[], b: readonly string[]): boolean {
  if (a.includes('global') || b.includes('global')) return true;
  return a.some((c) => b.includes(c));
}

/**
 * Pairs that share an input on purpose: the game picks which one fires from
 * what you're doing (e.g. E interacts, or opens the contextual UI in a combat
 * zone). Each is bound this way in many of Frontier's own default presets.
 */
export const SHARED_BY_DESIGN: readonly (readonly [string, string, string])[] = [
  ['SteeringAxis', 'BuggyRollAxisRaw', 'Steers on the ground, rolls while airborne'],
  ['SteerLeftButton', 'BuggyRollLeftButton', 'Steers on the ground, rolls while airborne'],
  ['SteerRightButton', 'BuggyRollRightButton', 'Steers on the ground, rolls while airborne'],
  ['BuggySecondaryFireButton', 'SelectTarget_Buggy', 'Frontier default: target and secondary fire share a button'],
  ['HumanoidPrimaryInteractButton', 'HumanoidToggleMissionHelpPanelButton', 'Depends on what you are looking at'],
  ['HumanoidPrimaryInteractButton', 'HumanoidConflictContextualUIButton', 'Contextual UI only in combat zones'],
  ['HumanoidConflictContextualUIButton', 'HumanoidToggleMissionHelpPanelButton', 'Contextual UI only in combat zones'],
  ['HumanoidPrimaryInteractButton', 'HumanoidReloadButton', 'Depends on what you are looking at'],
  ['HumanoidPrimaryInteractButton', 'HumanoidToggleToolModeButton', 'Depends on what you are holding'],
  ['HumanoidReloadButton', 'HumanoidToggleToolModeButton', 'Reload with a weapon, tool mode with a tool'],
  ['HumanoidReloadButton', 'HumanoidToggleMissionHelpPanelButton', 'Depends on what you are holding'],
  ['HumanoidToggleMissionHelpPanelButton', 'HumanoidToggleToolModeButton', 'Depends on what you are holding'],
  ['HumanoidOpenAccessPanelButton', 'HumanoidPrimaryInteractButton', 'Access panel only at a panel'],
  ['HumanoidOpenAccessPanelButton', 'HumanoidReloadButton', 'Access panel only at a panel'],
  ['HumanoidOpenAccessPanelButton', 'HumanoidToggleMissionHelpPanelButton', 'Access panel only at a panel'],
  ['HumanoidOpenAccessPanelButton', 'HumanoidToggleToolModeButton', 'Access panel only at a panel'],
  ['HumanoidActivateSuitAbilityButton', 'HumanoidToggleFlashlightButton', 'Frontier default: suit ability and flashlight share a key'],
  ['HumanoidEmoteSlot1', 'HumanoidEmoteWheelButton', 'Tap for the emote, hold for the wheel'],
  ['HumanoidEmoteSlot1', 'HumanoidPulseScanButton', 'Frontier default: shared by emote and pulse scan'],
  ['HumanoidEmoteWheelButton', 'HumanoidPulseScanButton', 'Frontier default: shared by emote wheel and pulse scan'],
  ['HumanoidEmoteWheelButton', 'HumanoidItemWheelButton', 'Frontier default on gamepads'],
  ['HumanoidEmoteSlot1', 'HumanoidSwitchWeapon', 'Frontier default on gamepads'],
  ['HumanoidCrouchButton', 'HumanoidSecondaryInteractButton', 'Frontier default on gamepads'],
  ['HumanoidSwitchToCompAnalyser', 'HumanoidToggleShieldBoosterModuleButton', 'Tool select vs suit module (by what you hold)'],
  ['HumanoidSwitchToCompAnalyser', 'HumanoidToggleWeaponBoosterModuleButton', 'Tool select vs suit module (by what you hold)'],
  ['HumanoidSwitchToRechargeTool', 'HumanoidToggleShieldBoosterModuleButton', 'Tool select vs suit module (by what you hold)'],
  ['HumanoidSwitchToSuitTool', 'HumanoidToggleJumpAssistModuleButton', 'Tool select vs suit module (by what you hold)'],
  ['PhotoCameraToggle', 'PhotoCameraToggle_Buggy', 'Same toggle from ship and SRV'],
  ['PhotoCameraToggle', 'PhotoCameraToggle_Humanoid', 'Same toggle from ship and on foot'],
  ['PhotoCameraToggle_Buggy', 'PhotoCameraToggle_Humanoid', 'Same toggle from SRV and on foot'],
  ['FocusDistanceInc', 'FreeCamZoomIn', 'Advanced mode switches zoom to focus distance'],
  ['FocusDistanceDec', 'FreeCamZoomOut', 'Advanced mode switches zoom to focus distance'],
  ['MultiCrewCockpitUICycleForward', 'MultiCrewPrimaryUtilityFire', 'Frontier default: depends on the multicrew role'],
  ['MultiCrewCockpitUICycleBackward', 'MultiCrewSecondaryUtilityFire', 'Frontier default: depends on the multicrew role'],
];

const SHARED_INDEX = new Map<string, string>();
for (const [a, b, why] of SHARED_BY_DESIGN) {
  SHARED_INDEX.set(`${a}|${b}`, why);
  SHARED_INDEX.set(`${b}|${a}`, why);
}

/** Why two actions may share an input, or null if they may not. */
export function sharedByDesign(a: string, b: string): string | null {
  return SHARED_INDEX.get(`${a}|${b}`) ?? null;
}
