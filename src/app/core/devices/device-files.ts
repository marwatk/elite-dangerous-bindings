/**
 * Pure helpers for device definition files: IDs, slugs, device.json and
 * EDCD .buttonMap writing, the repo-layout .zip, and schema checks that
 * mirror schemas/device.schema.json (kept in sync by a unit test with ajv).
 */
import { Box, ControlGroup, DeviceControl, DeviceDefinition, DeviceIdEntry, DeviceImage, GroupMember, ImagePoint, UsbId } from '../data/catalog.types';

export const SCHEMA_REF = '../../schemas/device.schema.json';
export const MAX_IMAGE_SIDE = 3840;

// ------------------------------------------------------------ IDs

/** Folder-name slug for a device name: letters, digits and dashes. */
export function slugifyDeviceId(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return slug || 'device';
}

export const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

export function isValidDeviceId(id: string): boolean {
  return DEVICE_ID_PATTERN.test(id);
}

const HEX_ID = /^[0-9A-Fa-f]{8}$/;
const NAMED_ID = /^[A-Za-z][A-Za-z0-9 _.+-]*$/;
const RESERVED_IDS = new Set(['Keyboard', 'Mouse', '{NoDevice}']);

/** Tidy a typed Elite device ID: 8 hex digits become upper case. */
export function normalizeBindsId(raw: string): string {
  const s = raw.trim();
  return HEX_ID.test(s) ? s.toUpperCase() : s;
}

/** Why an Elite device ID is not acceptable, or null when it is. */
export function bindsIdError(raw: string): string | null {
  const s = raw.trim();
  if (!s) return 'Enter a device ID';
  if (RESERVED_IDS.has(s)) return `${s} is built into the game, not a controller`;
  if (HEX_ID.test(s)) return null;
  if (/^[0-9A-Fa-f]+$/.test(s)) return 'A USB ID has exactly 8 hex digits (VID + PID), e.g. 231D0200';
  if (!NAMED_ID.test(s) || s.length > 64) return 'Use 8 hex digits (e.g. 231D0200) or a name such as SaitekX56Joystick';
  return null;
}

/** USB VID/PID encoded in an 8-hex-digit Elite ID. */
export function usbFromBindsId(bindsId: string): UsbId | undefined {
  if (!HEX_ID.test(bindsId)) return undefined;
  const s = bindsId.toUpperCase();
  return { vid: s.slice(0, 4), pid: s.slice(4) };
}

export function formatUsb(usb: UsbId | undefined): string {
  return usb ? `${usb.vid}:${usb.pid}` : '';
}

// ------------------------------------------------------------ device.json

const round2 = (n: number) => Math.round(n * 100) / 100;

function roundBox(b: Box): Box {
  return { x: round2(b.x), y: round2(b.y), w: round2(b.w), h: round2(b.h) };
}

function roundPoint(p: ImagePoint): ImagePoint {
  return { x: round2(p.x), y: round2(p.y) };
}

function orderId(e: DeviceIdEntry): DeviceIdEntry {
  const out: DeviceIdEntry = { bindsId: e.bindsId };
  if (e.deviceIndex !== undefined) out.deviceIndex = e.deviceIndex;
  if (e.usb) out.usb = { vid: e.usb.vid.toUpperCase(), pid: e.usb.pid.toUpperCase() };
  return out;
}

function orderControl(c: DeviceControl): DeviceControl {
  const out: DeviceControl = { bindsId: c.bindsId } as DeviceControl;
  if (c.deviceIndex !== undefined) out.deviceIndex = c.deviceIndex;
  out.key = c.key;
  out.label = c.label;
  out.kind = c.kind;
  if (c.box) {
    out.image = c.image ?? 0;
    out.box = roundBox(c.box);
    if (c.leader?.length) out.leader = c.leader.map(roundPoint);
  } else if (c.image !== undefined) {
    out.image = c.image;
  }
  return out;
}

