import { ActionState } from '../../core/binds/binds-document';
import { ActionMeta, BoundUse, Conflict, findAxisMisuse, findConflicts } from '../../core/binds/analysis';

export const TARGET_VIRTUAL_DEVICE = 'ThrustMasterWarthogCombined';
export const BUILTIN_DEVICE_IDS = ['Keyboard', 'Mouse', 'GamePad'];

export interface UsedDevice {
  device: string;
  deviceIndex: number;
}

export interface WarningsReport {
  conflicts: Conflict[];
  axisMisuse: BoundUse[];
  /** Device IDs in the file with no device definition. */
  unknownDevices: UsedDevice[];
  /** Thrustmaster TARGET's combined virtual device is in use. */
  targetVirtual: boolean;
  /** The file binds nothing on the keyboard, mouse or any supported controller. */
  noSupported: boolean;
  /** The file has no bindings at all. */
  empty: boolean;
  count: number;
}

export function buildWarnings(
  actions: readonly ActionState[],
  meta: (code: string) => ActionMeta,
  devicesUsed: readonly UsedDevice[],
  isSupported: (device: string, deviceIndex: number) => boolean,
): WarningsReport {
  const conflicts = findConflicts([...actions], meta);
  const axisMisuse = findAxisMisuse([...actions], meta);
  const unknownDevices = devicesUsed.filter(
    (d) => !BUILTIN_DEVICE_IDS.includes(d.device) && !isSupported(d.device, d.deviceIndex),
  );
  const targetVirtual = devicesUsed.some((d) => d.device === TARGET_VIRTUAL_DEVICE);
  const empty = devicesUsed.length === 0;
  const noSupported = !empty && unknownDevices.length === devicesUsed.length;
  const count = conflicts.length + axisMisuse.length + unknownDevices.length + (targetVirtual ? 1 : 0) + (noSupported ? 1 : 0);
  return { conflicts, axisMisuse, unknownDevices, targetVirtual, noSupported, empty, count };
}

/** Codes of every action involved in a conflict. */
export function conflictCodes(conflicts: readonly Conflict[]): Set<string> {
  return new Set(conflicts.flatMap((c) => c.uses.map((u) => u.code)));
}
