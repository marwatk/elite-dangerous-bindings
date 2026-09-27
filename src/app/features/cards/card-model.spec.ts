import { BindsDocument } from '../../core/binds/binds-document';
import { ActionInfo, DeviceDefinition, DeviceSummary } from '../../core/data/catalog.types';
import {
  CardEntry,
  CardOptions,
  DeviceCard,
  KeyboardCard,
  aliasContext,
  aliasRef,
  buildCards,
  chooseCards,
  usedDevices,
} from './card-model';
import { CARD_GROUPS } from './palette';

// ------------------------------------------------------------ fixtures

type Slot = { device: string; key: string; index?: number; mods?: [string, string][]; hold?: boolean };

function slotXml(name: string, s?: Slot): string {
  if (!s) return `<${name} Device="{NoDevice}" Key="" />`;
  const idx = s.index ? ` DeviceIndex="${s.index}"` : '';
  const inner = [
    ...(s.mods ?? []).map(([d, k]) => `<Modifier Device="${d}" Key="${k}" />`),
    ...(s.hold ? ['<Hold Value="1" />'] : []),
  ].join('');
  return inner
    ? `<${name} Device="${s.device}"${idx} Key="${s.key}">${inner}</${name}>`
    : `<${name} Device="${s.device}"${idx} Key="${s.key}" />`;
}

function file(actions: Record<string, { primary?: Slot; secondary?: Slot; binding?: Slot }>): BindsDocument {
  const body = Object.entries(actions)
    .map(([code, a]) =>
      a.binding
        ? `<${code}>${slotXml('Binding', a.binding)}<Inverted Value="0" /><Deadzone Value="0.00000000" /></${code}>`
        : `<${code}>${slotXml('Primary', a.primary)}${slotXml('Secondary', a.secondary)}</${code}>`,
    )
    .join('\n');
  return BindsDocument.parse(`<?xml version="1.0" encoding="UTF-8" ?>\n<Root PresetName="T" MajorVersion="4" MinorVersion="2">\n${body}\n</Root>`);
}

const META: Record<string, Partial<ActionInfo>> = {
  PrimaryFire: { name: 'Primary Fire', group: 'Ship', category: 'Combat', order: 1 },
  SecondaryFire: { name: 'Secondary Fire', group: 'Ship', category: 'Combat', order: 2 },
  UseBoostJuice: { name: 'Boost', group: 'Ship', category: 'Navigation', order: 3, short: 'BOOST' },
  LandingGearToggle: { name: 'Landing Gear', group: 'Ship', category: 'Navigation', order: 4, short: 'GEAR' },
  PitchAxisRaw: { name: 'Pitch', group: 'Ship', category: 'Navigation', order: 5, type: 'analogue' },
  CamPitchAxis: { name: 'GalMap Pitch', group: 'Galaxy map', category: 'Navigation', order: 6, hideIfSameAs: ['PitchAxisRaw'] },
  BuggyPrimaryFireButton: { name: 'SRV Fire', group: 'SRV', category: 'Combat', order: 7 },
  ThrottleAxis: { name: 'Throttle', group: 'Ship', category: 'Navigation', order: 8, type: 'analogue' },
  UI_Up: { name: 'UI Up', group: 'UI', category: 'UI', order: 9 },
};

function meta(code: string): ActionInfo {
  const m = META[code] ?? {};
  return {
    code,
    name: code,
    longName: code,
    group: 'Misc',
    category: 'General',
    area: 'A',
    section: 'S',
    type: 'digital',
    order: 100,
    ...m,
  } as ActionInfo;
}

function summary(d: DeviceDefinition): DeviceSummary {
  return {
    id: d.id,
    name: d.name,
    source: d.source,
    ids: d.ids,
    keyBindsIds: d.keyBindsIds,
    images: d.images,
    controlCount: d.controls.length,
  };
}

const IMG = [{ file: 'a.webp', width: 3840, height: 2160 }];
const box = (y: number) => ({ x: 100, y, w: 800, h: 54 });