function orderGroup(g: ControlGroup): ControlGroup {
  const out = { id: g.id, label: g.label } as ControlGroup;
  out.layout = g.layout ?? 'stack';
  if (g.showLabel === false) out.showLabel = false;
  out.image = g.image ?? 0;
  out.box = roundBox(g.box);
  if (g.leader?.length) out.leader = g.leader.map(roundPoint);
  out.members = g.members.map((m) => {
    const o = { bindsId: m.bindsId } as GroupMember;
    if (m.deviceIndex !== undefined) o.deviceIndex = m.deviceIndex;
    o.key = m.key;
    o.marker = m.marker;
    return o;
  });
  return out;
}

/** A copy of the definition with the repo's stable key order. */
export function normalizeDefinition(def: DeviceDefinition): DeviceDefinition {
  const out: DeviceDefinition = { $schema: SCHEMA_REF } as DeviceDefinition;
  out.id = def.id;
  out.name = def.name;
  out.source = def.source;
  out.ids = def.ids.map(orderId);
  if (def.keyBindsIds?.length) out.keyBindsIds = [...def.keyBindsIds];
  out.images = def.images.map((i): DeviceImage => ({ file: i.file, width: Math.round(i.width), height: Math.round(i.height) }));
  if (def.drawBoxes) out.drawBoxes = true;
  out.controls = def.controls.map(orderControl);
  if (def.groups?.length) out.groups = def.groups.map(orderGroup);
  if (def.inputCorrections && Object.keys(def.inputCorrections).length) {
    out.inputCorrections = JSON.parse(JSON.stringify(def.inputCorrections));
  }
  return out;
}

/** device.json text: stable key order, 2-space indent, trailing newline. */
export function deviceJson(def: DeviceDefinition): string {
  return JSON.stringify(normalizeDefinition(def), null, 2) + '\n';
}

// ------------------------------------------------------------ .buttonMap

/** Escape text for an XML element body. Drops characters XML 1.0 can't hold. */
export function escapeXml(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function xmlComment(s: string): string {
  // "--" is not allowed inside a comment, nor a trailing "-".
  const body = escapeXml(s).replace(/-{2,}/g, (m) => m.split('').join(' ')).replace(/-$/, '- ');
  return `<!-- ${body} -->`;
}

const KIND_ORDER = { axis: 0, hat: 1, button: 2 } as const;

function naturalKeyCompare(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

/**
 * EDCD EliteCustomButtonNames format: `<Root>` with one element per Elite
 * control key holding its label. Save as `<bindsId>.buttonMap`.
 * Axis halves are skipped (the game derives them from the axis).
 */
export function buttonMapXml(controls: Pick<DeviceControl, 'key' | 'label' | 'kind'>[], deviceName?: string): string {
  const seen = new Set<string>();
  const rows = controls
    .filter((c) => c.label.trim() && !/^(Pos|Neg)_/.test(c.key) && /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(c.key))
    .filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || naturalKeyCompare(a.key, b.key));
  const lines = ['<?xml version="1.0" encoding="UTF-8" ?>'];
  if (deviceName?.trim()) lines.push(xmlComment(deviceName.trim()));
  lines.push('<Root>');
  let kind: string | null = null;
  for (const c of rows) {
    if (c.kind !== kind) {
      kind = c.kind;
      lines.push(`\t${xmlComment(kind === 'axis' ? 'Axes' : kind === 'hat' ? 'Hats' : 'Buttons')}`);
    }
    lines.push(`\t<${c.key}>${escapeXml(c.label.trim())}</${c.key}>`);
  }
  lines.push('</Root>', '');
  return lines.join('\n');
}

/** Controls of one Elite ID, for its .buttonMap. */
export function controlsForBindsId(def: DeviceDefinition, bindsId: string): DeviceControl[] {
  return def.controls.filter((c) => c.bindsId === bindsId);
}

/** Read an EDCD .buttonMap: key -> label, plus the leading device-name comment. */
export function parseButtonMap(xml: string): { name?: string; labels: { key: string; label: string }[] } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Not a valid .buttonMap (XML parse error)');
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'Root') throw new Error('Not a .buttonMap: expected a <Root> element');
  let name: string | undefined;
  for (const n of Array.from(doc.childNodes)) {
    if (n.nodeType === 8) {
      name = n.textContent?.trim() || undefined;
      break;
    }
  }
  const labels = Array.from(root.children).map((e) => ({ key: e.nodeName, label: (e.textContent ?? '').trim() }));
  return { name, labels };
}

