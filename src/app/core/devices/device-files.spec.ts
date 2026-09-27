import Ajv from 'ajv/dist/2020';
import JSZip from 'jszip';
import schema from '../../../../schemas/device.schema.json';
import { DeviceDefinition } from '../data/catalog.types';
import {
  bindsIdError,
  buildButtonMapExport,
  buildDeviceZip,
  buttonMapXml,
  deviceJson,
  escapeXml,
  normalizeBindsId,
  normalizeDefinition,
  parseButtonMap,
  readDeviceZip,
  schemaErrors,
  slugifyDeviceId,
  usbFromBindsId,
} from './device-files';

const validate = new Ajv({ allErrors: true }).compile(schema);

function sample(): DeviceDefinition {
  return {
    id: 'My-Stick',
    name: 'My <Stick> & Co',
    source: 'user',
    ids: [{ bindsId: '231D0200', usb: { vid: '231D', pid: '0200' } }, { bindsId: 'MyStickNamed' }],
    images: [{ file: 'My-Stick.webp', width: 1000, height: 500 }],
    controls: [
      { bindsId: '231D0200', key: 'Joy_1', label: 'Trigger & "fire" <1>', kind: 'button', image: 0, box: { x: 10.4, y: 20, w: 100, h: 30 } },
      { bindsId: '231D0200', key: 'Joy_XAxis', label: 'Stick [x52prox]', kind: 'axis', image: 0, box: { x: 200, y: 20, w: 100, h: 30 } },
      { bindsId: '231D0200', key: 'Pos_Joy_XAxis', label: 'Stick +', kind: 'axis', image: 0, box: { x: 200, y: 20, w: 100, h: 30 } },
      { bindsId: '231D0200', key: 'Joy_POV1Up', label: 'Hat Up', kind: 'hat' },
      { bindsId: 'MyStickNamed', key: 'Joy_1', label: 'Trigger', kind: 'button', image: 0, box: { x: 10, y: 20, w: 100, h: 30 } },
    ],
  };
}

describe('ids and slugs', () => {
  it('slugifies names into folder ids', () => {
    expect(slugifyDeviceId('Thrustmaster T.Flight HOTAS X')).toBe('Thrustmaster-T-Flight-HOTAS-X');
    expect(slugifyDeviceId('  VKB  Gladiator NXT (Left) ')).toBe('VKB-Gladiator-NXT-Left');
    expect(slugifyDeviceId('Crème brûlée ✈ stick')).toBe('Creme-brulee-stick');
    expect(slugifyDeviceId('***')).toBe('device');
    expect(slugifyDeviceId('a'.repeat(100)).length).toBe(64);
    expect(slugifyDeviceId('Logitech/Saitek X56')).toMatch(/^[A-Za-z0-9][A-Za-z0-9-]*$/);
  });

  it('validates and normalises Elite device IDs', () => {
    expect(normalizeBindsId(' 231d0200 ')).toBe('231D0200');
    expect(normalizeBindsId('SaitekX56Joystick')).toBe('SaitekX56Joystick');
    expect(bindsIdError('231D0200')).toBeNull();
    expect(bindsIdError('XB360 Pad')).toBeNull();
    expect(bindsIdError('SaitekX56Joystick')).toBeNull();
    expect(bindsIdError('231D020')).toMatch(/8 hex/);
    expect(bindsIdError('')).toBeTruthy();
    expect(bindsIdError('Keyboard')).toBeTruthy();
    expect(bindsIdError('<bad>')).toBeTruthy();
    expect(usbFromBindsId('231d0200')).toEqual({ vid: '231D', pid: '0200' });
    expect(usbFromBindsId('SaitekX56Joystick')).toBeUndefined();
  });
});

