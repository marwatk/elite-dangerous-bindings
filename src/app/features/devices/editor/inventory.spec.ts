import { DraftControl } from './draft';
import { compareControls, controlsFromCounts, defaultLabel, iconTokenOf, mergeControls, stripIconTokens, withIconToken } from './inventory';

describe('inventory', () => {
  it('builds controls from counts in browser axis order', () => {
    const cs = controlsFromCounts(3, 4, 1);
    expect(cs.map((c) => c.key)).toEqual([
      'Joy_XAxis',
      'Joy_YAxis',
      'Joy_ZAxis',
      'Joy_RXAxis',
      'Joy_POV1Up',
      'Joy_POV1Right',
      'Joy_POV1Down',
      'Joy_POV1Left',
      'Joy_1',
      'Joy_2',
      'Joy_3',
    ]);
    expect(cs.find((c) => c.key === 'Joy_POV1Up')?.kind).toBe('hat');
    expect(controlsFromCounts(0, 20, 9).length).toBe(8 + 16);
  });

  it('labels keys readably', () => {
    expect(defaultLabel('Joy_12')).toBe('Button 12');
    expect(defaultLabel('Joy_RZAxis')).toBe('Rotary Z axis');
    expect(defaultLabel('Joy_POV2Left')).toBe('Hat 2 Left');
    expect(defaultLabel('Neg_Joy_XAxis')).toBe('X axis −');
    expect(defaultLabel('GamePad_FaceDown')).toBe('Face Down');
  });

  it('merges without duplicates and can relabel', () => {
    const existing: DraftControl[] = [{ uid: 'a', part: 'p', key: 'Joy_1', label: 'Button 1', kind: 'button' }];
    const r = mergeControls(existing, [
      { key: 'Joy_1', label: 'Trigger', kind: 'button' },
      { key: 'Joy_2', label: 'Pinky', kind: 'button' },
    ], 'p');
    expect(r.added).toBe(1);
    expect(r.controls[0].label).toBe('Button 1');
    const r2 = mergeControls(existing, [{ key: 'Joy_1', label: 'Trigger', kind: 'button' }], 'p', true);
    expect(r2.relabelled).toBe(1);
    expect(r2.controls[0].label).toBe('Trigger');
    // Other parts are separate.
    expect(mergeControls(existing, [{ key: 'Joy_1', label: 'x', kind: 'button' }], 'q').added).toBe(1);
  });

  it('sorts buttons numerically, then hats, then axes', () => {
    const keys = ['Joy_XAxis', 'Joy_10', 'Joy_POV1Up', 'Joy_2', 'Pos_Joy_XAxis'].map((k) => ({
      key: k,
      kind: (k.includes('Axis') ? 'axis' : k.includes('POV') ? 'hat' : 'button') as 'axis' | 'hat' | 'button',
    }));
    expect(keys.sort(compareControls).map((k) => k.key)).toEqual(['Joy_2', 'Joy_10', 'Joy_POV1Up', 'Joy_XAxis', 'Pos_Joy_XAxis']);
  });

  it('sets and strips icon tokens', () => {
    expect(withIconToken('Stick X', '[x52prox]')).toBe('Stick X [x52prox]');
    expect(withIconToken('Stick X [x52prox]', '[x52proy]')).toBe('Stick X [x52proy]');
    expect(withIconToken('Stick X [x52prox]', null)).toBe('Stick X');
    expect(iconTokenOf('RGNX A1 [ps4PadU]')).toBe('[ps4PadU]');
    expect(stripIconTokens('A [ps4PadU] B')).toBe('A B');
  });
});
