/** Checks shown in the editor's "Check" step. */
import { bindsIdError, isValidDeviceId, schemaErrors } from '../../../core/devices/device-files';
import { findOverlaps, isOffImage } from '../../../core/devices/geometry';
import { DraftControl, EditorDraft, draftToDefinition, partLabel, placeableControls, primaryIds } from './draft';

export type StepId = 'image' | 'identify' | 'inventory' | 'place' | 'name' | 'check' | 'export';

export interface Issue {
  level: 'error' | 'warning';
  step: StepId;
  message: string;
  /** Controls concerned (select them to fix). */
  uids?: string[];
}

export interface ValidationContext {
  /** Ids of devices shipped with the app. */
  bundledIds: ReadonlySet<string>;
  /** Ids of devices saved in this browser. */
  localIds: ReadonlySet<string>;
  /** Id of another bundled device already handling this Elite ID, if any. */
  handledBy(bindsId: string, deviceIndex?: number): string | undefined;
}

const names = (cs: DraftControl[], max = 6) =>
  cs.slice(0, max).map((c) => c.label || c.key).join(', ') + (cs.length > max ? ` and ${cs.length - max} more` : '');

export function validateDraft(d: EditorDraft, ctx: ValidationContext): Issue[] {
  const out: Issue[] = [];
  const add = (level: Issue['level'], step: StepId, message: string, uids?: string[]) => out.push({ level, step, message, uids });

  // Identity.
  if (!d.name.trim()) add('error', 'identify', 'The device needs a name.');
  if (!d.id) add('error', 'identify', 'The device needs a folder id.');
  else if (!isValidDeviceId(d.id)) add('error', 'identify', `Folder id "${d.id}" may only use letters, digits and dashes.`);
  else if (d.id !== d.baseId && ctx.bundledIds.has(d.id)) {
    add('error', 'identify', `"${d.id}" is already a bundled device. Pick another id (or edit that device instead).`);
  } else if (d.id !== d.baseId && ctx.localIds.has(d.id)) {
    add('warning', 'identify', `Saving will replace the device "${d.id}" already saved in this browser.`);
  }
  if (!d.ids.length) add('error', 'identify', 'Add at least one Elite device ID.');
  const seen = new Set<string>();
  for (const id of d.ids) {
    const err = bindsIdError(id.bindsId);
    if (err) add('error', 'identify', `${id.bindsId || '(empty ID)'}: ${err}`);
    const k = `${id.bindsId}::${id.deviceIndex ?? '*'}`;
    if (seen.has(k)) add('error', 'identify', `${id.bindsId} is listed twice.`);
    seen.add(k);
    const other = ctx.handledBy(id.bindsId, id.deviceIndex);
    if (other && other !== d.baseId && other !== d.id) {
      add(
        'warning',
        'identify',
        `${id.bindsId} is already handled by the bundled device "${other}". Yours wins in this browser, but a pull request adding it as a new device would fail "npm run devices:check" — edit "${other}" instead.`,
      );
    }
  }

  // Images and controls.
  if (!d.images.length) add('warning', 'image', 'No image: the device will work, but without artwork.');
  const placeable = placeableControls(d);
  if (!d.controls.length) add('warning', 'inventory', 'No controls listed yet.');
  for (const p of primaryIds(d)) {
    const mine = d.controls.filter((c) => c.part === p.uid);
    const byKey = new Map<string, DraftControl[]>();
    const byLabel = new Map<string, DraftControl[]>();
    for (const c of mine) {
      byKey.set(c.key, [...(byKey.get(c.key) ?? []), c]);
      const l = c.label.trim().toLowerCase();
      if (l) byLabel.set(l, [...(byLabel.get(l) ?? []), c]);
    }
    for (const [key, cs] of byKey) if (cs.length > 1) add('error', 'inventory', `${partLabel(d, p.uid)}: ${key} is listed ${cs.length} times.`, cs.map((c) => c.uid));
    for (const cs of byLabel.values()) {
      if (cs.length > 1) add('warning', 'name', `Duplicate label "${cs[0].label}": ${cs.map((c) => c.key).join(', ')}.`, cs.map((c) => c.uid));
    }
    const unnamed = mine.filter((c) => !c.label.trim());
    if (unnamed.length) add('warning', 'name', `No label: ${unnamed.map((c) => c.key).join(', ')}.`, unnamed.map((c) => c.uid));
  }
  if (d.images.length) {
    const unplaced = placeable.filter((c) => !c.box);
    if (unplaced.length) add('warning', 'place', `${unplaced.length} control(s) have no box: ${names(unplaced)}.`, unplaced.map((c) => c.uid));
    d.images.forEach((img, i) => {
      const boxed = placeable.filter((c) => c.box && (c.image ?? 0) === i) as (DraftControl & { box: NonNullable<DraftControl['box']> })[];
      const off = boxed.filter((c) => isOffImage(c.box, img.width, img.height));
      if (off.length) add('warning', 'place', `Boxes off the image: ${names(off)}.`, off.map((c) => c.uid));
      for (const [a, b] of findOverlaps(boxed)) {
        add('warning', 'place', `Overlapping boxes: ${a.label || a.key} and ${b.label || b.key}.`, [a.uid, b.uid]);
      }
    });
  }
  const orphan = d.controls.filter((c) => c.box && (c.image ?? 0) >= d.images.length);
  if (orphan.length) add('error', 'place', `Boxes on a removed image: ${names(orphan)}.`, orphan.map((c) => c.uid));

  // Schema (only worth reporting once the basics are in place).
  if (!out.some((i) => i.level === 'error')) {
    for (const e of schemaErrors(draftToDefinition(d))) add('error', 'check', `device.json: ${e}`);
  }
  return out;
}