/** Guess a control's kind from its Elite key. */
export function kindForKey(key: string): 'button' | 'axis' | 'hat' {
  if (/Axis$/.test(key) || /^(Pos|Neg)_/.test(key)) return 'axis';
  if (/POV\d+(Up|Down|Left|Right)$/.test(key) || /_Dpad|DPad/.test(key)) return 'hat';
  return 'button';
}

// ------------------------------------------------------------ schema checks

/**
 * Essential checks from schemas/device.schema.json plus the extra rules of
 * tools/build-device-index.mjs that can be checked without the repo.
 */
export function schemaErrors(def: DeviceDefinition): string[] {
  const e: string[] = [];
  const d = def as unknown as Record<string, unknown>;
  const allowed = new Set(['$schema', 'id', 'name', 'source', 'ids', 'keyBindsIds', 'images', 'drawBoxes', 'controls', 'groups', 'inputCorrections']);
  for (const k of Object.keys(d)) if (!allowed.has(k)) e.push(`unknown property "${k}"`);
  if (typeof def.id !== 'string' || !DEVICE_ID_PATTERN.test(def.id)) e.push('id: letters, digits and dashes only, starting with a letter or digit');
  if (typeof def.name !== 'string' || def.name.length < 1) e.push('name is required');
  if (!['edrefcard2', 'edcd', 'user'].includes(def.source)) e.push('source must be edrefcard2, edcd or user');
  if (!Array.isArray(def.ids) || def.ids.length < 1) e.push('ids: at least one device ID is required');
  const isInt = (n: unknown, min: number) => typeof n === 'number' && Number.isInteger(n) && n >= min;
  const usbOk = (u: UsbId) => /^[0-9A-F]{4}$/.test(u.vid) && /^[0-9A-F]{4}$/.test(u.pid);
  (def.ids ?? []).forEach((id, i) => {
    if (typeof id.bindsId !== 'string' || !id.bindsId) e.push(`ids[${i}].bindsId is required`);
    if (id.deviceIndex !== undefined && !isInt(id.deviceIndex, 0)) e.push(`ids[${i}].deviceIndex must be an integer ≥ 0`);
    if (id.usb && !usbOk(id.usb)) e.push(`ids[${i}].usb: VID and PID must be 4 upper-case hex digits`);
  });
  (def.images ?? []).forEach((img, i) => {
    if (!/^[^/\\]+\.(webp|png|jpg|jpeg|svg)$/.test(img.file)) e.push(`images[${i}].file must be a .webp/.png/.jpg/.svg file name`);
    if (!isInt(img.width, 1) || !isInt(img.height, 1)) e.push(`images[${i}]: width and height must be positive integers`);
  });
  if (!Array.isArray(def.controls)) e.push('controls must be a list');
  const controlKeys = new Set(['bindsId', 'deviceIndex', 'key', 'label', 'kind', 'image', 'box', 'leader']);
  const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  (def.controls ?? []).forEach((c, i) => {
    for (const k of Object.keys(c)) if (!controlKeys.has(k)) e.push(`controls[${i}]: unknown property "${k}"`);
    if (typeof c.bindsId !== 'string') e.push(`controls[${i}].bindsId is required`);
    if (typeof c.key !== 'string' || !c.key) e.push(`controls[${i}].key is required`);
    if (typeof c.label !== 'string') e.push(`controls[${i}].label must be text`);
    if (!['button', 'axis', 'hat'].includes(c.kind)) e.push(`controls[${i}].kind must be button, axis or hat`);
    if (c.deviceIndex !== undefined && !isInt(c.deviceIndex, 0)) e.push(`controls[${i}].deviceIndex must be an integer ≥ 0`);
    if (c.image !== undefined && (!isInt(c.image, 0) || c.image >= (def.images?.length ?? 0))) {
      e.push(`controls[${i}] (${c.key}) refers to missing image ${c.image}`);
    }
    if (c.box) {
      const b = c.box;
      if (![b.x, b.y, b.w, b.h].every(num)) e.push(`controls[${i}].box must have numeric x, y, w, h`);
      else if (!(b.w > 0 && b.h > 0)) e.push(`controls[${i}] (${c.key}): box width and height must be > 0`);
    }
    if (c.leader !== undefined) {
      const l = c.leader as unknown;
      if (!Array.isArray(l) || !l.length) e.push(`controls[${i}] (${c.key}): leader must be a list of at least one point`);
      else if (!l.every((p) => p && typeof p === 'object' && num(p.x) && num(p.y) && Object.keys(p).every((k) => k === 'x' || k === 'y'))) {
        e.push(`controls[${i}] (${c.key}): leader points must have numeric x and y`);
      }
      if (!c.box) e.push(`controls[${i}] (${c.key}): a leader line needs a box`);
    }
  });
  if (def.drawBoxes !== undefined && typeof def.drawBoxes !== 'boolean') e.push('drawBoxes must be true or false');
  e.push(...groupErrors(def));
  return e;
}

