import { InputCorrection, UsbId } from '../data/catalog.types';
import { HAT8, HatDirection } from './hid-parser';

/**
 * Gamepad API -> Elite names. Pure functions over plain snapshots so they can
 * be unit tested without a browser.
 */

export interface PadSnapshot {
  index: number;
  id: string;
  mapping: string;
  buttons: { pressed: boolean; value: number }[];
  axes: number[];
}

export function snapshotGamepad(gp: Gamepad): PadSnapshot {
  return {
    index: gp.index,
    id: gp.id,
    mapping: gp.mapping,
    buttons: gp.buttons.map((b) => ({ pressed: b.pressed, value: b.value })),
    axes: [...gp.axes],
  };
}

/**
 * Parse the USB IDs and product name out of `gamepad.id`:
 * Chromium `Name (STANDARD GAMEPAD Vendor: 045e Product: 028e)`,
 * Firefox `045e-028e-Name` (sometimes without leading zeros).
 */
export function parseGamepadId(id: string): { usb?: UsbId; name: string } {
  const chrome = /^(.*?)\s*\((?:[^()]*?\s)?Vendor:\s*([0-9a-f]{1,4})\s+Product:\s*([0-9a-f]{1,4})\s*\)\s*$/i.exec(id);
  if (chrome) {
    const name = chrome[1].trim() || 'Game controller';
    return { usb: usbId(chrome[2], chrome[3]), name };
  }
  const ff = /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-(.*)$/i.exec(id);
  if (ff) return { usb: usbId(ff[1], ff[2]), name: ff[3].trim() || 'Game controller' };
  return { name: id.trim() || 'Game controller' };
}

function usbId(vid: string, pid: string): UsbId {
  return { vid: vid.toUpperCase().padStart(4, '0'), pid: pid.toUpperCase().padStart(4, '0') };
}

export function usbKey(usb: UsbId | undefined): string {
  return usb ? `${usb.vid}:${usb.pid}` : '';
}

/**
 * How a pad's standard mapping is reported:
 * - `xinput`: Elite's built-in `GamePad` device with `GamePad_*` names.
 * - `sony`: DualShock 4 / DualSense. Elite reads these through DirectInput
 *   and writes them under their own ID (`DualShock4`, `054C0CE6`) with
 *   `Joy_N` numbered as in the HID descriptor, so we translate the standard
 *   layout back to that numbering.
 * - `joystick`: raw browser order, `Joy_{i+1}`.
 */
export type PadProfile = 'xinput' | 'sony' | 'joystick';

const SONY_PIDS = new Set(['05C4', '09CC', '0BA0', '0CE6', '0DF2']);

export function padProfile(pad: Pick<PadSnapshot, 'id' | 'mapping'>, usb: UsbId | undefined, isNamedGamePad: boolean): PadProfile {
  if (pad.mapping !== 'standard') return 'joystick';
  if (usb && usb.vid === '054C' && SONY_PIDS.has(usb.pid)) return 'sony';
  if (isNamedGamePad || /xinput|xbox/i.test(pad.id)) return 'xinput';
  // Other standard-mapped pads (Switch Pro, generic): Elite would see them
  // through DirectInput, whose order we can't know; raw order is the best guess.
  return 'joystick';
}

/** W3C standard gamepad buttons -> Elite GamePad_* names. */
export const XINPUT_BUTTONS = [
  'GamePad_FaceDown',
  'GamePad_FaceRight',
  'GamePad_FaceLeft',
  'GamePad_FaceUp',
  'GamePad_LBumper',
  'GamePad_RBumper',
  'GamePad_LTrigger',
  'GamePad_RTrigger',
  'GamePad_Back',
  'GamePad_Start',
  'GamePad_LThumb',
  'GamePad_RThumb',
  'GamePad_DPadUp',
  'GamePad_DPadDown',
  'GamePad_DPadLeft',
  'GamePad_DPadRight',
] as const;
export const XINPUT_AXES = ['GamePad_LStickX', 'GamePad_LStickY', 'GamePad_RStickX', 'GamePad_RStickY'] as const;

/** Standard button index -> DirectInput Joy_N / POV on a DualShock 4 / DualSense. */
export const SONY_BUTTONS: readonly string[] = [
  'Joy_2', // Cross
  'Joy_3', // Circle
  'Joy_1', // Square
  'Joy_4', // Triangle
  'Joy_5', // L1
  'Joy_6', // R1
  'Joy_7', // L2
  'Joy_8', // R2
  'Joy_9', // Share / Create
  'Joy_10', // Options
  'Joy_11', // L3
  'Joy_12', // R3
  'Joy_POV1Up',
  'Joy_POV1Down',
  'Joy_POV1Left',
  'Joy_POV1Right',
  'Joy_13', // PS
  'Joy_14', // Touchpad click
  'Joy_15', // DualSense mute
];
/** Sticks: X,Y = left stick; Z,Rz = right stick. Triggers L2/R2 are Rx/Ry. */
export const SONY_AXES = ['Joy_XAxis', 'Joy_YAxis', 'Joy_ZAxis', 'Joy_RZAxis'] as const;

