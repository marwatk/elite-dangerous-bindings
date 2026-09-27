import {
  HatAxes,
  PadSnapshot,
  applyCorrection,
  hatAxisDirections,
  mapJoystickBanks,
  mapStandardPad,
  padProfile,
  parseGamepadId,
} from './gamepad-mapping';

function pad(index: number, buttons: number, axes: number[], pressed: number[] = [], mapping = ''): PadSnapshot {
  return {
    index,
    id: `Stick (Vendor: 231d Product: 0200)`,
    mapping,
    buttons: Array.from({ length: buttons }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
    axes,
  };
}

describe('gamepad-mapping', () => {
  it('parses Chromium and Firefox gamepad ids', () => {
    expect(parseGamepadId('VKBsim Gladiator EVO  R  (Vendor: 231d Product: 0200)')).toEqual({
      usb: { vid: '231D', pid: '0200' },
      name: 'VKBsim Gladiator EVO  R',
    });
    expect(parseGamepadId('Xbox 360 Controller (XInput STANDARD GAMEPAD Vendor: 045e Product: 028e)').usb).toEqual({
      vid: '045E',
      pid: '028E',
    });
    expect(parseGamepadId('045e-028e-Microsoft X-Box 360 pad')).toEqual({
      usb: { vid: '045E', pid: '028E' },
      name: 'Microsoft X-Box 360 pad',
    });
    expect(parseGamepadId('45e-28e-Pad').usb).toEqual({ vid: '045E', pid: '028E' });
    expect(parseGamepadId('xinput').usb).toBeUndefined();
  });

  it('chooses a profile', () => {
    expect(padProfile({ id: 'x', mapping: 'standard' }, { vid: '045E', pid: '028E' }, true)).toBe('xinput');
    expect(padProfile({ id: 'Xbox Wireless Controller', mapping: 'standard' }, undefined, false)).toBe('xinput');
    expect(padProfile({ id: 'x', mapping: 'standard' }, { vid: '054C', pid: '09CC' }, false)).toBe('sony');
    expect(padProfile({ id: 'x', mapping: '' }, { vid: '045E', pid: '028E' }, true)).toBe('joystick');
  });

  it('maps the standard layout to GamePad_* names', () => {
    const p = pad(0, 17, [0.5, -1, 0, 0], [0, 4, 12], 'standard');
    p.buttons[6] = { pressed: false, value: 0.25 };
    const m = mapStandardPad(p, 'xinput');
    expect([...m.pressed].sort()).toEqual(['GamePad_DPadUp', 'GamePad_FaceDown', 'GamePad_LBumper']);
    expect(m.axes.get('GamePad_LStickX')).toBe(0.5);
    expect(m.axes.get('GamePad_LStickY')).toBe(-1);
    expect(m.axes.get('GamePad_LTrigger')).toBe(-0.5);
  });

  it('maps a DualShock/DualSense to DirectInput numbering', () => {
    const m = mapStandardPad(pad(0, 18, [0, 0, 0.9, 0], [0, 2, 13, 16], 'standard'), 'sony');
    expect([...m.pressed].sort()).toEqual(['Joy_1', 'Joy_13', 'Joy_2', 'Joy_POV1Down']);
    expect(m.axes.get('Joy_ZAxis')).toBe(0.9);
    expect(m.axes.get('Joy_RXAxis')).toBe(-1);
  });

  it('decodes hats reported as axes', () => {
    expect(hatAxisDirections(1.2857)).toEqual([]);
    expect(hatAxisDirections(-1)).toEqual(['Up']);
    expect(hatAxisDirections(-0.714)).toEqual(['Up', 'Right']);
    expect(hatAxisDirections(-0.428)).toEqual(['Right']);
    expect(hatAxisDirections(0.143)).toEqual(['Down']);
    expect(hatAxisDirections(0.714)).toEqual(['Left']);
    expect(hatAxisDirections(1)).toEqual(['Up', 'Left']);
  });

  it('maps joystick mode with hat axes and 32-button banks', () => {
    const hats: HatAxes = new Map();
    const bank0 = pad(0, 32, [0.1, -0.2, 0, 0, 0, 0, 0, 0, 0, 1.2857], [0]);
    const bank1 = pad(1, 32, [0, 0], [1]);
    let m = mapJoystickBanks([bank0, bank1], hats);
    expect([...m.pressed].sort()).toEqual(['Joy_1', 'Joy_34']);
    expect(m.axes.get('Joy_XAxis')).toBe(0.1);
    expect(m.axes.get('Joy_YAxis')).toBe(-0.2);
    expect(m.hats).toBe(1);
    expect(m.buttons).toBe(64);
    // Hat axis index 9 stays a hat once detected, even when pushed (-1 = Up).
    bank0.axes[9] = -1;
    m = mapJoystickBanks([bank0, bank1], hats);
    expect(m.pressed.has('Joy_POV1Up')).toBe(true);
    expect([...m.axes.keys()]).not.toContain(undefined);
  });

  it('applies button offsets and axis maps', () => {
    expect(applyCorrection('Joy_3', { buttonOffset: 2 })).toBe('Joy_5');
    expect(applyCorrection('Joy_XAxis', { axisMap: { Joy_XAxis: 'Joy_YAxis' } })).toBe('Joy_YAxis');
    expect(applyCorrection('Joy_ZAxis', { axisMap: { '2': 'Joy_UAxis' } }, 2)).toBe('Joy_UAxis');
    expect(applyCorrection('Joy_POV1Up', { buttonOffset: 2 })).toBe('Joy_POV1Up');
    const m = mapJoystickBanks([pad(0, 4, [0.3, 0.6], [0])], new Map(), {
      buttonOffset: 1,
      axisMap: { Joy_XAxis: 'Joy_YAxis', Joy_YAxis: 'Joy_XAxis' },
    });
    expect([...m.pressed]).toEqual(['Joy_2']);
    expect(m.axes.get('Joy_YAxis')).toBe(0.3);
    expect(m.axes.get('Joy_XAxis')).toBe(0.6);
  });
});
