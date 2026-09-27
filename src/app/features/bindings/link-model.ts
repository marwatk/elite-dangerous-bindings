import { ActionState, SlotBinding, SlotName, isBound } from '../../core/binds/binds-document';
import { LinkGroup, LinkSuggestion, followAxisOption, suggestLinks } from '../../core/binds/equivalents';
import { EditorDraft, slotsEqual } from './editor-model';

/** "Also apply to" suggestions for one slot the draft changed. */
export interface LinkSection {
  /** The edited command's slot. */
  slot: SlotName;
  /** Its new value (null when cleared). */
  after: SlotBinding | null;
  groups: LinkGroup[];
}

/** One linked write, identified across recomputes. */
export function linkKey(section: SlotName, item: Pick<LinkSuggestion, 'code' | 'slot'>): string {
  return `${section}|${item.code}|${item.slot}`;
}

function boundOrNull(b: SlotBinding | null | undefined): SlotBinding | null {
  return b && isBound(b) ? b : null;
}

/** Suggestions for every slot the draft changes, from the command's state before editing. */
export function linkSections(orig: ActionState, draft: EditorDraft, actions: ReadonlyMap<string, ActionState>): LinkSection[] {
  const slots = (orig.kind === 'axis' ? ['Binding'] : ['Primary', 'Secondary']) as SlotName[];
  const out: LinkSection[] = [];
  for (const slot of slots) {
    if (slotsEqual(orig.slots[slot], draft.slots[slot])) continue;
    const after = boundOrNull(draft.slots[slot]);
    const groups = suggestLinks(orig, slot, after, actions);
    if (groups.length) out.push({ slot, after, groups });
  }
  return out;
}

export interface LinkWrite {
  code: string;
  slot: SlotName;
  binding: SlotBinding | null;
}

/** The checked suggestions as writes (a later section wins for the same command slot). */
export function linkWrites(sections: readonly LinkSection[], isChecked: (key: string, suggested: boolean) => boolean): LinkWrite[] {
  const writes = new Map<string, LinkWrite>();
  for (const s of sections) {
    for (const g of s.groups) {
      for (const item of g.items) {
        if (!isChecked(linkKey(s.slot, item), item.checked)) continue;
        writes.set(`${item.code}|${item.slot}`, { code: item.code, slot: item.slot, binding: s.after });
      }
    }
  }
  return [...writes.values()];
}

/** Axis options for a linked axis command: they follow the edit where they matched it before. */
export function linkedAxisOptions(
  target: ActionState,
  orig: ActionState,
  draft: EditorDraft,
): { inverted: boolean | null; deadzone: number | null } {
  return {
    inverted: target.inverted === null ? null : followAxisOption(target.inverted, orig.inverted, draft.inverted),
    deadzone: target.deadzone === null ? null : followAxisOption(target.deadzone, orig.deadzone, draft.deadzone),
  };
}

export interface LinkTarget {
  setSlot(code: string, slot: SlotName, binding: SlotBinding | null): void;
  setInverted(code: string, inverted: boolean): void;
  setDeadzone(code: string, deadzone: number): void;
}

/** Apply linked writes (and axis-option following) to the document. */
export function applyLinks(
  doc: LinkTarget,
  writes: readonly LinkWrite[],
  actions: ReadonlyMap<string, ActionState>,
  orig: ActionState,
  draft: EditorDraft,
): void {
  for (const w of writes) {
    doc.setSlot(w.code, w.slot, w.binding);
    const target = actions.get(w.code);
    if (target?.kind !== 'axis') continue;
    const opts = linkedAxisOptions(target, orig, draft);
    if (opts.inverted !== null && opts.inverted !== target.inverted) doc.setInverted(w.code, opts.inverted);
    if (opts.deadzone !== null && opts.deadzone !== target.deadzone) doc.setDeadzone(w.code, opts.deadzone);
  }
}
