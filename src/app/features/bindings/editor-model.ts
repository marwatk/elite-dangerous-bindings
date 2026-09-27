import { ActionKind, ActionState, InputRef, SlotBinding, SlotName, isBound, sameInput } from '../../core/binds/binds-document';
import { isAxisKey } from '../../core/binds/analysis';
import { DeviceControl, GenericControl, KeyInfo } from '../../core/data/catalog.types';
import { CaptureKind, CaptureResult } from '../../core/input/input.types';

/** What a slot editor is choosing: the main input or an extra modifier. */
export type PickTarget = 'binding' | 'modifier';

/** How a control behaves, from its Elite key name. */
export type ControlClass = 'axis' | 'half' | 'hat' | 'button' | 'key';

export function controlClass(key: string, device = ''): ControlClass {
  if (/^(Pos|Neg)_/.test(key)) return 'half';
  if (isAxisKey(key)) return 'axis';
  if (/POV\d/.test(key)) return 'hat';
  if (device === 'Keyboard' || key.startsWith('Key_')) return 'key';
  return 'button';
}

export interface ActionTraits {
  kind: ActionKind;
  /** Digital action that also accepts a full axis. */
  hasAnalogue?: boolean;
}

/** What `InputService.capture()` should accept for an action / modifier. */
export function acceptFor(action: ActionTraits, target: PickTarget = 'binding'): CaptureKind[] {
  if (target === 'modifier') return ['button', 'hat', 'key'];
  if (action.kind === 'axis') return ['axis'];
  // Digital actions take axes too: as a half (Pos_/Neg_), or whole when hasAnalogue.
  return ['button', 'hat', 'key', 'axis'];
}

/** Whether a control may be used for this action (or as a modifier). */
export function isCompatible(key: string, action: ActionTraits, target: PickTarget = 'binding'): boolean {
  const cls = controlClass(key);
  if (target === 'modifier') return cls !== 'axis';
  if (action.kind === 'axis') return cls === 'axis';
  if (cls === 'axis') return !!action.hasAnalogue;
  return true;
}

export interface CaptureOutcome {
  binding: SlotBinding;
  /** Axis action moved in the negative direction: offer to set Inverted. */
  suggestInverted: boolean;
  /** Digital action with hasAnalogue captured on an axis: the whole-axis alternative. */
  fullAxis: SlotBinding | null;
}

function cleanRef(r: InputRef): InputRef {
  const out: InputRef = { device: r.device, key: r.key };
  if ((r.deviceIndex ?? 0) > 0) out.deviceIndex = r.deviceIndex;
  return out;
}

/** Strip an axis-half prefix: `Neg_Joy_XAxis` -> `Joy_XAxis`. */
export function baseAxis(key: string): string {
  return key.replace(/^(Pos|Neg)_/, '');
}

/**
 * Turn a capture into what gets written to the slot. Axis captures on
 * digital actions become the half the axis was moved towards; the slot's
 * Hold flag is kept; held controls become modifiers.
 */
export function captureToSlot(result: CaptureResult, action: ActionTraits, prev: SlotBinding | null): CaptureOutcome {
  const ref = cleanRef(result.ref);
  const modifiers = dedupeRefs(result.modifiers.map(cleanRef).filter((m) => !sameInput(m, ref)));
  const hold = !!prev && isBound(prev) && prev.hold;
  const isAxis = result.kind === 'axis';
  if (action.kind === 'axis') {
    const binding = { ...ref, key: baseAxis(ref.key), modifiers, hold };
    return { binding, suggestInverted: isAxis && result.direction === -1, fullAxis: null };
  }
  if (isAxis && !/^(Pos|Neg)_/.test(ref.key)) {
    const half = `${result.direction === -1 ? 'Neg' : 'Pos'}_${ref.key}`;
    return {
      binding: { ...ref, key: half, modifiers, hold },
      suggestInverted: false,
      fullAxis: action.hasAnalogue ? { ...ref, modifiers, hold } : null,
    };
  }
  return { binding: { ...ref, modifiers, hold }, suggestInverted: false, fullAxis: null };
}

