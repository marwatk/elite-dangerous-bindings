import { ActionState, InputRef, SlotBinding, SlotName, inputId, isBound } from './binds-document';
import { CONTEXT_LABELS, GameContext, contextsOverlap, sharedByDesign } from './contexts';

/** Minimal action metadata the analysis needs (a subset of ActionInfo). */
export interface ActionMeta {
  group: string;
  /** Game contexts the action is live in (see contexts.ts); defaults to `[group]`. */
  contexts?: readonly string[];
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
  /** Readable name of the context both actions are live in, e.g. "ship flight". */
  group: string;
  /** True when the input is a Hold binding (a hold and a tap are different inputs). */
  hold: boolean;
  uses: BoundUse[];
}

/** An input shared on purpose by actions live in the same context (not a conflict). */
export interface SharedOverlap extends Conflict {
  /** Why each pair may share it. */
  reasons: string[];
}

export function modifierSignature(slot: SlotBinding): string {
  return slot.modifiers.map(inputId).sort().join('+');
}

/** Everything that must match for two bindings to fire together: input, modifiers, hold. */
function triggerKey(b: InputRef & { modifiers: InputRef[]; hold?: boolean }): string {
  return `${inputId(b)}|${b.modifiers.map(inputId).sort().join('+')}|${b.hold ? 'hold' : 'tap'}`;
}

function contextsOf(m: ActionMeta): readonly string[] {
  return m.contexts ?? [m.group];
}

function sharedContextLabel(a: ActionMeta, b: ActionMeta): string {
  const ca = contextsOf(a);
  const cb = contextsOf(b);
  const c = ca.includes('global') ? cb[0] : cb.includes('global') ? ca[0] : ca.find((x) => cb.includes(x))!;
  return CONTEXT_LABELS[c as GameContext] ?? c;
}

type PairVerdict = { kind: 'none' } | { kind: 'conflict'; context: string } | { kind: 'shared'; context: string; reason: string };

/** How two actions on the same trigger relate. */
function judgePair(a: string, b: string, meta: (code: string) => ActionMeta): PairVerdict {
  const ma = meta(a);
  const mb = meta(b);
  if (!contextsOverlap(contextsOf(ma), contextsOf(mb))) return { kind: 'none' };
  // An action and its specialisation (e.g. GalMap pitch = ship pitch) share inputs by design.
  if ((ma.hideIfSameAs ?? []).includes(b) || (mb.hideIfSameAs ?? []).includes(a)) return { kind: 'none' };
  const why = sharedByDesign(a, b);
  const context = sharedContextLabel(ma, mb);
  return why ? { kind: 'shared', context, reason: why } : { kind: 'conflict', context };
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
 * Inputs (with the same modifiers and hold/tap) bound to more than one action
 * that can be live at the same time, i.e. whose game contexts overlap.
 * Intentional overlaps (specialisations, and SHARED_BY_DESIGN pairs) are not
 * conflicts; see findSharedOverlaps for the latter.
 */
export function findConflicts(actions: ActionState[], meta: (code: string) => ActionMeta): Conflict[] {
  return analyseOverlaps(actions, meta).conflicts;
}

/** Inputs shared on purpose (SHARED_BY_DESIGN) by actions live in the same context. */
export function findSharedOverlaps(actions: ActionState[], meta: (code: string) => ActionMeta): SharedOverlap[] {
  return analyseOverlaps(actions, meta).shared;
}

export function analyseOverlaps(
  actions: ActionState[],
  meta: (code: string) => ActionMeta,
): { conflicts: Conflict[]; shared: SharedOverlap[] } {
  const buckets = new Map<string, BoundUse[]>();
  for (const use of boundUses(actions)) {
    const k = triggerKey(use.binding);
    const list = buckets.get(k);
    if (list) list.push(use);
    else buckets.set(k, [use]);
  }
  const conflicts: Conflict[] = [];
  const shared: SharedOverlap[] = [];
  for (const [k, uses] of buckets) {
    const codes = [...new Set(uses.map((u) => u.code))];
    if (codes.length < 2) continue;
    const [input, modifiers, hold] = k.split('|');
    const clash = new Set<string>();
    const ok = new Set<string>();
    const reasons = new Set<string>();
    let clashContext = '';
    let okContext = '';
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        const v = judgePair(codes[i], codes[j], meta);
        if (v.kind === 'conflict') {
          clash.add(codes[i]).add(codes[j]);
          clashContext ||= v.context;
        } else if (v.kind === 'shared') {
          ok.add(codes[i]).add(codes[j]);
          reasons.add(v.reason);
          okContext ||= v.context;
        }
      }
    }
    const base = { input, modifiers, hold: hold === 'hold' };
    if (clash.size) conflicts.push({ ...base, group: clashContext, uses: uses.filter((u) => clash.has(u.code)) });
    if (ok.size) {
      shared.push({ ...base, group: okContext, uses: uses.filter((u) => ok.has(u.code)), reasons: [...reasons] });
    }
  }
  return { conflicts, shared };
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
  proposed: InputRef & { modifiers: InputRef[]; hold?: boolean },
): BoundUse[] {
  const key = triggerKey(proposed);
  return boundUses(actions).filter(
    (u) =>
      !(u.code === code && u.slot === slot) &&
      u.code !== code &&
      triggerKey(u.binding) === key &&
      judgePair(code, u.code, meta).kind === 'conflict',
  );
}