const X56: DeviceDefinition = {
  id: 'SaitekX56',
  name: 'X56',
  source: 'edrefcard2',
  ids: [{ bindsId: 'SaitekX56Joystick' }, { bindsId: 'SaitekX56Throttle' }],
  images: IMG,
  controls: [
    { bindsId: 'SaitekX56Joystick', key: 'Joy_1', label: 'Trigger', kind: 'button', box: box(100) },
    { bindsId: 'SaitekX56Joystick', key: 'Joy_2', label: 'A', kind: 'button', box: box(200) },
    { bindsId: 'SaitekX56Joystick', key: 'Joy_YAxis', label: 'Y', kind: 'axis', box: box(300) },
    { bindsId: 'SaitekX56Throttle', key: 'Joy_1', label: 'E', kind: 'button', box: box(400) },
    { bindsId: 'SaitekX56Throttle', key: 'Joy_ZAxis', label: 'Throttle', kind: 'axis', box: box(500) },
  ],
};

const T16: DeviceDefinition = {
  id: 'T16000M',
  name: 'T.16000M',
  source: 'edrefcard2',
  ids: [{ bindsId: 'T16000M' }],
  images: IMG,
  controls: [{ bindsId: 'T16000M', key: 'Joy_1', label: 'Trigger', kind: 'button', box: box(100) }],
};

const FCS: DeviceDefinition = {
  id: 'T16000MFCS',
  name: 'T.16000M FCS',
  source: 'edrefcard2',
  ids: [{ bindsId: 'T16000MFCS' }, { bindsId: 'T16000MTHROTTLE' }],
  images: IMG,
  controls: [
    { bindsId: 'T16000MFCS', key: 'Joy_1', label: 'Trigger', kind: 'button', box: box(100) },
    { bindsId: 'T16000MTHROTTLE', key: 'Joy_1', label: 'Button 1', kind: 'button', box: box(200) },
  ],
};

const COMBAT: DeviceDefinition = {
  id: 'CHCombatStick',
  name: 'CH Combat Stick',
  source: 'edrefcard2',
  ids: [{ bindsId: 'CHCombatStick' }, { bindsId: 'CHProThrottle1' }],
  keyBindsIds: ['CHCombatStick'],
  images: IMG,
  controls: [
    { bindsId: 'CHCombatStick', key: 'Joy_1', label: 'Trigger', kind: 'button', box: box(100) },
    { bindsId: 'CHProThrottle1', key: 'Joy_1', label: 'Button 1', kind: 'button', box: box(200) },
  ],
};

const CHTHROTTLE: DeviceDefinition = {
  id: 'CHProThrottle',
  name: 'CH Pro Throttle',
  source: 'edrefcard2',
  ids: [{ bindsId: 'CHProThrottle1' }],
  images: IMG,
  controls: [{ bindsId: 'CHProThrottle1', key: 'Joy_1', label: 'Button 1', kind: 'button', box: box(200) }],
};

const STECS1: DeviceDefinition = {
  id: 'STECS-VC1',
  name: 'STECS VC1',
  source: 'edrefcard2',
  ids: [{ bindsId: '231D012D', deviceIndex: 0 }],
  images: IMG,
  controls: [{ bindsId: '231D012D', deviceIndex: 0, key: 'Joy_1', label: 'B1', kind: 'button', box: box(100) }],
};

const STECS2: DeviceDefinition = {
  id: 'STECS-VC2',
  name: 'STECS VC2',
  source: 'edrefcard2',
  ids: [{ bindsId: '231D012D', deviceIndex: 1 }],
  images: IMG,
  controls: [{ bindsId: '231D012D', deviceIndex: 1, key: 'Joy_1', label: 'B1', kind: 'button', box: box(700) }],
};

const NOART: DeviceDefinition = {
  id: 'EDCD-1234',
  name: 'Something',
  source: 'edcd',
  ids: [{ bindsId: '12345678' }],
  images: [],
  controls: [{ bindsId: '12345678', key: 'Joy_1', label: 'B1', kind: 'button' }],
};

