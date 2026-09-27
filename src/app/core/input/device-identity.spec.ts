import { chooseIdentity, mergeCorrections } from './device-identity';

const named = new Set(['SaitekX56Joystick', 'GamePad', 'DualShock4']);

describe('chooseIdentity', () => {
  it('prefers an ID the open file uses', () => {
    const r = chooseIdentity({
      candidates: ['07382221', 'SaitekX56Joystick'],
      namedIds: named,
      used: [{ device: '07382221', deviceIndex: 0 }],
      ordinal: 0,
      sameUsbCount: 1,
    });
    expect(r.bindsId).toBe('07382221');
    expect(r.candidates).toEqual(['07382221', 'SaitekX56Joystick']);
  });

  it('then a named ID, then the hex form', () => {
    const base = { namedIds: named, used: [], ordinal: 0, sameUsbCount: 1 };
    expect(chooseIdentity({ ...base, candidates: ['07382221', 'SaitekX56Joystick'] }).bindsId).toBe('SaitekX56Joystick');
    expect(chooseIdentity({ ...base, candidates: ['231D0200'] }).bindsId).toBe('231D0200');
    expect(chooseIdentity({ ...base, candidates: [] }).bindsId).toBe('Unknown');
  });

  it('numbers identical devices by connection order unless the file says otherwise', () => {
    const base = { candidates: ['044FB687'], namedIds: named, sameUsbCount: 2 };
    expect(chooseIdentity({ ...base, used: [], ordinal: 1 }).deviceIndex).toBe(1);
    const fromFile = chooseIdentity({
      ...base,
      sameUsbCount: 1,
      used: [{ device: '044FB687', deviceIndex: 1 }],
      ordinal: 0,
    });
    expect(fromFile.deviceIndex).toBe(1);
  });

  it('layers the user correction over the device definition', () => {
    expect(mergeCorrections(undefined, undefined)).toBeUndefined();
    expect(mergeCorrections({ buttonOffset: 1, axisMap: { a: 'b' } }, { buttonOffset: 2 })).toEqual({
      buttonOffset: 2,
      axisMap: { a: 'b' },
    });
  });
});
