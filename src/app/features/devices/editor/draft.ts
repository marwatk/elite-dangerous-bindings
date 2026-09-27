/**
 * The layout editor's working model. A draft groups Elite IDs into "parts":
 * a primary ID owns controls; alias IDs (other hardware revisions, a named
 * ID) get a copy of their primary's controls when exported. Axis halves
 * (Pos_/Neg_) share their axis's box.
 */
import {
  Box,
  ControlGroup,
  ControlKind,
  DeviceControl,
  DeviceDefinition,
  DeviceIdEntry,
  DeviceSource,
  GroupLayoutKind,
  ImagePoint,
  InputCorrection,
  UsbId,
} from '../../../core/data/catalog.types';
import { extForType, usbFromBindsId } from '../../../core/devices/device-files';
import { CanvasSettings } from './canvas-padding';
import { sameBox } from '../../../core/devices/geometry';

export interface DraftId {
  uid: string;
  bindsId: string;
  deviceIndex?: number;
  usb?: UsbId;
  /** uid of the primary ID whose controls this one shares. */
  aliasOf?: string;
  /** Alias only: labels that differ from the primary's (kept from an imported definition), by key. */
  labelOverrides?: Record<string, string>;
}

export type ImageType = 'webp' | 'png' | 'jpg' | 'svg';

export interface DraftImage {
  uid: string;
  /** Original upload name, for display. */
  name: string;
  /** File name to keep when exporting (images of an existing device). */
  file?: string;
  blob: Blob;
  type: ImageType;
  width: number;
  height: number;
}

export interface DraftControl {
  uid: string;
  /** uid of the primary DraftId. */
  part: string;
  key: string;
  label: string;
  kind: ControlKind;
  image?: number;
  box?: Box;
  /** Leader line (image pixels, anchor last); only with a box. */
  leader?: ImagePoint[];
}

/** Controls sharing one box (hat, rocker, encoder…). Members are control uids of one part, in row order. */
export interface DraftGroup {
  uid: string;
  /** uid of the primary DraftId. */
  part: string;
  /** id in device.json (kept from an imported definition). */
  id?: string;
  label: string;
  layout: GroupLayoutKind;
  showLabel: boolean;
  members: { control: string; marker: string }[];
  image?: number;
  box?: Box;
  leader?: ImagePoint[];
}

export interface EditorDraft {
  version: 1;
  /** Device being edited (bundled or saved locally), null for a new one. */
  baseId: string | null;
  baseSource?: DeviceSource;
  name: string;
  id: string;
  /** The folder id was typed by hand (stop deriving it from the name). */
  idEdited: boolean;
  ids: DraftId[];
  images: DraftImage[];
  controls: DraftControl[];
  groups?: DraftGroup[];
  keyBindsIds?: string[];
  inputCorrections?: Record<string, InputCorrection>;
  /** Cards draw box outlines (photos); off for artwork with printed boxes. Absent: on for new devices. */
  drawBoxes?: boolean;
  /** Canvas around the images (background, margin, 16:9); defaults when absent. */
  canvas?: Partial<CanvasSettings>;
  updated: number;
}

let counter = 0;
export function newUid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `u${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

export function emptyDraft(): EditorDraft {
  return { version: 1, baseId: null, name: '', id: '', idEdited: false, ids: [], images: [], controls: [], drawBoxes: true, updated: Date.now() };
}

export function isPrimary(d: EditorDraft, id: DraftId): boolean {
  return !id.aliasOf || !d.ids.some((o) => o.uid === id.aliasOf && !o.aliasOf);
}

export function primaryIds(d: EditorDraft): DraftId[] {
  return d.ids.filter((i) => isPrimary(d, i));
}

/** Primary part uid for a live input's device, if the draft handles it. */
export function partFor(d: EditorDraft, bindsId: string, deviceIndex = 0): string | null {
  const id =
    d.ids.find((i) => i.bindsId === bindsId && (i.deviceIndex ?? 0) === deviceIndex) ?? d.ids.find((i) => i.bindsId === bindsId);
  if (!id) return null;
  return isPrimary(d, id) ? id.uid : id.aliasOf!;
}

export function partLabel(d: EditorDraft, part: string): string {
  const id = d.ids.find((i) => i.uid === part);
  if (!id) return '?';
  return id.deviceIndex !== undefined ? `${id.bindsId} #${id.deviceIndex}` : id.bindsId;
}

