import { BindsDocument } from '../../core/binds/binds-document';
import { CheckResult, CheckTarget, analyzeCheck, pickCheckTargets } from './numbering-check';

const FILE = `<?xml version="1.0" encoding="UTF-8" ?>
<Root PresetName="T" MajorVersion="4" MinorVersion="2">
\t<A><Primary Device="S" Key="Joy_1" /><Secondary Device="{NoDevice}" Key="" /></A>
\t<B><Primary Device="S" Key="Joy_4" /><Secondary Device="S" Key="Joy_9" /></B>
\t<C><Primary Device="S" Key="Joy_20" /><Secondary Device="Keyboard" Key="Key_A" /></C>
\t<D><Primary Device="S" Key="Joy_POV1Up" /><Secondary Device="{NoDevice}" Key="" /></D>
\t<E><Binding Device="S" Key="Joy_XAxis" /><Inverted Value="0" /><Deadzone Value="0.00000000" /></E>
\t<F><Primary Device="S" Key="Pos_Joy_ZAxis" /><Secondary Device="{NoDevice}" Key="" /></F>
\t<G><Primary Device="S" DeviceIndex="1" Key="Joy_2" /><Secondary Device="{NoDevice}" Key="" /></G>
</Root>
`;

const t = (key: string, kind: CheckTarget['kind']): CheckTarget => ({ key, kind, actions: [] });
const r = (key: string, kind: CheckTarget['kind'], got: string | null): CheckResult => ({ target: t(key, kind), got });

describe('numbering check', () => {
  it('picks spread buttons, axes and a hat on one device', () => {
    const actions = BindsDocument.parse(FILE).actions();
    const picked = pickCheckTargets(actions, 'S', 0);
    expect(picked.map((p) => `${p.kind}:${p.key}`)).toEqual([
      'button:Joy_1',
      'button:Joy_9',
      'button:Joy_20',
      'axis:Joy_XAxis',
      'axis:Joy_ZAxis',
    ]);
    expect(pickCheckTargets(actions, 'S', 1).map((p) => p.key)).toEqual(['Joy_2']);
  });

  it('reports a match', () => {
    const a = analyzeCheck([r('Joy_1', 'button', 'Joy_1'), r('Joy_XAxis', 'axis', 'Joy_XAxis'), r('Joy_3', 'button', null)]);
    expect(a.allMatch).toBe(true);
    expect(a.skipped).toBe(1);
    expect(a.suggestion).toBeNull();
  });

  it('suggests a consistent button offset on top of the current one', () => {
    const a = analyzeCheck([r('Joy_33', 'button', 'Joy_1'), r('Joy_40', 'button', 'Joy_8')], { buttonOffset: 0 });
    expect(a.allMatch).toBe(false);
    expect(a.suggestion).toEqual({ buttonOffset: 32 });
    expect(analyzeCheck([r('Joy_2', 'button', 'Joy_3')], { buttonOffset: 2 }).suggestion).toEqual({ buttonOffset: 1 });
  });

  it('does not suggest an offset for inconsistent differences', () => {
    const a = analyzeCheck([r('Joy_1', 'button', 'Joy_2'), r('Joy_5', 'button', 'Joy_9')]);
    expect(a.suggestion).toBeNull();
  });

  it('suggests an axis swap', () => {
    expect(analyzeCheck([r('Joy_XAxis', 'axis', 'Joy_YAxis')]).suggestion).toEqual({
      axisMap: { Joy_YAxis: 'Joy_XAxis', Joy_XAxis: 'Joy_YAxis' },
    });
    expect(
      analyzeCheck([r('Joy_ZAxis', 'axis', 'Joy_UAxis'), r('Joy_UAxis', 'axis', 'Joy_ZAxis')]).suggestion,
    ).toEqual({ axisMap: { Joy_UAxis: 'Joy_ZAxis', Joy_ZAxis: 'Joy_UAxis' } });
  });
});
