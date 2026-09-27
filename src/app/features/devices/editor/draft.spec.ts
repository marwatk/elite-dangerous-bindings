import Ajv from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import schema from '../../../../../schemas/device.schema.json';
import { DeviceControl, DeviceDefinition } from '../../../core/data/catalog.types';
import { deviceJson, normalizeDefinition } from '../../../core/devices/device-files';
import { EditorDraft, definitionToDraft, draftToDefinition, emptyDraft, imageFileNames, placeableControls, primaryIds } from './draft';

const validate = new Ajv({ allErrors: true }).compile(schema);
const load = (id: string) => JSON.parse(readFileSync(resolve(process.cwd(), `devices/${id}/device.json`), 'utf-8')) as DeviceDefinition;
const blob = () => new Blob([new Uint8Array([1])], { type: 'image/webp' });
const sortControls = (cs: DeviceControl[]) =>
  normalizeDefinition({ id: 'x', name: 'x', source: 'user', ids: [], images: [], controls: cs })
    .controls.map((c) => JSON.stringify(c))
    .sort();

describe('draft <-> definition', () => {
  it('round-trips the X56 (parts, aliases with their own labels, boxes)', () => {
    const def = load('SaitekX56');
    const d = definitionToDraft(def, def.images.map(blob));
    // 0738A221 numbers Joy_4/Joy_5 the other way round, so it stays a part of its own.
    expect(primaryIds(d).map((i) => i.bindsId)).toEqual(['SaitekX56Joystick', 'SaitekX56Throttle', '0738A221']);
    const alias = d.ids.find((i) => i.aliasOf)!;
    expect(alias.bindsId).toBe('07382221');
    expect(alias.labelOverrides?.['Joy_1']).toBe('1');
    // Controls are held once per part.
    expect(d.controls.length).toBe(def.controls.length - def.controls.filter((c) => c.bindsId === '07382221').length);
    const back = draftToDefinition(d, def.source);
    expect(back.ids).toEqual(def.ids);
    expect(sortControls(back.controls)).toEqual(sortControls(def.controls));
    expect(back.images).toEqual(def.images);
    expect(validate(JSON.parse(deviceJson(back)))).toBe(true);
  });

  it('round-trips every bundled device without losing controls', () => {
    const ids = readFileSync(resolve(process.cwd(), 'public/data/devices.index.json'), 'utf-8');
    for (const { id } of JSON.parse(ids) as { id: string }[]) {
      const def = load(id);
      const back = draftToDefinition(definitionToDraft(def, def.images.map(blob)), def.source);
      expect({ id, controls: sortControls(back.controls) }).toEqual({ id, controls: sortControls(def.controls) });
    }
  });

  it('gives axis halves their axis box and hides them from the checklist', () => {
    const d: EditorDraft = {
      ...emptyDraft(),
      id: 'T',
      name: 'T',
      ids: [{ uid: 'p', bindsId: '12345678' }],
      images: [{ uid: 'i', name: 'x.png', blob: blob(), type: 'webp', width: 100, height: 100 }],
      controls: [
        { uid: 'a', part: 'p', key: 'Joy_XAxis', label: 'X', kind: 'axis', image: 0, box: { x: 1, y: 2, w: 30, h: 10 } },
        { uid: 'b', part: 'p', key: 'Pos_Joy_XAxis', label: 'X+', kind: 'axis' },
        { uid: 'c', part: 'p', key: 'Neg_Joy_YAxis', label: 'Y-', kind: 'axis' },
      ],
    };
    expect(placeableControls(d).map((c) => c.uid)).toEqual(['a', 'c']);
    const def = draftToDefinition(d);
    expect(def.controls[1].box).toEqual({ x: 1, y: 2, w: 30, h: 10 });
    expect(def.controls[2].box).toBeUndefined();
    expect(def.ids[0].usb).toEqual({ vid: '1234', pid: '5678' });
    expect(validate(JSON.parse(deviceJson(def)))).toBe(true);
  });

  it('names image files uniquely and keeps existing names', () => {
    const img = (file?: string, type: 'webp' | 'svg' = 'webp') => ({ uid: String(Math.random()), name: 'n', file, blob: blob(), type, width: 1, height: 1 });
    const d = { ...emptyDraft(), id: 'Dev', images: [img(), img('front.webp'), img('front.webp'), img('old.png'), img(undefined, 'svg')] };
    expect(imageFileNames(d)).toEqual(['Dev.webp', 'front.webp', 'Dev-3.webp', 'Dev-4.webp', 'Dev-5.svg']);
  });
});