export const JOY_AXES = [
  'Joy_XAxis',
  'Joy_YAxis',
  'Joy_ZAxis',
  'Joy_RXAxis',
  'Joy_RYAxis',
  'Joy_RZAxis',
  'Joy_UAxis',
  'Joy_VAxis',
] as const;

/** Chrome reports hats as an axis that idles at ~1.286. */
export function isHatAxisValue(v: number): boolean {
  return v > 1.1;
}

/** 8-way directions of a Chrome hat axis; the idle value (> 1.1) or garbage is centred. */
export function hatAxisDirections(v: number): HatDirection[] {
  if (v > 1.1 || v < -1.1) return [];
  const s = Math.round((v + 1) * 3.5);
  return s >= 0 && s <= 7 ? HAT8[s] : [];
}

export interface MappedState {
  pressed: Set<string>;
  axes: Map<string, number>;
}

/** Tracks which axis indexes of a pad are hats (sticky once seen above 1.1). */
export type HatAxes = Map<number, Set<number>>;

function shiftButton(key: string, offset: number): string {
  if (!offset) return key;
  const m = /^Joy_(\d+)$/.exec(key);
  return m ? `Joy_${Math.max(1, Number(m[1]) + offset)}` : key;
}

/** Apply a correction to an Elite key already derived from the default mapping. */
export function applyCorrection(key: string, c: InputCorrection | undefined, axisIndex?: number): string {
  if (!c) return key;
  if (c.axisMap) {
    if (axisIndex !== undefined && c.axisMap[String(axisIndex)]) return c.axisMap[String(axisIndex)];
    if (c.axisMap[key]) return c.axisMap[key];
  }
  return shiftButton(key, c.buttonOffset ?? 0);
}

/** Map a standard-mapping pad (xinput or sony profile). */
export function mapStandardPad(pad: PadSnapshot, profile: 'xinput' | 'sony'): MappedState {
  const pressed = new Set<string>();
  const axes = new Map<string, number>();
  const names = profile === 'xinput' ? XINPUT_BUTTONS : SONY_BUTTONS;
  pad.buttons.forEach((b, i) => {
    const k = names[i];
    if (k && b.pressed) pressed.add(k);
  });
  const axisNames = profile === 'xinput' ? XINPUT_AXES : SONY_AXES;
  pad.axes.forEach((v, i) => {
    const k = axisNames[i];
    if (k) axes.set(k, clamp(v));
  });
  // Analogue triggers double as axes (0..1 -> -1..1).
  const trig = profile === 'xinput' ? ['GamePad_LTrigger', 'GamePad_RTrigger'] : ['Joy_RXAxis', 'Joy_RYAxis'];
  [6, 7].forEach((bi, n) => {
    const b = pad.buttons[bi];
    if (b) axes.set(trig[n], clamp(b.value * 2 - 1));
  });
  return { pressed, axes };
}

/**
 * Map one or more Gamepad objects that belong to the same device (Chrome
 * splits >32-button devices into banks) in joystick mode. `pads` must be in
 * bank order; bank n adds 32*n to button numbers. Axes/hats from later banks
 * only fill slots the first bank doesn't use.
 */
export function mapJoystickBanks(pads: PadSnapshot[], hatAxes: HatAxes, correction?: InputCorrection): MappedState & {
  buttons: number;
  axisCount: number;
  hats: number;
} {
  const pressed = new Set<string>();
  const axes = new Map<string, number>();
  let buttons = 0;
  let axisCount = 0;
  let pov = 0;
  pads.forEach((pad, bank) => {
    const offset = bank * 32;
    pad.buttons.forEach((b, i) => {
      if (b.pressed) pressed.add(applyCorrection(`Joy_${offset + i + 1}`, correction));
    });
    buttons = Math.max(buttons, offset + pad.buttons.length);
    let hats = hatAxes.get(pad.index);
    if (!hats) hatAxes.set(pad.index, (hats = new Set()));
    pad.axes.forEach((v, i) => {
      if (isHatAxisValue(v)) hats.add(i);
    });
    const hatOrder = [...hats].sort((a, b) => a - b);
    pad.axes.forEach((v, i) => {
      if (hats.has(i)) {
        const n = pov + hatOrder.indexOf(i) + 1;
        for (const d of hatAxisDirections(v)) pressed.add(`Joy_POV${n}${d}`);
        return;
      }
      const base = JOY_AXES[i];
      if (!base) return;
      const key = applyCorrection(base, correction, i);
      if (bank > 0 && axes.has(key)) return;
      axes.set(key, clamp(v));
      axisCount = Math.max(axisCount, axes.size);
    });
    pov += hatOrder.length;
  });
  return { pressed, axes, buttons, axisCount, hats: pov };
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
