import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BindsDocument, BindsFormatError, NO_DEVICE } from './binds-document';
import { XmlParseError } from './xml';

const fixture = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const CUSTOM = fixture('src/testing/fixtures/Custom.4.2.binds');
const EMPTY = fixture('public/data/templates/Empty.4.2.binds');

const MINI = `<?xml version="1.0" encoding="UTF-8" ?>
<Root PresetName="Test" MajorVersion="4" MinorVersion="2">
\t<KeyboardLayout>en-US</KeyboardLayout>
\t<MouseSensitivity Value="1.00000000" />
\t<YawAxisRaw>
\t\t<Binding Device="SaitekX56Joystick" Key="Joy_RZAxis" />
\t\t<Inverted Value="1" />
\t\t<Deadzone Value="0.09000000" />
\t</YawAxisRaw>
\t<ToggleReverseThrottleInput>
\t\t<Primary Device="Keyboard" Key="Key_T">
\t\t\t<Modifier Device="Keyboard" Key="Key_LeftAlt" />
\t\t</Primary>
\t\t<Secondary Device="{NoDevice}" Key="" />
\t\t<ToggleOn Value="1" />
\t</ToggleReverseThrottleInput>
\t<BackwardKey>
\t\t<Primary Device="Keyboard" Key="Key_S" />
\t\t<Secondary Device="{NoDevice}" Key="" />
\t</BackwardKey>
</Root>
`;