describe('device.json', () => {
  it('generates schema-valid output with stable key order and formatting', () => {
    const text = deviceJson(sample());
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "id": "My-Stick"');
    const parsed = JSON.parse(text);
    expect(validate(parsed)).toBe(true);
    expect(Object.keys(parsed)).toEqual(['$schema', 'id', 'name', 'source', 'ids', 'images', 'controls']);
    expect(parsed.$schema).toBe('../../schemas/device.schema.json');
    expect(Object.keys(parsed.controls[0])).toEqual(['bindsId', 'key', 'label', 'kind', 'image', 'box']);
    expect(parsed.controls[3]).toEqual({ bindsId: '231D0200', key: 'Joy_POV1Up', label: 'Hat Up', kind: 'hat' });
    // Same input, same bytes.
    expect(deviceJson(JSON.parse(text))).toBe(text);
  });

  it('keeps optional fields in order', () => {
    const def = { ...sample(), keyBindsIds: ['231D0200'], inputCorrections: { '231D0200': { buttonOffset: 1 } } };
    def.ids[0].deviceIndex = 1;
    const parsed = JSON.parse(deviceJson(def));
    expect(validate(parsed)).toBe(true);
    expect(Object.keys(parsed)).toEqual(['$schema', 'id', 'name', 'source', 'ids', 'keyBindsIds', 'images', 'controls', 'inputCorrections']);
    expect(Object.keys(parsed.ids[0])).toEqual(['bindsId', 'deviceIndex', 'usb']);
  });

  it('writes leader lines after the box, rounded, and only with a box', () => {
    const def = sample();
    def.controls[0].leader = [{ x: 300.123, y: 40 }, { x: 420, y: 80.456 }];
    def.controls[3].leader = [{ x: 1, y: 2 }];
    const parsed = JSON.parse(deviceJson(def));
    expect(validate(parsed)).toBe(true);
    expect(Object.keys(parsed.controls[0])).toEqual(['bindsId', 'key', 'label', 'kind', 'image', 'box', 'leader']);
    expect(parsed.controls[0].leader).toEqual([{ x: 300.12, y: 40 }, { x: 420, y: 80.46 }]);
    expect(parsed.controls[3].leader).toBeUndefined();
    expect(schemaErrors(parsed)).toEqual([]);
  });

  it('writes groups and drawBoxes in a stable order and round-trips them', () => {
    const def = sample();
    def.controls.push(
      { bindsId: '231D0200', key: 'Joy_POV1Down', label: 'Hat Down', kind: 'hat' },
      { bindsId: '231D0200', key: 'Joy_5', label: 'Hat push', kind: 'button' },
    );
    def.drawBoxes = true;
    def.groups = [
      {
        members: [
          { key: 'Joy_POV1Up', bindsId: '231D0200', marker: '↑' },
          { bindsId: '231D0200', key: 'Joy_POV1Down', marker: '↓' },
          { bindsId: '231D0200', key: 'Joy_5', marker: '●' },
        ],
        box: { x: 10.333, y: 300, w: 400, h: 120 },
        label: 'H1',
        id: 'H1',
        showLabel: true,
        leader: [{ x: 500, y: 350 }],
      },
    ];
    const text = deviceJson(def);
    const parsed = JSON.parse(text);
    expect(validate(parsed)).toBe(true);
    expect(schemaErrors(parsed)).toEqual([]);
    expect(Object.keys(parsed)).toEqual(['$schema', 'id', 'name', 'source', 'ids', 'images', 'drawBoxes', 'controls', 'groups']);
    expect(Object.keys(parsed.groups[0])).toEqual(['id', 'label', 'layout', 'image', 'box', 'leader', 'members']);
    expect(parsed.groups[0]).toMatchObject({ layout: 'stack', image: 0, box: { x: 10.33, y: 300, w: 400, h: 120 } });
    expect(Object.keys(parsed.groups[0].members[0])).toEqual(['bindsId', 'key', 'marker']);
    expect(deviceJson(parsed)).toBe(text);
    // showLabel is only written when false; drawBoxes only when true.
    def.groups[0].showLabel = false;
    def.drawBoxes = false;
    const again = JSON.parse(deviceJson(def));
    expect(again.groups[0].showLabel).toBe(false);
    expect(again.drawBoxes).toBeUndefined();
  });

  it('checks group rules beyond the schema', () => {
    const base = (): DeviceDefinition => {
      const d = sample();
      d.controls.push({ bindsId: '231D0200', key: 'Joy_5', label: 'Push', kind: 'button' });
      d.groups = [
        {
          id: 'H1',
          label: 'H1',
          box: { x: 0, y: 0, w: 100, h: 60 },
          members: [
            { bindsId: '231D0200', key: 'Joy_POV1Up', marker: '↑' },
            { bindsId: '231D0200', key: 'Joy_5', marker: '●' },
          ],
        },
      ];
      return d;
    };
    expect(schemaErrors(base())).toEqual([]);
    const errs = (mutate: (d: DeviceDefinition) => void) => {
      const d = base();
      mutate(d);
      return schemaErrors(d).join('\n');
    };
    expect(errs((d) => (d.groups![0].members[1].marker = '↑'))).toMatch(/marker "↑" is used twice/);
    expect(errs((d) => (d.groups![0].members[1].key = 'Joy_99'))).toMatch(/not in controls/);
    expect(errs((d) => (d.groups![0].members[0].key = 'Joy_1'))).toMatch(/can't have a box of its own/);
    expect(errs((d) => d.groups!.push({ ...d.groups![0], id: 'H2' }))).toMatch(/already in group H1/);
    expect(errs((d) => d.groups!.push({ ...d.groups![0] }))).toMatch(/used twice/);
    expect(errs((d) => (d.groups![0].image = 4))).toMatch(/missing image/);
  });

  it('schemaErrors agrees with the JSON schema', () => {
    const cases: [string, (d: DeviceDefinition) => void][] = [
      ['bad id', (d) => (d.id = '-bad id')],
      ['no name', (d) => (d.name = '')],
      ['no ids', (d) => (d.ids = [])],
      ['bad usb', (d) => (d.ids[0].usb = { vid: '231d', pid: '0200' })],
      ['bad file', (d) => (d.images[0].file = 'x/y.gif')],
      ['zero width', (d) => (d.controls[0].box!.w = 0)],
      ['bad kind', (d) => ((d.controls[0] as { kind: string }).kind = 'slider')],
      ['bad source', (d) => ((d as { source: string }).source = 'mine')],
      ['extra prop', (d) => ((d as unknown as Record<string, unknown>)['extra'] = 1)],
      ['extra control prop', (d) => ((d.controls[0] as unknown as Record<string, unknown>)['colour'] = 'red')],
      ['empty leader', (d) => (d.controls[0].leader = [])],
      ['bad leader point', (d) => (d.controls[0].leader = [{ x: 1, y: 'a' as unknown as number }])],
      ['leader point extra prop', (d) => (d.controls[0].leader = [{ x: 1, y: 2, z: 3 } as { x: number; y: number }])],
      ['leader without box', (d) => (d.controls[3].leader = [{ x: 1, y: 2 }])],
      ['drawBoxes not boolean', (d) => ((d as unknown as Record<string, unknown>)['drawBoxes'] = 'yes')],
      ['group with one member', (d) => (d.groups = [{ id: 'G', label: 'G', box: { x: 0, y: 0, w: 1, h: 1 }, members: [{ bindsId: '231D0200', key: 'Joy_POV1Up', marker: '↑' }] }])],
      ['group bad layout', (d) => (d.groups = [{ id: 'G', label: 'G', layout: 'compass' as 'row', box: { x: 0, y: 0, w: 1, h: 1 }, members: [] }])],
      ['group bad id', (d) => (d.groups = [{ id: '-G', label: 'G', box: { x: 0, y: 0, w: 1, h: 1 }, members: [] }])],
      ['group no box', (d) => (d.groups = [{ id: 'G', label: 'G', members: [] } as unknown as NonNullable<DeviceDefinition['groups']>[number]])],
      ['member empty marker', (d) => (d.groups = [{ id: 'G', label: 'G', box: { x: 0, y: 0, w: 1, h: 1 }, members: [{ bindsId: 'a', key: 'b', marker: '' }, { bindsId: 'a', key: 'c', marker: 'x' }] }])],
    ];
    const withLeader = sample();
    withLeader.controls[0].leader = [{ x: 400, y: 200 }];
    const good = normalizeDefinition(withLeader);
    expect(validate(good)).toBe(true);
    expect(schemaErrors(good)).toEqual([]);
    for (const [name, mutate] of cases) {
      const d = JSON.parse(JSON.stringify(good)) as DeviceDefinition;
      mutate(d);
      expect({ name, ajv: validate(d) }).toEqual({ name, ajv: false });
      expect({ name, ours: schemaErrors(d).length > 0 }).toEqual({ name, ours: true });
    }
  });

  it('flags controls pointing at a missing image', () => {
    const d = sample();
    d.controls[0].image = 3;
    expect(schemaErrors(d).join()).toMatch(/missing image/);
  });
});

describe('.buttonMap', () => {
  it('escapes labels and writes EDCD format', () => {
    const xml = buttonMapXml(sample().controls.filter((c) => c.bindsId === '231D0200'), 'My -- Stick');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" ?>\n<!-- My - - Stick -->\n<Root>')).toBe(true);
    expect(xml).toContain('<Joy_1>Trigger &amp; "fire" &lt;1&gt;</Joy_1>');
    expect(xml).toContain('<Joy_XAxis>Stick [x52prox]</Joy_XAxis>');
    expect(xml).not.toContain('Pos_Joy_XAxis');
    expect(xml.indexOf('Joy_XAxis')).toBeLessThan(xml.indexOf('Joy_POV1Up'));
    expect(xml.indexOf('Joy_POV1Up')).toBeLessThan(xml.indexOf('<Joy_1>'));
    // Parses as XML and round-trips the labels.
    const back = parseButtonMap(xml);
    expect(back.name).toBe('My - - Stick');
    expect(back.labels.find((l) => l.key === 'Joy_1')?.label).toBe('Trigger & "fire" <1>');
  });

  it('orders buttons numerically', () => {
    const xml = buttonMapXml([
      { key: 'Joy_10', label: 'ten', kind: 'button' },
      { key: 'Joy_2', label: 'two', kind: 'button' },
    ]);
    expect(xml.indexOf('Joy_2')).toBeLessThan(xml.indexOf('Joy_10'));
  });

  it('drops control characters', () => {
    expect(escapeXml('a\u0001b\tc')).toBe('ab\tc');
  });

  it('exports one file per ID, zipped when several', async () => {
    const single = await buildButtonMapExport({ ...sample(), ids: [{ bindsId: '231D0200' }] });
    expect(single?.filename).toBe('231D0200.buttonMap');
    const multi = await buildButtonMapExport(sample());
    expect(multi?.filename).toBe('My-Stick-buttonmaps.zip');
    const zip = await JSZip.loadAsync(await multi!.blob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(['231D0200.buttonMap', 'MyStickNamed.buttonMap']);
  });
});

describe('device zip', () => {
  it('lays files out like the repo and reads back', async () => {
    const png = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/webp' });
    const def = sample();
    const blob = await buildDeviceZip(def, [{ file: 'My-Stick.webp', blob: png }]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files).filter((p) => !zip.files[p].dir).sort()).toEqual([
      'CONTRIBUTING-DEVICE.md',
      'buttonmaps/231D0200.buttonMap',
      'buttonmaps/MyStickNamed.buttonMap',
      'devices/My-Stick/My-Stick.webp',
      'devices/My-Stick/device.json',
    ]);
    const json = await zip.file('devices/My-Stick/device.json')!.async('string');
    expect(json).toBe(deviceJson(def));
    expect(validate(JSON.parse(json))).toBe(true);
    const img = await zip.file('devices/My-Stick/My-Stick.webp')!.async('uint8array');
    expect(Array.from(img)).toEqual([137, 80, 78, 71, 1, 2, 3]);
    const readme = await zip.file('CONTRIBUTING-DEVICE.md')!.async('string');
    expect(readme).toContain('npm run devices:check');
    // It explains the .buttonMap files: listed, not for the repo, where the game reads them, upstream.
    expect(readme).toContain('- `buttonmaps/231D0200.buttonMap`');
    expect(readme).toContain('- `buttonmaps/MyStickNamed.buttonMap`');
    expect(readme).toContain("Don't copy `buttonmaps/`");
    expect(readme).toContain('%LOCALAPPDATA%\\Frontier Developments\\Elite Dangerous\\Options\\Bindings\\DeviceButtonMaps\\');
    expect(readme).toContain('game updates overwrite that one');
    expect(readme).toContain('https://github.com/EDCD/EliteCustomButtonNames');

    const back = await readDeviceZip(blob);
    expect(back.definition.id).toBe('My-Stick');
    expect(back.images.length).toBe(1);
    expect(back.images[0].type).toBe('image/webp');
  });

  it('rejects zips without a valid device.json', async () => {
    const zip = new JSZip();
    zip.file('readme.txt', 'hi');
    await expect(readDeviceZip(await zip.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow(/No device.json/);
    const bad = new JSZip();
    bad.file('device.json', JSON.stringify({ id: 'x' }));
    await expect(readDeviceZip(await bad.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow(/not valid/);
  });
});