const HALF = /^(Pos|Neg)_(.*)$/;

export function axisBaseOf(c: DraftControl, controls: DraftControl[]): DraftControl | undefined {
  const m = HALF.exec(c.key);
  if (!m) return undefined;
  return controls.find((o) => o.part === c.part && o.key === m[2]);
}

/** An axis half with no box of its own: it shares its axis's box. */
export function isSharedHalf(c: DraftControl, controls: DraftControl[]): boolean {
  return !c.box && !!axisBaseOf(c, controls);
}

/** The group a control belongs to, if any. */
export function groupOfControl(d: EditorDraft, uid: string): DraftGroup | undefined {
  return d.groups?.find((g) => g.members.some((m) => m.control === uid));
}

/** Something drawn as one box in the Place step: a control, or a whole group (`group` set, uid = group uid). */
export interface PlaceItem extends DraftControl {
  group?: DraftGroup;
}

/** A group as a place item: label, box and leader of the group; key sums up its members. */
export function groupItem(d: EditorDraft, g: DraftGroup): PlaceItem {
  const first = d.controls.find((c) => c.uid === g.members[0]?.control);
  const item: PlaceItem = {
    uid: g.uid,
    part: g.part,
    key: `${first?.key ?? 'group'}${g.members.length > 1 ? ` +${g.members.length - 1}` : ''}`,
    label: g.label,
    kind: first?.kind ?? 'button',
    group: g,
  };
  if (g.box) {
    item.box = g.box;
    item.image = g.image ?? 0;
  }
  if (g.leader) item.leader = g.leader;
  return item;
}

/** Things that need a box (checklist): controls with a box of their own, and groups (where their first member is). */
export function placeableControls(d: EditorDraft): PlaceItem[] {
  const parts = new Set(primaryIds(d).map((i) => i.uid));
  const firstMember = new Map((d.groups ?? []).filter((g) => g.members.length).map((g) => [g.members[0].control, g]));
  const grouped = new Set((d.groups ?? []).flatMap((g) => g.members.map((m) => m.control)));
  const out: PlaceItem[] = [];
  for (const c of d.controls) {
    if (!parts.has(c.part)) continue;
    const g = firstMember.get(c.uid);
    if (g) out.push(groupItem(d, g));
    else if (!grouped.has(c.uid) && !isSharedHalf(c, d.controls)) out.push(c);
  }
  return out;
}

