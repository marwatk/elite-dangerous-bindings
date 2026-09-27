import { InputRef, SlotBinding } from '../../core/binds/binds-document';
import { SlotChange } from '../../core/state/bindings-store.service';

function parseId(id: string): InputRef | null {
  const parts = id.split('::');
  if (parts.length < 3) return null;
  const key = parts.pop()!;
  const idx = Number(parts.pop());
  const device = parts.join('::');
  const ref: InputRef = { device, key };
  if (idx > 0) ref.deviceIndex = idx;
  return ref;
}

/** Inverse of `describeSlot()` (from the store), for showing changes with labels. */
export function parseDescribedSlot(text: string): SlotBinding | null {
  if (!text) return null;
  let t = text;
  const hold = t.endsWith(' (hold)');
  if (hold) t = t.slice(0, -' (hold)'.length);
  const refs = t.split(' + ').map(parseId);
  if (refs.some((r) => r === null) || refs.length === 0) return null;
  const main = refs.pop()!;
  return { ...main, modifiers: refs as InputRef[], hold };
}

/** Text for a flag change value (`ToggleOn`, `Inverted`, `Deadzone`). */
export function flagValueText(change: Pick<SlotChange, 'slot'>, value: string): string {
  if (value === '') return 'not set';
  if (change.slot === 'Deadzone') {
    const n = Number(value);
    return Number.isFinite(n) ? `${Math.round(n * 1000) / 10}%` : value;
  }
  return value === 'true' ? 'on' : value === 'false' ? 'off' : value;
}

export function isSlotChange(c: SlotChange): boolean {
  return c.slot === 'Primary' || c.slot === 'Secondary' || c.slot === 'Binding';
}