const GROUP_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Checks for `groups` (schema rules, plus: members exist, are in one group only and have no box of their own). */
function groupErrors(def: DeviceDefinition): string[] {
  const e: string[] = [];
  const groups = def.groups as unknown;
  if (groups === undefined) return e;
  if (!Array.isArray(groups)) return ['groups must be a list'];
  const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  const groupKeys = new Set(['id', 'label', 'layout', 'showLabel', 'image', 'box', 'leader', 'members']);
  const memberKeys = new Set(['bindsId', 'deviceIndex', 'key', 'marker']);
  const ids = new Set<string>();
  const grouped = new Map<string, string>();
  const ctlKey = (bindsId: string, deviceIndex: number | undefined, key: string) => `${bindsId}::${deviceIndex ?? '*'}::${key}`;
  const controls = new Map((def.controls ?? []).map((c) => [ctlKey(c.bindsId, c.deviceIndex, c.key), c]));
  (groups as ControlGroup[]).forEach((g, i) => {
    const at = `groups[${i}]${typeof g?.id === 'string' ? ` (${g.id})` : ''}`;
    if (!g || typeof g !== 'object') return void e.push(`${at} must be an object`);
    for (const k of Object.keys(g)) if (!groupKeys.has(k)) e.push(`${at}: unknown property "${k}"`);
    if (typeof g.id !== 'string' || !GROUP_ID.test(g.id)) e.push(`${at}: id must use letters, digits, dashes and underscores`);
    else if (ids.has(g.id)) e.push(`${at}: id "${g.id}" is used twice`);
    else ids.add(g.id);
    if (typeof g.label !== 'string') e.push(`${at}: label must be text`);
    if (g.layout !== undefined && g.layout !== 'stack' && g.layout !== 'row') e.push(`${at}: layout must be stack or row`);
    if (g.showLabel !== undefined && typeof g.showLabel !== 'boolean') e.push(`${at}: showLabel must be true or false`);
    if (g.image !== undefined && (!Number.isInteger(g.image) || g.image < 0 || g.image >= (def.images?.length ?? 0))) {
      e.push(`${at} refers to missing image ${g.image}`);
    }
    const b = g.box;
    if (!b || typeof b !== 'object' || ![b.x, b.y, b.w, b.h].every(num)) e.push(`${at}: box must have numeric x, y, w, h`);
    else if (!(b.w > 0 && b.h > 0)) e.push(`${at}: box width and height must be > 0`);
    if (g.leader !== undefined) {
      const l = g.leader as unknown;
      if (!Array.isArray(l) || !l.length || !l.every((p) => p && typeof p === 'object' && num(p.x) && num(p.y) && Object.keys(p).every((k) => k === 'x' || k === 'y'))) {
        e.push(`${at}: leader must be a list of points with numeric x and y`);
      }
    }
    if (!Array.isArray(g.members) || g.members.length < 2) {
      e.push(`${at}: a group needs at least 2 members`);
      if (!Array.isArray(g.members)) return;
    }
    const markers = new Set<string>();
    g.members.forEach((m, j) => {
      const mat = `${at}.members[${j}]`;
      if (!m || typeof m !== 'object') return void e.push(`${mat} must be an object`);
      for (const k of Object.keys(m)) if (!memberKeys.has(k)) e.push(`${mat}: unknown property "${k}"`);
      if (typeof m.bindsId !== 'string' || typeof m.key !== 'string' || !m.key) return void e.push(`${mat}: bindsId and key are required`);
      if (m.deviceIndex !== undefined && (!Number.isInteger(m.deviceIndex) || m.deviceIndex < 0)) e.push(`${mat}: deviceIndex must be an integer ≥ 0`);
      if (typeof m.marker !== 'string' || !m.marker || m.marker.length > 12) e.push(`${mat} (${m.key}): marker must be 1–12 characters`);
      else if (markers.has(m.marker)) e.push(`${at}: marker "${m.marker}" is used twice`);
      else markers.add(m.marker);
      const k = ctlKey(m.bindsId, m.deviceIndex, m.key);
      const c = controls.get(k);
      if (!c) e.push(`${mat}: ${m.bindsId} ${m.key} is not in controls`);
      else if (c.box || c.leader) e.push(`${mat}: ${m.key} is in a group, so it can't have a box of its own`);
      if (grouped.has(k)) e.push(`${mat}: ${m.key} is already in group ${grouped.get(k)}`);
      else grouped.set(k, String(g.id));
    });
  });
  return e;
}

