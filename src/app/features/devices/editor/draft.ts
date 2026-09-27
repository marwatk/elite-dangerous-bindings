/**
 * The layout editor's working model. A draft groups Elite IDs into "parts":
 * a primary ID owns controls; alias IDs (other hardware revisions, a named
 * ID) get a copy of their primary's controls when exported. Axis halves
 * (Pos_/Neg_) share their axis's box.
 */
import {
  Box,
  ControlKind,
  DeviceControl,
  DeviceDefinition,
  DeviceIdEntry,
  DeviceSource,
  InputCorrection,
  UsbId,
} from '../../../core/data/catalog.types';
import { extForType, usbFromBindsId } from '../../../core/devices/device-files';
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
  keyBindsIds?: string[];
  inputCorrections?: Record<string, InputCorrection>;
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
  return { version: 1, baseId: null, name: '', id: '', idEdited: false, ids: [], images: [], controls: [], updated: Date.now() };
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

/** Controls that need a box of their own (checklist). */
export function placeableControls(d: EditorDraft): DraftControl[] {
  const parts = new Set(primaryIds(d).map((i) => i.uid));
  return d.controls.filter((c) => parts.has(c.part) && !isSharedHalf(c, d.controls));
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
  if (d.keyBindsIds?.length) def.keyBindsIds = d.keyBindsIds.filter((k) => d.ids.some((i) => i.bindsId === k));
  if (d.inputCorrections && Object.keys(d.inputCorrections).length) def.inputCorrections = d.inputCorrections;
  for (const id of d.ids) {
    const part = isPrimary(d, id) ? id.uid : id.aliasOf!;
    for (const c of d.controls) {
      if (c.part !== part) continue;
      const label = (part !== id.uid && id.labelOverrides?.[c.key]) || c.label;
      const out: DeviceControl = { bindsId: id.bindsId, key: c.key, label, kind: c.kind };
      if (id.deviceIndex !== undefined) out.deviceIndex = id.deviceIndex;
      const src = c.box ? c : isSharedHalf(c, d.controls) ? axisBaseOf(c, d.controls) : undefined;
      if (src?.box && (src.image ?? 0) < d.images.length) {
        out.image = src.image ?? 0;
        out.box = { ...src.box };
      }
      def.controls.push(out);
    }
  }
  return def;
}

/** Layout signature: IDs with the same controls in the same boxes are aliases (labels may differ). */
function signature(controls: DeviceControl[]): string {
  return JSON.stringify(
    controls
      .map((c) => [c.key, c.kind, c.box ? (c.image ?? 0) : null, c.box ?? null])
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
        }
        controls.push(dc);
      }
    }
    ids.push(id);
  }
  // Axis halves drawn exactly on their axis's box become shared.
  for (const c of controls) {
    const base = axisBaseOf(c, controls);
    if (c.box && base?.box && sameBox(c.box, base.box) && (c.image ?? 0) === (base.image ?? 0)) {
      delete c.box;
      delete c.image;
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
    keyBindsIds: def.keyBindsIds ? [...def.keyBindsIds] : undefined,
    inputCorrections: def.inputCorrections ? JSON.parse(JSON.stringify(def.inputCorrections)) : undefined,
    updated: Date.now(),
  };
}