export function dedupeRefs(refs: InputRef[]): InputRef[] {
  const out: InputRef[] = [];
  for (const r of refs) if (!out.some((o) => sameInput(o, r))) out.push(r);
  return out;
}

/** Add a modifier to a slot (ignores duplicates and the slot's own input). */
export function addModifier(slot: SlotBinding, mod: InputRef): SlotBinding {
  const m = cleanRef(mod);
  if (sameInput(slot, m) || slot.modifiers.some((x) => sameInput(x, m))) return slot;
  return { ...slot, modifiers: [...slot.modifiers, m] };
}

export function removeModifier(slot: SlotBinding, index: number): SlotBinding {
  return { ...slot, modifiers: slot.modifiers.filter((_, i) => i !== index) };
}

/** Replace the slot's input, keeping its modifiers and Hold flag. */
export function withInput(prev: SlotBinding | null, ref: InputRef): SlotBinding {
  const r = cleanRef(ref);
  const keep = prev && isBound(prev) ? prev : null;
  return { ...r, modifiers: (keep?.modifiers ?? []).filter((m) => !sameInput(m, r)), hold: keep?.hold ?? false };
}

export function slotsEqual(a: SlotBinding | null | undefined, b: SlotBinding | null | undefined): boolean {
  const ab = !!a && isBound(a);
  const bb = !!b && isBound(b);
  if (!ab || !bb) return ab === bb;
  return (
    sameInput(a!, b!) &&
    a!.hold === b!.hold &&
    a!.modifiers.length === b!.modifiers.length &&
    a!.modifiers.every((m, i) => sameInput(m, b!.modifiers[i]))
  );
}

// ------------------------------------------------------------ draft

export interface EditorDraft {
  slots: Partial<Record<SlotName, SlotBinding | null>>;
  toggleOn: boolean | null;
  inverted: boolean | null;
  deadzone: number | null;
  /** Other actions' slots to clear to resolve conflicts. */
  clearOthers: { code: string; slot: SlotName }[];
}

export function draftFrom(state: ActionState): EditorDraft {
  return {
    slots: { ...state.slots },
    toggleOn: state.toggleOn,
    inverted: state.inverted,
    deadzone: state.deadzone,
    clearOthers: [],
  };
}

export interface DraftEdit {
  kind: 'slot' | 'toggleOn' | 'inverted' | 'deadzone' | 'clearOther';
  slot?: SlotName;
  code?: string;
}

/** The edits a draft would make, relative to the action as loaded in the dialog. */
export function draftEdits(orig: ActionState, draft: EditorDraft): DraftEdit[] {
  const out: DraftEdit[] = [];
  for (const slot of Object.keys(orig.slots) as SlotName[]) {
    if (!slotsEqual(orig.slots[slot], draft.slots[slot])) out.push({ kind: 'slot', slot });
  }
  if (draft.toggleOn !== orig.toggleOn && draft.toggleOn !== null) out.push({ kind: 'toggleOn' });
  if (draft.inverted !== orig.inverted && draft.inverted !== null) out.push({ kind: 'inverted' });
  if (draft.deadzone !== orig.deadzone && draft.deadzone !== null) out.push({ kind: 'deadzone' });
  for (const c of draft.clearOthers) out.push({ kind: 'clearOther', code: c.code, slot: c.slot });
  return out;
}

/** Minimal document surface the draft writes through (a BindsDocument). */
export interface DraftTarget {
  setSlot(code: string, slot: SlotName, binding: SlotBinding | null): void;
  setToggleOn(code: string, on: boolean): void;
  setInverted(code: string, inverted: boolean): void;
  setDeadzone(code: string, deadzone: number): void;
}