// ------------------------------------------------------------ zip

export interface DeviceImageFile {
  file: string;
  blob: Blob;
}

/** Where Elite Dangerous reads custom button names (.buttonMap files) that survive game updates. */
export const DEVICE_BUTTON_MAPS_DIR =
  '%LOCALAPPDATA%\\Frontier Developments\\Elite Dangerous\\Options\\Bindings\\DeviceButtonMaps\\';

export function contributingNote(def: DeviceDefinition): string {
  const ids = [...new Set(def.ids.map((i) => i.bindsId))];
  const maps = ids.filter((id) => controlsForBindsId(def, id).length);
  const mapList = maps.map((id) => `- \`buttonmaps/${id}.buttonMap\``).join('\n');
  return `# ${def.name}

This archive was made with the Elite Dangerous Bindings layout editor.

## What's in this archive

- \`devices/${def.id}/\`: the device definition (\`device.json\`) and its artwork.
  This is what goes into the Elite Dangerous Bindings repository.
${mapList}
  Your control labels as Elite Dangerous button-name files, for use in the game.
  **Not** part of the repository (see "In-game button names" below).
- \`CONTRIBUTING-DEVICE.md\`: this file.

## Add the device to the repository

1. Fork and clone the Elite Dangerous Bindings repository.
2. Copy the folder \`devices/${def.id}/\` from this archive into the repository's
   \`devices/\` folder. If you edited a device that already exists, replace its
   folder completely. Don't copy \`buttonmaps/\`: the labels are already in
   \`device.json\`.
3. Check it (inside the dev container, see CLAUDE.md):

   \`\`\`sh
   npm run devices:check
   \`\`\`

4. Open the app (\`npm start\`), go to **Devices → ${def.name}** and turn on
   **Boxes only** to check the layout.
5. Commit and open a pull request. Mention the controller's exact model and the
   device ID(s) Elite writes for it: ${ids.map((i) => `\`${i}\``).join(', ')}.

## Images and credit

Only include images you have the right to share: your own photo, your own
drawing, or artwork whose licence allows redistribution. Say where the image
came from in the pull request. Manufacturer marketing images usually may not be
redistributed.

## In-game button names (optional)