const DEFS = [X56, T16, FCS, COMBAT, CHTHROTTLE, STECS1, STECS2, NOART];
const DEVICES = DEFS.map(summary);
const ALL_GROUPS: CardOptions = { groups: new Set(CARD_GROUPS.map((g) => g.value)), compact: false };

function build(doc: BindsDocument, options: CardOptions = ALL_GROUPS) {
  return buildCards({
    actions: doc.actions(),
    meta,
    devices: DEVICES,
    definition: (id) => DEFS.find((d) => d.id === id),
    options,
  });
}

function texts(card: DeviceCard | undefined, y: number): string[] {
  return card?.spots.find((s) => s.box.y === y)?.entries.map((e: CardEntry) => e.text) ?? [];
}

function device(set: ReturnType<typeof build>, id: string): DeviceCard | undefined {
  return set.cards.find((c): c is DeviceCard => c.kind === 'device' && c.id === id);
}

// ------------------------------------------------------------ tests

describe('card selection', () => {
  it('puts a stick and throttle on one card', () => {
    const doc = file({
      PrimaryFire: { primary: { device: 'SaitekX56Joystick', key: 'Joy_1' } },
      SecondaryFire: { primary: { device: 'SaitekX56Throttle', key: 'Joy_1' } },
    });
    const set = build(doc);
    expect(set.cards.map((c) => c.id)).toEqual(['SaitekX56::0']);
    const card = device(set, 'SaitekX56::0');
    expect(texts(card, 100)).toEqual(['Primary Fire']);
    expect(texts(card, 400)).toEqual(['Secondary Fire']);
  });

  it('makes one card per device index for identical devices', () => {
    const doc = file({
      PrimaryFire: { primary: { device: 'T16000M', key: 'Joy_1' } },
      SecondaryFire: { primary: { device: 'T16000M', key: 'Joy_1', index: 1 } },
    });
    const set = build(doc);
    expect(set.cards.map((c) => c.id)).toEqual(['T16000M::0', 'T16000M::1']);
    expect(texts(device(set, 'T16000M::0'), 100)).toEqual(['Primary Fire']);
    expect(texts(device(set, 'T16000M::1'), 100)).toEqual(['Secondary Fire']);
  });

  it('uses device-index-specific definitions', () => {
    const doc = file({
      PrimaryFire: { primary: { device: '231D012D', key: 'Joy_1' } },
      SecondaryFire: { primary: { device: '231D012D', key: 'Joy_1', index: 1 } },
    });
    const set = build(doc);
    expect(set.cards.map((c) => c.id)).toEqual(['STECS-VC1::0', 'STECS-VC2::1']);
    expect(texts(device(set, 'STECS-VC2::1'), 700)).toEqual(['Secondary Fire']);
  });

  it('honours key devices: a throttle alone gets its own card', () => {
    const alone = chooseCards([{ device: 'CHProThrottle1', deviceIndex: 0 }], DEVICES);
    expect(alone.map((c) => c.deviceId)).toEqual(['CHProThrottle']);
    const both = chooseCards(
      [
        { device: 'CHCombatStick', deviceIndex: 0 },
        { device: 'CHProThrottle1', deviceIndex: 0 },
      ],
      DEVICES,
    );
    expect(both.map((c) => c.deviceId)).toEqual(['CHCombatStick']);
  });

  it('maps a T.16000M stick to the FCS card when the TFRP throttle is used', () => {
    const doc = file({
      PrimaryFire: { primary: { device: 'T16000M', key: 'Joy_1' } },
      SecondaryFire: { primary: { device: 'T16000MTHROTTLE', key: 'Joy_1' } },
    });
    expect(usedDevices(doc.actions()).map((d) => d.device)).toEqual(['T16000MFCS', 'T16000MTHROTTLE']);
    const set = build(doc);
    expect(set.cards.map((c) => c.id)).toEqual(['T16000MFCS::0']);
    expect(texts(device(set, 'T16000MFCS::0'), 100)).toEqual(['Primary Fire']);
  });

  it('rewrites VPC CM3 throttles in 32-button mode', () => {
    const ctx = aliasContext([
      { device: '33448197', deviceIndex: 0 },
      { device: '33448197', deviceIndex: 2 },
    ]);
    expect(aliasRef({ device: '33448197', deviceIndex: 2, key: 'Joy_1' }, ctx)).toEqual({
      device: 'VPC-MongoosT-50CM3-Throttle-32B2',
      deviceIndex: 0,
      key: 'Joy_1',
    });
  });

  it('gives the keyboard its own card and lists mouse and unsupported bindings', () => {
    const doc = file({
      PrimaryFire: { primary: { device: 'Keyboard', key: 'Key_Space' }, secondary: { device: 'Mouse', key: 'Mouse_1' } },
      SecondaryFire: { primary: { device: 'ABCD0001', key: 'Joy_3' } },
      UseBoostJuice: { primary: { device: '12345678', key: 'Joy_1' } },
      LandingGearToggle: { primary: { device: 'SaitekX56Joystick', key: 'Joy_9' } },
    });
    const set = build(doc);
    expect(set.cards.map((c) => c.id)).toEqual(['SaitekX56::0', 'Keyboard']);
    const kb = set.cards.find((c): c is KeyboardCard => c.kind === 'keyboard')!;
    expect(kb.keys.get('Key_Space')!.map((e) => e.text)).toEqual(['Primary Fire']);
    const reasons = Object.fromEntries(set.unplaced.map((u) => [`${u.device}:${u.key}`, u.reason]));
    expect(reasons).toEqual({
      'Mouse:Mouse_1': 'mouse',
      'ABCD0001:Joy_3': 'unsupported',
      '12345678:Joy_1': 'no-artwork',
      'SaitekX56Joystick:Joy_9': 'no-box',
    });
  });
});