describe('BindsDocument round trip', () => {
  it('returns a real game file byte-for-byte when unedited', () => {
    expect(BindsDocument.parse(CUSTOM).serialize()).toBe(CUSTOM);
  });

  it('returns the empty template byte-for-byte when unedited', () => {
    expect(BindsDocument.parse(EMPTY).serialize()).toBe(EMPTY);
  });

  it('preserves a BOM, CRLF line endings, comments and unknown elements', () => {
    const text = '﻿' + MINI.replace('<KeyboardLayout>', '<!-- hi --><FutureThing a=\'1\'/><KeyboardLayout>').replace(/\n/g, '\r\n');
    const doc = BindsDocument.parse(text);
    expect(doc.serialize()).toBe(text);
    doc.setSlot('BackwardKey', 'Secondary', { device: 'Keyboard', key: 'Key_Down', modifiers: [{ device: 'Keyboard', key: 'Key_LeftShift' }], hold: false });
    const out = doc.serialize();
    expect(out.startsWith('﻿')).toBe(true);
    expect(out).toContain("<FutureThing a='1'/>");
    expect(out).toContain('<Secondary Device="Keyboard" Key="Key_Down">\r\n\t\t\t<Modifier Device="Keyboard" Key="Key_LeftShift" />\r\n\t\t</Secondary>');
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('only changes the edited line', () => {
    const doc = BindsDocument.parse(CUSTOM);
    doc.setSlot('BackwardKey', 'Primary', { device: 'Keyboard', key: 'Key_X', modifiers: [{ device: 'Keyboard', key: 'Key_LeftAlt' }], hold: false });
    const before = CUSTOM.split('\n');
    const after = doc.serialize().split('\n');
    expect(after.length).toBe(before.length);
    const diff = after.map((l, i) => (l === before[i] ? null : i)).filter((i) => i !== null);
    expect(diff.length).toBe(1);
    expect(after[diff[0]!]).toContain('<Primary Device="Keyboard" Key="Key_X">');
  });
});

describe('BindsDocument reading', () => {
  const doc = BindsDocument.parse(MINI);

  it('reads metadata', () => {
    expect(doc.presetName).toBe('Test');
    expect(doc.majorVersion).toBe(4);
    expect(doc.minorVersion).toBe(2);
    expect(doc.fileName).toBe('Test.4.2.binds');
    expect(doc.keyboardLayout).toBe('en-US');
  });

  it('separates actions from settings', () => {
    expect(doc.actionCodes()).toEqual(['YawAxisRaw', 'ToggleReverseThrottleInput', 'BackwardKey']);
    expect(doc.settingCodes()).toEqual(['MouseSensitivity']);
    expect(doc.getSetting('MouseSensitivity')).toBe('1.00000000');
  });

  it('reads axis actions', () => {
    const a = doc.getAction('YawAxisRaw')!;
    expect(a.kind).toBe('axis');
    expect(a.slots.Binding).toEqual({ device: 'SaitekX56Joystick', key: 'Joy_RZAxis', modifiers: [], hold: false });
    expect(a.inverted).toBe(true);
    expect(a.deadzone).toBeCloseTo(0.09);
  });

  it('reads button actions with modifiers and toggle', () => {
    const a = doc.getAction('ToggleReverseThrottleInput')!;
    expect(a.kind).toBe('button');
    expect(a.slots.Primary!.modifiers).toEqual([{ device: 'Keyboard', key: 'Key_LeftAlt' }]);
    expect(a.slots.Secondary!.device).toBe(NO_DEVICE);
    expect(a.toggleOn).toBe(true);
  });

  it('reads every action in a real file', () => {
    const real = BindsDocument.parse(CUSTOM);
    expect(real.actionCodes().length).toBeGreaterThan(400);
    expect(real.devicesUsed().map((d) => d.device)).toContain('Keyboard');
  });
});

describe('BindsDocument editing', () => {
  it('adds and removes modifiers, collapsing to the self-closing form', () => {
    const doc = BindsDocument.parse(MINI);
    doc.setSlot('BackwardKey', 'Primary', { device: 'Keyboard', key: 'Key_S', modifiers: [{ device: 'SaitekX56Throttle', key: 'Joy_5' }], hold: false });
    expect(doc.serialize()).toContain('\t\t<Primary Device="Keyboard" Key="Key_S">\n\t\t\t<Modifier Device="SaitekX56Throttle" Key="Joy_5" />\n\t\t</Primary>\n');
    doc.setSlot('BackwardKey', 'Primary', { device: 'Keyboard', key: 'Key_S', modifiers: [], hold: false });
    expect(doc.serialize()).toBe(MINI);
  });

  it('writes the Hold flag as a child', () => {
    const doc = BindsDocument.parse(MINI);
    doc.setSlot('BackwardKey', 'Primary', { device: 'Keyboard', key: 'Key_LeftAlt', modifiers: [], hold: true });
    expect(doc.serialize()).toContain('<Primary Device="Keyboard" Key="Key_LeftAlt">\n\t\t\t<Hold Value="1" />\n\t\t</Primary>');
    expect(doc.getAction('BackwardKey')!.slots.Primary!.hold).toBe(true);
  });

  it('clears a slot to {NoDevice} and drops its modifiers', () => {
    const doc = BindsDocument.parse(MINI);
    doc.setSlot('ToggleReverseThrottleInput', 'Primary', null);
    expect(doc.serialize()).toContain('\t\t<Primary Device="{NoDevice}" Key="" />\n\t\t<Secondary');
    expect(doc.getAction('ToggleReverseThrottleInput')!.toggleOn).toBe(true);
  });

  it('keeps Inverted and Deadzone when an axis is rebound', () => {
    const doc = BindsDocument.parse(MINI);
    doc.setSlot('YawAxisRaw', 'Binding', { device: '231D0200', key: 'Joy_XAxis', modifiers: [], hold: false });
    const a = doc.getAction('YawAxisRaw')!;
    expect(a.slots.Binding!.device).toBe('231D0200');
    expect(a.inverted).toBe(true);
    expect(a.deadzone).toBeCloseTo(0.09);
  });

  it('writes DeviceIndex between Device and Key', () => {
    const doc = BindsDocument.parse(MINI);
    doc.setSlot('BackwardKey', 'Secondary', { device: 'T16000M', deviceIndex: 1, key: 'Joy_2', modifiers: [], hold: false });
    expect(doc.serialize()).toContain('<Secondary Device="T16000M" DeviceIndex="1" Key="Joy_2" />');
    expect(doc.getAction('BackwardKey')!.slots.Secondary!.deviceIndex).toBe(1);
  });

  it('formats deadzone and flags like the game', () => {
    const doc = BindsDocument.parse(MINI);
    doc.setDeadzone('YawAxisRaw', 0.125);
    doc.setInverted('YawAxisRaw', false);
    doc.setToggleOn('BackwardKey', true);
    const out = doc.serialize();
    expect(out).toContain('<Deadzone Value="0.12500000" />');
    expect(out).toContain('<Inverted Value="0" />');
    expect(out).toContain('\t\t<Secondary Device="{NoDevice}" Key="" />\n\t\t<ToggleOn Value="1" />\n\t</BackwardKey>');
  });

  it('escapes attribute values', () => {
    const doc = BindsDocument.parse(MINI);
    doc.presetName = 'A "quoted" & <odd> name';
    expect(doc.serialize()).toContain('PresetName="A &quot;quoted&quot; &amp; &lt;odd&gt; name"');
    expect(BindsDocument.parse(doc.serialize()).presetName).toBe('A "quoted" & <odd> name');
  });

  it('re-targets a device in slots and modifiers', () => {
    const doc = BindsDocument.parse(MINI);
    doc.setSlot('BackwardKey', 'Primary', { device: 'Keyboard', key: 'Key_S', modifiers: [{ device: 'SaitekX56Joystick', key: 'Joy_5' }], hold: false });
    expect(doc.replaceDevice('SaitekX56Joystick', '07382221')).toBe(2);
    expect(doc.getAction('YawAxisRaw')!.slots.Binding!.device).toBe('07382221');
    expect(doc.getAction('BackwardKey')!.slots.Primary!.modifiers[0].device).toBe('07382221');
  });

  it('clears a device', () => {
    const doc = BindsDocument.parse(MINI);
    expect(doc.clearDevice('Keyboard')).toBe(2);
    expect(doc.devicesUsed().map((d) => d.device)).toEqual(['SaitekX56Joystick']);
  });

  it('sets the version and file name', () => {
    const doc = BindsDocument.parse(MINI);
    doc.presetName = 'MyHOTAS';
    doc.setVersion(4, 1);
    expect(doc.fileName).toBe('MyHOTAS.4.1.binds');
  });
});

describe('BindsDocument errors', () => {
  it('rejects malformed XML with a line number', () => {
    expect(() => BindsDocument.parse('<Root>\n<A>\n</Root>')).toThrow(XmlParseError);
    expect(() => BindsDocument.parse('<Root>\n<A>\n</Root>')).toThrow(/line 3/);
  });

  it('rejects XML that is not a bindings file', () => {
    expect(() => BindsDocument.parse('<Other/>')).toThrow(BindsFormatError);
  });

  it('rejects editing an action that is not in the file', () => {
    expect(() => BindsDocument.parse(MINI).setToggleOn('Nope', true)).toThrow(BindsFormatError);
  });
});