/** Write a draft; call inside one `store.mutate()`. */
export function applyDraft(doc: DraftTarget, orig: ActionState, draft: EditorDraft): number {
  const edits = draftEdits(orig, draft);
  for (const e of edits) {
    if (e.kind === 'slot') doc.setSlot(orig.code, e.slot!, draft.slots[e.slot!] ?? null);
    else if (e.kind === 'toggleOn') doc.setToggleOn(orig.code, !!draft.toggleOn);
    else if (e.kind === 'inverted') doc.setInverted(orig.code, !!draft.inverted);
    else if (e.kind === 'deadzone') doc.setDeadzone(orig.code, draft.deadzone ?? 0);
    else if (e.kind === 'clearOther') doc.setSlot(e.code!, e.slot!, null);
  }
  return edits.length;
}

/** Actions as they would be with the draft applied (for live conflict checks). */
export function actionsWithDraft(actions: readonly ActionState[], orig: ActionState, draft: EditorDraft): ActionState[] {
  const cleared = new Set(draft.clearOthers.map((c) => `${c.code}|${c.slot}`));
  return actions.map((a) => {
    if (a.code === orig.code) return { ...a, slots: { ...draft.slots } };
    if (!draft.clearOthers.some((c) => c.code === a.code)) return a;
    const slots = { ...a.slots };
    for (const s of Object.keys(slots) as SlotName[]) if (cleared.has(`${a.code}|${s}`)) slots[s] = null;
    return { ...a, slots };
  });
}

// ------------------------------------------------------------ picker lists

export interface PickItem {
  key: string;
  label: string;
  cls: ControlClass;
}

export const MOUSE_CONTROLS: PickItem[] = [
  ...[1, 2, 3, 4, 5].map((n) => ({ key: `Mouse_${n}`, label: `Button ${n}`, cls: 'button' as const })),
  { key: 'Mouse_XAxis', label: 'X axis', cls: 'axis' },
  { key: 'Mouse_YAxis', label: 'Y axis', cls: 'axis' },
  { key: 'Mouse_ZAxis', label: 'Wheel', cls: 'axis' },
  { key: 'Pos_Mouse_XAxis', label: 'X axis +', cls: 'half' },
  { key: 'Neg_Mouse_XAxis', label: 'X axis −', cls: 'half' },
  { key: 'Pos_Mouse_YAxis', label: 'Y axis +', cls: 'half' },
  { key: 'Neg_Mouse_YAxis', label: 'Y axis −', cls: 'half' },
  { key: 'Pos_Mouse_ZAxis', label: 'Wheel up', cls: 'half' },
  { key: 'Neg_Mouse_ZAxis', label: 'Wheel down', cls: 'half' },
];

/**
 * Controls of one device, including axis halves for every axis. Uses the
 * device definition when there is one, the keyboard key list for Keyboard,
 * and the generic inventory otherwise.
 */
export function controlsForDevice(
  device: string,
  deviceIndex: number,
  def: { controls: DeviceControl[] } | undefined,
  keys: Iterable<KeyInfo>,
  generic: readonly GenericControl[],
): PickItem[] {
  if (device === 'Keyboard') return [...keys].map((k) => ({ key: k.key, label: k.label, cls: 'key' as const }));
  if (device === 'Mouse') return MOUSE_CONTROLS;
  const own = def?.controls.filter((c) => c.bindsId === device && (c.deviceIndex ?? deviceIndex) === deviceIndex) ?? [];
  const base: readonly { key: string; label: string }[] = own.length ? own : generic;
  const out: PickItem[] = [];
  const seen = new Set<string>();
  const push = (key: string, label: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, label, cls: controlClass(key, device) });
  };
  for (const c of base) push(c.key, c.label);
  for (const c of base) {
    if (controlClass(c.key) === 'axis') {
      push(`Pos_${c.key}`, `${c.label} +`);
      push(`Neg_${c.key}`, `${c.label} −`);
    }
  }
  return out;
}

/** Filter picker items by compatibility and a search string. */
export function filterPickItems(items: readonly PickItem[], action: ActionTraits, target: PickTarget, search: string): PickItem[] {
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(
    (i) => isCompatible(i.key, action, target) && terms.every((t) => `${i.label}\n${i.key}`.toLowerCase().includes(t)),
  );
}