describe('card text', () => {
  it('numbers modifiers and marks the modifier keys', () => {
    const doc = file({
      PrimaryFire: { primary: { device: 'SaitekX56Joystick', key: 'Joy_1' } },
      SecondaryFire: {
        primary: { device: 'SaitekX56Joystick', key: 'Joy_1', mods: [['SaitekX56Throttle', 'Joy_1']] },
      },
      UseBoostJuice: {
        primary: {
          device: 'SaitekX56Joystick',
          key: 'Joy_2',
          mods: [
            ['SaitekX56Throttle', 'Joy_1'],
            ['Keyboard', 'Key_LeftShift'],
          ],
        },
      },
      LandingGearToggle: { primary: { device: 'SaitekX56Joystick', key: 'Joy_2', hold: true } },
    });
    const set = build(doc);
    expect(set.modifiers.map((m) => m.number)).toEqual([1, 2]);
    expect(set.modifiers[1].keys.map((k) => k.key).sort()).toEqual(['Joy_1', 'Key_LeftShift']);
    const card = device(set, 'SaitekX56::0');
    expect(texts(card, 100)).toEqual(['Primary Fire', 'Secondary Fire[1]']);
    expect(texts(card, 200)).toEqual(['Landing Gear (hold)', 'Boost[2]']);
    // The throttle button is part of both modifier combinations.
    expect(texts(card, 400)).toEqual(['Modifier 1', 'Modifier 2']);
    const kb = set.cards.find((c): c is KeyboardCard => c.kind === 'keyboard')!;
    expect(kb.keys.get('Key_LeftShift')!.map((e) => e.text)).toEqual(['Modifier 2']);
  });

  it('draws axis halves in the axis box', () => {
    const doc = file({
      ThrottleAxis: { binding: { device: 'SaitekX56Throttle', key: 'Joy_ZAxis' } },
      LandingGearToggle: { primary: { device: 'SaitekX56Throttle', key: 'Pos_Joy_ZAxis' } },
    });
    const spot = device(build(doc), 'SaitekX56::0')!.spots.find((s) => s.box.y === 500)!;
    expect(spot.entries.map((e) => e.text)).toEqual(['Landing Gear', 'Throttle']);
    expect(spot.controls.sort()).toEqual(['Joy_ZAxis', 'Pos_Joy_ZAxis']);
  });

  it('hides redundant specialisations bound to the same input', () => {
    const doc = file({
      PitchAxisRaw: { binding: { device: 'SaitekX56Joystick', key: 'Joy_YAxis' } },
      CamPitchAxis: { binding: { device: 'SaitekX56Joystick', key: 'Joy_YAxis' } },
    });
    expect(texts(device(build(doc), 'SaitekX56::0'), 300)).toEqual(['Pitch']);
    // Shown when the general action is filtered out.
    const galmapOnly = build(doc, { groups: new Set(['Galaxy map']), compact: false });
    expect(texts(device(galmapOnly, 'SaitekX56::0'), 300)).toEqual(['GalMap Pitch']);
  });

  it('keeps specialisations with different modifiers', () => {
    const doc = file({
      PitchAxisRaw: { binding: { device: 'SaitekX56Joystick', key: 'Joy_YAxis' } },
      CamPitchAxis: {
        binding: { device: 'SaitekX56Joystick', key: 'Joy_YAxis', mods: [['SaitekX56Joystick', 'Joy_2']] },
      },
    });
    expect(texts(device(build(doc), 'SaitekX56::0'), 300)).toEqual(['Pitch', 'GalMap Pitch[1]']);
  });

  it('filters by group and keeps the card list stable', () => {
    const doc = file({
      PrimaryFire: { primary: { device: 'SaitekX56Joystick', key: 'Joy_1' } },
      BuggyPrimaryFireButton: { primary: { device: 'SaitekX56Joystick', key: 'Joy_1' } },
      UI_Up: { primary: { device: 'Keyboard', key: 'Key_W' } },
    });
    const set = build(doc, { groups: new Set(['SRV']), compact: false });
    expect(texts(device(set, 'SaitekX56::0'), 100)).toEqual(['SRV Fire']);
    expect(set.cards.map((c) => c.id)).toEqual(['SaitekX56::0', 'Keyboard']);
    const kb = set.cards.find((c): c is KeyboardCard => c.kind === 'keyboard')!;
    expect(kb.keys.size).toBe(0);
  });

  it('uses short labels in compact mode', () => {
    const doc = file({
      UseBoostJuice: { primary: { device: 'SaitekX56Joystick', key: 'Joy_1' } },
      PrimaryFire: { primary: { device: 'SaitekX56Joystick', key: 'Joy_1', hold: true } },
    });
    const set = build(doc, { ...ALL_GROUPS, compact: true });
    expect(texts(device(set, 'SaitekX56::0'), 100)).toEqual(['Primary Fire (H)', 'BOOST']);
  });

  it('shows an action bound twice to the same control once', () => {
    const doc = file({
      PrimaryFire: {
        primary: { device: 'SaitekX56Joystick', key: 'Joy_1' },
        secondary: { device: 'SaitekX56Joystick', key: 'Joy_1' },
      },
    });
    expect(texts(device(build(doc), 'SaitekX56::0'), 100)).toEqual(['Primary Fire']);
  });

  it('lists keyboard bindings with their modifiers for the list style', () => {
    const doc = file({
      PrimaryFire: { primary: { device: 'Keyboard', key: 'Key_A', mods: [['Keyboard', 'Key_LeftShift']] } },
      UI_Up: { primary: { device: 'Keyboard', key: 'Key_W' } },
    });
    const kb = build(doc).cards.find((c): c is KeyboardCard => c.kind === 'keyboard')!;
    expect(kb.rows.map((r) => [r.key, r.modifiers.map((m) => m.key), r.entry.text])).toEqual([
      ['Key_A', ['Key_LeftShift'], 'Primary Fire[1]'],
      ['Key_W', [], 'UI Up'],
    ]);
  });
});
