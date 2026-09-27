/**
 * Control groups in the editor draft (pure): creating, editing and removing
 * them, and naming their members "<group label> <marker>" unless renamed.
 */
import { GroupLayoutKind } from '../../../core/data/catalog.types';
import { fillMarkers } from '../../../core/devices/markers';
import { DraftControl, DraftGroup, EditorDraft, newUid } from './draft';
import { defaultLabel } from './inventory';

export interface GroupSpec {
  label: string;
  layout: GroupLayoutKind;
  showLabel: boolean;
  /** Control uids in row order, with their markers. */
  members: { control: string; marker: string }[];
}

/** The automatic name of a member. */
export function memberName(label: string, marker: string): string {
  return `${label.trim()} ${marker}`.trim();
}

/** A control keeps a name the user gave it; generic or automatic names follow the group. */
function isAutoName(c: DraftControl, previous: string | null): boolean {
  const l = c.label.trim();
  return !l || l === defaultLabel(c.key) || (previous !== null && l === previous);
}

/** Rename members whose names are automatic (was: `old` group, now: `next`). */
function relabel(controls: DraftControl[], old: DraftGroup | null, next: DraftGroup | null, members: Set<string>): DraftControl[] {
  const oldName = new Map(old?.members.map((m) => [m.control, memberName(old.label, m.marker)]) ?? []);
  const newName = new Map(next?.members.map((m) => [m.control, memberName(next.label, m.marker)]) ?? []);
  return controls.map((c) => {
    if (!members.has(c.uid) || !isAutoName(c, oldName.get(c.uid) ?? null)) return c;
    const label = newName.get(c.uid) ?? defaultLabel(c.key);
    return label === c.label ? c : { ...c, label };
  });
}

/** A new group of controls (in the given order), markers filled from the keys where possible. */
export function groupSpecFor(d: EditorDraft, uids: string[], label = ''): GroupSpec {
  const controls = uids.map((u) => d.controls.find((c) => c.uid === u)).filter((c): c is DraftControl => !!c);
  const markers = fillMarkers(controls.map((c) => ({ key: c.key })));
  return { label, layout: 'stack', showLabel: true, members: controls.map((c, i) => ({ control: c.uid, marker: markers[i] })) };
}

/**
 * Group controls. They lose boxes of their own (the group takes the first
 * member's box and line, if any) and leave other groups.
 */
export function createGroup(d: EditorDraft, spec: GroupSpec, uid = newUid()): EditorDraft {
  const ids = new Set(spec.members.map((m) => m.control));
  const first = d.controls.find((c) => c.uid === spec.members[0]?.control);
  if (!first) return d;
  const withBox = spec.members.map((m) => d.controls.find((c) => c.uid === m.control)).find((c) => c?.box);
  const group: DraftGroup = { uid, part: first.part, label: spec.label.trim(), layout: spec.layout, showLabel: spec.showLabel, members: spec.members.map((m) => ({ ...m })) };
  if (withBox?.box) {
    group.box = { ...withBox.box };
    group.image = withBox.image ?? 0;
    if (withBox.leader) group.leader = withBox.leader.map((p) => ({ ...p }));
  }
  const groups = (d.groups ?? []).map((g) => ({ ...g, members: g.members.filter((m) => !ids.has(m.control)) })).filter((g) => g.members.length);
  const controls = d.controls.map((c) => {
    if (!ids.has(c.uid) || (!c.box && !c.leader)) return c;
    const { box: _b, image: _i, leader: _l, ...rest } = c;
    return rest;
  });
  return { ...d, groups: [...groups, group], controls: relabel(controls, null, group, ids) };
}

/** Change a group's label, layout, member order or markers (members may also be dropped). */
export function updateGroup(d: EditorDraft, uid: string, spec: Partial<GroupSpec>): EditorDraft {
  const old = d.groups?.find((g) => g.uid === uid);
  if (!old) return d;
  const next: DraftGroup = {
    ...old,
    ...(spec.label !== undefined ? { label: spec.label.trim() } : {}),
    ...(spec.layout ? { layout: spec.layout } : {}),
    ...(spec.showLabel !== undefined ? { showLabel: spec.showLabel } : {}),
    ...(spec.members ? { members: spec.members.map((m) => ({ ...m })) } : {}),
  };
  const touched = new Set([...old.members, ...next.members].map((m) => m.control));
  const dropped = old.members.filter((m) => !next.members.some((n) => n.control === m.control));
  let controls = relabel(d.controls, old, next, touched);
  // Dropped members go back to their plain names.
  controls = relabel(controls, old, null, new Set(dropped.map((m) => m.control)));
  return { ...d, groups: d.groups!.map((g) => (g.uid === uid ? next : g)), controls };
}

/** Dissolve a group: its members become separate (unplaced) controls again. */
export function ungroup(d: EditorDraft, uid: string): EditorDraft {
  const g = d.groups?.find((x) => x.uid === uid);
  if (!g) return d;
  const members = new Set(g.members.map((m) => m.control));
  return { ...d, groups: d.groups!.filter((x) => x.uid !== uid), controls: relabel(d.controls, g, null, members) };
}

/**
 * Keep groups consistent after any edit: members must exist and be in one
 * group only, a group lives in its members' part, and empty groups go.
 */
export function cleanGroups(d: EditorDraft): EditorDraft {
  if (!d.groups?.length) return d;
  const byUid = new Map(d.controls.map((c) => [c.uid, c]));
  const seen = new Set<string>();
  let changed = false;
  const groups: DraftGroup[] = [];
  for (const g of d.groups) {
    const members = g.members.filter((m) => byUid.has(m.control) && !seen.has(m.control) && (seen.add(m.control), true));
    const part = members.length ? byUid.get(members[0].control)!.part : g.part;
    const inPart = members.filter((m) => byUid.get(m.control)!.part === part);
    if (!inPart.length) {
      changed = true;
      continue;
    }
    if (inPart.length !== g.members.length || part !== g.part) {
      changed = true;
      groups.push({ ...g, part, members: inPart });
    } else groups.push(g);
  }
  return changed ? { ...d, groups } : d;
}