Elite Dangerous can show your own names for a controller's buttons and axes,
for example "Pinky trigger" instead of "Joy 3", in **Options › Controls** and in
its on-screen prompts. The \`.buttonMap\` files in \`buttonmaps/\` hold the labels
you gave each control, one file per device ID, named after the ID the game uses.

To use them:

1. Quit the game.
2. Copy the \`.buttonMap\` file(s) into this folder, creating
   \`DeviceButtonMaps\` if it doesn't exist:

   \`\`\`
   ${DEVICE_BUTTON_MAPS_DIR}
   \`\`\`

   Keep the file names exactly as they are (for example \`${maps[0] ?? ids[0]}.buttonMap\`):
   the game matches them to the device ID in your bindings file.
3. Start the game. It reads the names when you open **Options › Controls**.

Use this folder, not \`ControlSchemes\\DeviceButtonMaps\` in the game's install
folder: game updates overwrite that one. If a file contains invalid XML the game
silently ignores it, so re-export it from the editor rather than hand-editing
where possible. Labels can include Elite's icon tokens such as \`[x52prox]\`; see
the EliteCustomButtonNames project for the list.

These files use the same format as EDCD's EliteCustomButtonNames project, which
collects button names for many controllers. If yours isn't there, consider
offering them upstream so every player benefits:
https://github.com/EDCD/EliteCustomButtonNames
`;
}

/** Extension for an image blob, from its MIME type. */
export function extForType(type: string): 'webp' | 'png' | 'jpg' | 'svg' {
  if (type.includes('svg')) return 'svg';
  if (type.includes('png')) return 'png';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  return 'webp';
}

/**
 * A .zip in the repo's layout: devices/<id>/device.json + images,
 * buttonmaps/<bindsId>.buttonMap and CONTRIBUTING-DEVICE.md.
 */
export async function buildDeviceZip(def: DeviceDefinition, images: DeviceImageFile[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const dir = `devices/${def.id}`;
  zip.file(`${dir}/device.json`, deviceJson(def));
  for (const img of images) zip.file(`${dir}/${img.file}`, new Uint8Array(await img.blob.arrayBuffer()));
  for (const bindsId of new Set(def.ids.map((i) => i.bindsId))) {
    const controls = controlsForBindsId(def, bindsId);
    if (controls.length) zip.file(`buttonmaps/${bindsId}.buttonMap`, buttonMapXml(controls, def.name));
  }
  zip.file('CONTRIBUTING-DEVICE.md', contributingNote(def));
  const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

/** One file per Elite ID, or a zip of them when there are several. */
export async function buildButtonMapExport(def: DeviceDefinition): Promise<{ blob: Blob; filename: string } | null> {
  const files = [...new Set(def.ids.map((i) => i.bindsId))]
    .map((id) => ({ id, xml: buttonMapXml(controlsForBindsId(def, id), def.name) }))
    .filter((f) => controlsForBindsId(def, f.id).length);
  if (!files.length) return null;
  if (files.length === 1) {
    return { blob: new Blob([files[0].xml], { type: 'application/xml' }), filename: `${files[0].id}.buttonMap` };
  }
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const f of files) zip.file(`${f.id}.buttonMap`, f.xml);
  const data = await zip.generateAsync({ type: 'uint8array' });
  return { blob: new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), filename: `${def.id}-buttonmaps.zip` };
}

const MIME: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml' };

/**
 * Read a device .zip (repo layout, or device.json at the top level).
 * Returns the definition and its images in definition order.
 */
export async function readDeviceZip(data: Blob | ArrayBuffer): Promise<{ definition: DeviceDefinition; images: Blob[] }> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(data instanceof Blob ? await data.arrayBuffer() : data);
  const jsonPath = Object.keys(zip.files)
    .filter((p) => /(^|\/)device\.json$/.test(p) && !zip.files[p].dir)
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!jsonPath) throw new Error('No device.json found in the .zip');
  let definition: DeviceDefinition;
  try {
    definition = JSON.parse(await zip.file(jsonPath)!.async('string')) as DeviceDefinition;
  } catch {
    throw new Error('device.json in the .zip is not valid JSON');
  }
  const errors = schemaErrors(definition);
  if (errors.length) throw new Error(`device.json is not valid: ${errors.slice(0, 3).join('; ')}`);
  const base = jsonPath.slice(0, jsonPath.length - 'device.json'.length);
  const images: Blob[] = [];
  for (const img of definition.images) {
    const f = zip.file(base + img.file);
    if (!f) throw new Error(`Image ${img.file} is missing from the .zip`);
    const ext = img.file.split('.').pop()!.toLowerCase();
    images.push(new Blob([await f.async('uint8array') as Uint8Array<ArrayBuffer>], { type: MIME[ext] ?? 'application/octet-stream' }));
  }
  return { definition, images };
}
