import { ActionState, InputRef, SlotBinding, SlotName, inputId, isBound } from './binds-document';

/** Minimal action metadata the analysis needs (a subset of ActionInfo). */
export interface ActionMeta {
  group: string;
  type: 'digital' | 'analogue';
  hasAnalogue?: boolean;
  hideIfSameAs?: string[];
}

export interface BoundUse {
  code: string;
  slot: SlotName;
  binding: SlotBinding;
}

export interface Conflict {
  /** `device::index::key` of the shared input. */
  input: string;
  /** Sorted modifier IDs joined with `+`, or '' for none. */
  modifiers: string;
  group: string;
  uses: BoundUse[];
}

export function modifierSignature(slot: SlotBinding): string {
  return slot.modifiers.map(inputId).sort().join('+');
}

export function isAxisKey(key: string): boolean {
  return /Axis$|Slider\d*$|StickX$|StickY$/.test(key) && !/^(Pos|Neg)_/.test(key) && !/Button/.test(key);
}

/** Every bound slot, keyed by the physical input it uses. */
export function boundUses(actions: ActionState[]): BoundUse[] {
  const out: BoundUse[] = [];
  for (const a of actions) {
    for (const [slot, b] of Object.entries(a.slots) as [SlotName, SlotBinding | null][]) {
      if (b && isBound(b)) out.push({ code: a.code, slot, binding: b });
    }
  }
  return out;
}

/**
 * Inputs bound to more than one action in the same context (group), with the
 * same modifiers. Pairs the game treats as intentional overlaps (an action and
 * its specialisation, per `hideIfSameAs`) are not reported.
 */
export function findConflicts(actions: ActionState[], meta: (code: string) => ActionMeta): Conflict[] {
  const buckets = new Map<string, BoundUse[]>();
  for (const use of boundUses(actions)) {
    const group = meta(use.code).group;
    const k = `${group}|${inputId(use.binding)}|${modifierSignature(use.binding)}`;
    const list = buckets.get(k);
    if (list) list.push(use);
    else buckets.set(k, [use]);
  }
  const out: Conflict[] = [];
  for (const [k, uses] of buckets) {
    const codes = [...new Set(uses.map((u) => u.code))];
    if (codes.length < 2) continue;
    const related = (a: string, b: string) =>
      (meta(a).hideIfSameAs ?? []).includes(b) || (meta(b).hideIfSameAs ?? []).includes(a);
    const unrelated = codes.some((a, i) => codes.slice(i + 1).some((b) => !related(a, b)));
    if (!unrelated) continue;
    const [group, input, modifiers] = k.split('|');
    out.push({ group, input, modifiers, uses });
  }
  return out;
}

/** Digital-only actions bound to a full analogue axis (EDRefCard's "misconfiguration"). */
export function findAxisMisuse(actions: ActionState[], meta: (code: string) => ActionMeta): BoundUse[] {
  return boundUses(actions).filter((u) => {
    const m = meta(u.code);
    return m.type === 'digital' && !m.hasAnalogue && u.slot !== 'Binding' && isAxisKey(u.binding.key);
  });
}

/** Map of input ID -> uses, for "what is this button bound to?" lookups. */
export function usesByInput(actions: ActionState[]): Map<string, BoundUse[]> {
  const map = new Map<string, BoundUse[]>();
  for (const use of boundUses(actions)) {
    const k = inputId(use.binding);
    const list = map.get(k);
    if (list) list.push(use);
    else map.set(k, [use]);
  }
  return map;
}

/** Conflicts that a proposed binding would create, for live warnings while editing. */
export function conflictsFor(
  actions: ActionState[],
  meta: (code: string) => ActionMeta,
  code: string,
  slot: SlotName,
  proposed: InputRef & { modifiers: InputRef[] },
): BoundUse[] {
  const group = meta(code).group;
  const id = inputId(proposed);
  const sig = proposed.modifiers.map(inputId).sort().join('+');
  const hide = meta(code).hideIfSameAs ?? [];
  return boundUses(actions).filter(
    (u) =>
      !(u.code === code && u.slot === slot) &&
      u.code !== code &&
      meta(u.code).group === group &&
      inputId(u.binding) === id &&
      modifierSignature(u.binding) === sig &&
      !hide.includes(u.code) &&
      !(meta(u.code).hideIfSameAs ?? []).includes(code),
  );
}
