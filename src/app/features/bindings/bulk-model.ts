import { ActionState, InputRef, isBound } from '../../core/binds/binds-document';

export interface BulkCounts {
  /** Slots whose main input is on the device (what clearDevice clears). */
  slots: number;
  /** Slots that reference the device as input or modifier (what replaceDevice moves). */
  refs: number;
}

/** Count how many slots a bulk operation will touch. */
export function countDeviceUse(
  actions: readonly Pick<ActionState, 'slots'>[],
  device: string,
  deviceIndex: number,
): BulkCounts {
  const hit = (r: InputRef) => r.device === device && (r.deviceIndex ?? 0) === deviceIndex;
  let slots = 0;
  let refs = 0;
  for (const a of actions) {
    for (const s of Object.values(a.slots)) {
      if (!s || !isBound(s)) continue;
      if (hit(s)) slots++;
      if (hit(s) || s.modifiers.some(hit)) refs++;
    }
  }
  return { slots, refs };
}