/** File name for each image on export. Keeps existing names when unique and of the same type. */
export function imageFileNames(d: EditorDraft, id = d.id || 'device'): string[] {
  const used = new Set<string>();
  return d.images.map((img, i) => {
    const ext = img.type;
    const okExt = ext === 'jpg' ? /\.jpe?g$/i : new RegExp(`\\.${ext}$`, 'i');
    let name = img.file && okExt.test(img.file) ? img.file : undefined;
    if (!name || used.has(name.toLowerCase())) {
      name = `${id}${i ? `-${i + 1}` : ''}.${ext}`;
      let n = i + 2;
      while (used.has(name.toLowerCase())) name = `${id}-${n++}.${ext}`;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

function withUsb(id: DraftId): DeviceIdEntry {
  const e: DeviceIdEntry = { bindsId: id.bindsId };
  if (id.deviceIndex !== undefined) e.deviceIndex = id.deviceIndex;
  const usb = id.usb ?? usbFromBindsId(id.bindsId);
  if (usb) e.usb = usb;
  return e;
}

/** Whether cards draw box outlines: the draft's setting, else on for a new device (older autosaves). */
export function drawsBoxes(d: Pick<EditorDraft, 'drawBoxes' | 'baseId'>): boolean {
  return d.drawBoxes ?? d.baseId === null;
}

/** The draft as a device definition (what device.json will hold). */
export function draftToDefinition(d: EditorDraft, source: DeviceSource = 'user'): DeviceDefinition {
  const files = imageFileNames(d);
  const def: DeviceDefinition = {
    id: d.id,
    name: d.name.trim(),
    source,
    ids: d.ids.map(withUsb),
    images: d.images.map((img, i) => ({ file: files[i], width: Math.round(img.width), height: Math.round(img.height) })),
    controls: [],
  };
  if (drawsBoxes(d)) def.drawBoxes = true;
  const grouped = new Set((d.groups ?? []).flatMap((g) => g.members.map((m) => m.control)));
  const groups: ControlGroup[] = [];
  const groupIds = new Set<string>();
  const groupId = (g: DraftGroup) => {
    const base = g.id || g.label.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[-_]+|-+$/g, '') || 'group';
    let id = base;
    for (let n = 2; groupIds.has(id); n++) id = `${base}-${n}`;
    groupIds.add(id);
    return id;
  };
  if (d.keyBindsIds?.length) def.keyBindsIds = d.keyBindsIds.filter((k) => d.ids.some((i) => i.bindsId === k));
  if (d.inputCorrections && Object.keys(d.inputCorrections).length) def.inputCorrections = d.inputCorrections;
  for (const id of d.ids) {
    const part = isPrimary(d, id) ? id.uid : id.aliasOf!;
    for (const c of d.controls) {
      if (c.part !== part) continue;
      const label = (part !== id.uid && id.labelOverrides?.[c.key]) || c.label;
      const out: DeviceControl = { bindsId: id.bindsId, key: c.key, label, kind: c.kind };
      if (id.deviceIndex !== undefined) out.deviceIndex = id.deviceIndex;
      const src = grouped.has(c.uid) ? undefined : c.box ? c : isSharedHalf(c, d.controls) ? axisBaseOf(c, d.controls) : undefined;
      if (src?.box && !grouped.has(src.uid) && (src.image ?? 0) < d.images.length) {
        out.image = src.image ?? 0;
        out.box = { ...src.box };
        if (src.leader?.length) out.leader = src.leader.map((p) => ({ ...p }));
      }
      def.controls.push(out);
    }
    for (const g of d.groups ?? []) {
      if (g.part !== part || !g.box || (g.image ?? 0) >= d.images.length) continue;
      const members = g.members
        .map((m) => ({ c: d.controls.find((c) => c.uid === m.control), marker: m.marker }))
        .filter((m): m is { c: DraftControl; marker: string } => !!m.c)
        .map((m) => ({ bindsId: id.bindsId, ...(id.deviceIndex !== undefined ? { deviceIndex: id.deviceIndex } : {}), key: m.c.key, marker: m.marker }));
      const out: ControlGroup = { id: groupId(g), label: g.label, layout: g.layout, image: g.image ?? 0, box: { ...g.box }, members };
      if (!g.showLabel) out.showLabel = false;
      if (g.leader?.length) out.leader = g.leader.map((p) => ({ ...p }));
      groups.push(out);
    }
  }
  if (groups.length) def.groups = groups;
  return def;
}

/** Layout signature: IDs with the same controls in the same boxes are aliases (labels may differ). */
function signature(controls: DeviceControl[]): string {
  return JSON.stringify(
    controls
      .map((c) => [c.key, c.kind, c.box ? (c.image ?? 0) : null, c.box ?? null, c.box ? (c.leader ?? null) : null])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

function controlsOf(def: DeviceDefinition, id: DeviceIdEntry): DeviceControl[] {
  return def.controls.filter(
    (c) => c.bindsId === id.bindsId && (id.deviceIndex === undefined || (c.deviceIndex ?? id.deviceIndex) === id.deviceIndex),
  );
}

/** Open an existing definition in the editor. `images` are the artwork blobs in order. */
export function definitionToDraft(def: DeviceDefinition, images: Blob[]): EditorDraft {
  const ids: DraftId[] = [];
  const controls: DraftControl[] = [];
  const sigs: { uid: string; sig: string; controls: DeviceControl[] }[] = [];
  for (const entry of def.ids) {
    const uid = newUid();
    const own = controlsOf(def, entry);
    const sig = signature(own);
    const same = own.length ? sigs.find((s) => s.sig === sig) : undefined;
    const id: DraftId = { uid, bindsId: entry.bindsId };
    if (entry.deviceIndex !== undefined) id.deviceIndex = entry.deviceIndex;
    if (entry.usb) id.usb = { ...entry.usb };
    if (same) {
      id.aliasOf = same.uid;
      const overrides: Record<string, string> = {};
      for (const c of own) {
        const p = same.controls.find((x) => x.key === c.key);
        if (p && p.label !== c.label) overrides[c.key] = c.label;
      }
      if (Object.keys(overrides).length) id.labelOverrides = overrides;
    } else {
      sigs.push({ uid, sig, controls: own });
      for (const c of own) {
        const dc: DraftControl = { uid: newUid(), part: uid, key: c.key, label: c.label, kind: c.kind };
        if (c.box) {
          dc.box = { ...c.box };
          dc.image = c.image ?? 0;
          if (c.leader?.length) dc.leader = c.leader.map((p) => ({ ...p }));
        }
        controls.push(dc);
      }
    }
    ids.push(id);
  }
  // Groups: kept for the part their first member belongs to (an alias repeats its primary's groups).
  const groups: DraftGroup[] = [];
  for (const g of def.groups ?? []) {
    const m0 = g.members[0];
    const id = m0 && ids.find((i) => i.bindsId === m0.bindsId && (i.deviceIndex ?? undefined) === (m0.deviceIndex ?? undefined) && !i.aliasOf);
    if (!id) continue;
    const members = g.members
      .map((m) => ({ control: controls.find((c) => c.part === id.uid && c.key === m.key)?.uid, marker: m.marker }))
      .filter((m): m is { control: string; marker: string } => !!m.control && !groups.some((x) => x.members.some((y) => y.control === m.control)));
    if (!members.length) continue;
    const dg: DraftGroup = { uid: newUid(), part: id.uid, id: g.id, label: g.label, layout: g.layout ?? 'stack', showLabel: g.showLabel !== false, members, image: g.image ?? 0, box: { ...g.box } };
    if (g.leader?.length) dg.leader = g.leader.map((p) => ({ ...p }));
    groups.push(dg);
  }
  // Axis halves drawn exactly on their axis's box become shared.
  for (const c of controls) {
    const base = axisBaseOf(c, controls);
    if (c.box && base?.box && sameBox(c.box, base.box) && (c.image ?? 0) === (base.image ?? 0)) {
      if (c.leader && !base.leader) base.leader = c.leader;
      delete c.box;
      delete c.image;
      delete c.leader;
    }
  }
  return {
    version: 1,
    baseId: def.id,
    baseSource: def.source,
    name: def.name,
    id: def.id,
    idEdited: true,
    ids,
    images: def.images.map((img, i) => ({
      uid: newUid(),
      name: img.file,
      file: img.file,
      blob: images[i],
      type: extForType(images[i]?.type || img.file.replace(/^.*\./, 'image/')) as ImageType,
      width: img.width,
      height: img.height,
    })),
    controls,
    drawBoxes: !!def.drawBoxes,
    ...(groups.length ? { groups } : {}),
    keyBindsIds: def.keyBindsIds ? [...def.keyBindsIds] : undefined,
    inputCorrections: def.inputCorrections ? JSON.parse(JSON.stringify(def.inputCorrections)) : undefined,
    updated: Date.now(),
  };
}
