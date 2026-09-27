import { InputCorrection, UsbId } from '../data/catalog.types';

/**
 * Which Elite device ID (and DeviceIndex) a live controller reports as, and
 * the per-device settings the user can save in this browser.
 */

export interface DeviceUse {
  device: string;
  deviceIndex: number;
}

export interface IdentityInput {
  /** Every plausible Elite ID (catalog.bindsIdsForUsb order: hex first, then named IDs, then others). */
  candidates: string[];
  /** Named Elite IDs known to the catalogue (device-ids.json keys). */
  namedIds: ReadonlySet<string>;
  /** Devices referenced by the open file. */
  used: readonly DeviceUse[];
  /** 0 for the first connected device with this VID/PID, 1 for the second... */
  ordinal: number;
  /** How many devices with this VID/PID are connected. */
  sameUsbCount: number;
}

export interface Identity {
  bindsId: string;
  deviceIndex: number;
  /** Candidates, best first. */
  candidates: string[];
}

export const UNKNOWN_DEVICE = 'Unknown';

/**
 * Prefer an ID the open file already uses, then a named ID (the game writes
 * named IDs for the devices it knows), then the 8-digit hex form.
 */
export function chooseIdentity(inp: IdentityInput): Identity {
  const { candidates, used, namedIds } = inp;
  if (!candidates.length) return { bindsId: UNKNOWN_DEVICE, deviceIndex: inp.ordinal, candidates: [] };
  const usedIds = new Set(used.map((u) => u.device));
  const inFile = candidates.filter((c) => usedIds.has(c));
  const named = candidates.filter((c) => namedIds.has(c) && !/^[0-9A-F]{8}$/i.test(c));
  const ranked = [...new Set([...inFile, ...named, ...candidates])];
  const bindsId = ranked[0];
  let deviceIndex = inp.ordinal;
  if (inFile.length && inp.sameUsbCount === 1) {
    const indexes = [...new Set(used.filter((u) => u.device === bindsId).map((u) => u.deviceIndex))];
    if (indexes.length === 1) deviceIndex = indexes[0];
  }
  return { bindsId, deviceIndex, candidates: ranked };
}

// ------------------------------------------------------------ persistence

export const CORRECTIONS_KEY = 'edb.inputCorrections';
export const IDENTITY_KEY = 'edb.inputDeviceIds';

export type CorrectionMap = Record<string, InputCorrection>;
export type IdentityOverrides = Record<string, { bindsId: string; deviceIndex: number }>;

export function identityKey(usb: UsbId | undefined, ordinal: number, fallback: string): string {
  if (!usb) return fallback;
  return `${usb.vid}:${usb.pid}${ordinal ? `#${ordinal}` : ''}`;
}

export function readStored<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: settings last for this session only.
  }
}

/** Device-definition correction with the user's own correction layered on top. */
export function mergeCorrections(
  base: InputCorrection | undefined,
  user: InputCorrection | undefined,
): InputCorrection | undefined {
  if (!base && !user) return undefined;
  return {
    buttonOffset: user?.buttonOffset ?? base?.buttonOffset,
    axisMap: user?.axisMap ?? base?.axisMap,
  };
}
