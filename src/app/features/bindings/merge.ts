import { ActionState, SlotName } from '../../core/binds/binds-document';
import { describeSlot } from '../../core/state/bindings-store.service';
import { DraftTarget } from './editor-model';

export interface MergeCandidate {
  code: string;
  group: string;
  /** The source file's binding differs from this file's. */
  differs: boolean;
  /** The source file binds something for this action. */
  sourceBound: boolean;
}

function signature(a: ActionState): string {
  const slots = (Object.keys(a.slots) as SlotName[]).sort().map((s) => `${s}=${describeSlot(a.slots[s])}`);
  return [...slots, `t=${a.toggleOn}`, `i=${a.inverted}`, `d=${a.deadzone}`].join('|');
}

/** Actions present (with the same kind) in both files. */
export function mergeCandidates(
  target: readonly ActionState[],
  source: readonly ActionState[],
  group: (code: string) => string,
): MergeCandidate[] {
  const src = new Map(source.map((a) => [a.code, a]));
  const out: MergeCandidate[] = [];
  for (const t of target) {
    const s = src.get(t.code);
    if (!s || s.kind !== t.kind) continue;
    out.push({
      code: t.code,
      group: group(t.code),
      differs: signature(s) !== signature(t),
      sourceBound: Object.values(s.slots).some((b) => describeSlot(b) !== ''),
    });
  }
  return out;
}

/** Group -> codes, preserving file order. */
export function groupCandidates(list: readonly MergeCandidate[]): Map<string, MergeCandidate[]> {
  const map = new Map<string, MergeCandidate[]>();
  for (const c of list) {
    const l = map.get(c.group);
    if (l) l.push(c);
    else map.set(c.group, [c]);
  }
  return map;
}

/** Codes from `selected` that would actually change the document. */
export function effectiveMerge(list: readonly MergeCandidate[], selected: ReadonlySet<string>): string[] {
  return list.filter((c) => selected.has(c.code) && c.differs).map((c) => c.code);
}

/**
 * Copy slots and per-action flags for `codes` from the source actions into
 * `doc`. Flags are only written when the source file has them. Call inside
 * one `store.mutate()`.
 */
export function applyMerge(doc: DraftTarget, source: readonly ActionState[], codes: Iterable<string>): number {
  const src = new Map(source.map((a) => [a.code, a]));
  let n = 0;
  for (const code of codes) {
    const s = src.get(code);
    if (!s) continue;
    for (const slot of Object.keys(s.slots) as SlotName[]) doc.setSlot(code, slot, s.slots[slot] ?? null);
    if (s.toggleOn !== null) doc.setToggleOn(code, s.toggleOn);
    if (s.inverted !== null) doc.setInverted(code, s.inverted);
    if (s.deadzone !== null) doc.setDeadzone(code, s.deadzone);
    n++;
  }
  return n;
}
