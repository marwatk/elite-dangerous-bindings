import { InputRef, inputId } from '../binds/binds-document';
import { CaptureController, HeldInput } from './capture';
import { CaptureKind, InputEvent, LiveDevice } from './input.types';

const stick: LiveDevice = {
  id: 'hid:231D:0200:0',
  name: 'Stick',
  backend: 'webhid',
  bindsId: '231D0200',
  deviceIndex: 0,
  candidates: ['231D0200'],
  connected: true,
  buttons: 32,
  axes: 3,
  hats: 1,
};
const kbd: LiveDevice = { ...stick, id: 'keyboard', name: 'Keyboard', backend: 'keyboard', bindsId: 'Keyboard' };

/** A fake input source: tracks held state like the service and feeds the controller. */
class FakeSource {
  t = 0;
  held: HeldInput[] = [];
  axes = new Map<string, number>();
  readonly ctl = new CaptureController(
    () => this.held,
    () => this.axes,
    () => this.t,
  );

  private ev(device: LiveDevice, key: string, kind: CaptureKind, pressed: boolean, value: number): InputEvent {
    return { device, ref: { device: device.bindsId, key }, kind, pressed, value, timestamp: this.t };
  }

  press(key: string, device = stick, kind: CaptureKind = device === kbd ? 'key' : /POV/.test(key) ? 'hat' : 'button') {
    this.held.push({ ref: { device: device.bindsId, key }, kind, device });
    this.ctl.feed(this.ev(device, key, kind, true, 1));
  }

  release(key: string, device = stick) {
    const h = this.held.find((x) => x.ref.key === key && x.device === device)!;
    this.held = this.held.filter((x) => x !== h);
    this.ctl.feed(this.ev(device, key, h.kind, false, 0));
  }

  axis(key: string, value: number, device = stick) {
    const ref: InputRef = { device: device.bindsId, key };
    this.axes.set(inputId(ref), value);
    this.ctl.feed(this.ev(device, key, 'axis', false, value));
  }
}

describe('CaptureController', () => {
  it('captures a single button press on release', async () => {
    const s = new FakeSource();
    const p = s.ctl.begin({ accept: ['button'] });
    s.t = 200;
    s.press('Joy_3');
    expect(s.ctl.active).toBe(true);
    s.release('Joy_3');
    const r = await p;
    expect(r).toMatchObject({ ref: { device: '231D0200', key: 'Joy_3' }, modifiers: [], kind: 'button' });
    expect(s.ctl.active).toBe(false);
  });

  it('records held controls as modifiers, across devices, whichever is released first', async () => {
    const s = new FakeSource();
    let p = s.ctl.begin({ accept: ['button', 'key', 'hat'] });
    s.t = 200;
    s.press('Key_LeftShift', kbd);
    s.press('Joy_5');
    s.press('Joy_1');
    s.release('Joy_1');
    expect(await p).toMatchObject({
      ref: { key: 'Joy_1' },
      modifiers: [
        { device: 'Keyboard', key: 'Key_LeftShift' },
        { device: '231D0200', key: 'Joy_5' },
      ],
    });
    s.release('Joy_5');
    s.release('Key_LeftShift', kbd);

    p = s.ctl.begin({ accept: ['button'] });
    s.t = 400;
    s.press('Joy_5');
    s.press('Joy_2');
    s.release('Joy_5'); // modifier let go first
    expect(await p).toMatchObject({ ref: { key: 'Joy_2' }, modifiers: [{ key: 'Joy_5' }] });
  });

  it('ignores input during the warm-up and controls held from before', async () => {
    const s = new FakeSource();
    s.press('Joy_7'); // held before the capture started
    const p = s.ctl.begin({ accept: ['button'] });
    s.t = 50;
    s.press('Joy_1');
    s.release('Joy_1'); // warm-up: ignored
    s.t = 300;
    s.release('Joy_7'); // not pressed during the capture: ignored
    expect(s.ctl.active).toBe(true);
    s.press('Joy_2');
    s.release('Joy_2');
    expect((await p).ref.key).toBe('Joy_2');
  });

  it('resolves on press without modifiers, and skips kinds not accepted and Escape', async () => {
    const s = new FakeSource();
    const p = s.ctl.begin({ accept: ['hat', 'key'], modifiers: false });
    s.t = 200;
    s.press('Joy_1');
    s.press('Key_Escape', kbd);
    expect(s.ctl.active).toBe(true);
    s.press('Joy_POV1Up');
    expect(await p).toMatchObject({ ref: { key: 'Joy_POV1Up' }, kind: 'hat', modifiers: [] });
  });

  it('does not treat the other direction of the same hat as a modifier', async () => {
    const s = new FakeSource();
    const p = s.ctl.begin({ accept: ['hat'] });
    s.t = 200;
    s.press('Joy_POV1Up');
    s.press('Joy_POV1Right');
    s.release('Joy_POV1Right');
    expect(await p).toMatchObject({ ref: { key: 'Joy_POV1Right' }, modifiers: [] });
  });

  it('captures an axis past the threshold from rest, with direction, after stable samples', async () => {
    const s = new FakeSource();
    s.axes.set(inputId({ device: '231D0200', key: 'Joy_XAxis' }), 0.02);
    s.axes.set(inputId({ device: '231D0200', key: 'Joy_ZAxis' }), 0.9);
    const p = s.ctl.begin({ accept: ['axis'] });
    s.t = 200;
    s.axis('Joy_XAxis', 0.3); // below threshold
    s.axis('Joy_ZAxis', 0.95); // noisy but near rest
    s.axis('Joy_XAxis', -0.7); // one spike...
    s.axis('Joy_XAxis', 0.1); // ...then back: not stable
    expect(s.ctl.active).toBe(true);
    s.axis('Joy_ZAxis', 0.2);
    s.axis('Joy_ZAxis', 0.1);
    expect(await p).toMatchObject({ ref: { key: 'Joy_ZAxis' }, kind: 'axis', direction: -1 });
  });

  it('learns the rest value of axes first seen during the capture', async () => {
    const s = new FakeSource();
    const p = s.ctl.begin({ accept: ['axis'] });
    s.t = 200;
    s.axis('Joy_RZAxis', 1); // pedal resting at +1
    s.axis('Joy_RZAxis', 0.9);
    s.axis('Joy_RZAxis', 0.2);
    s.axis('Joy_RZAxis', 0.1);
    expect(await p).toMatchObject({ ref: { key: 'Joy_RZAxis' }, direction: -1 });
  });

  it('rejects with AbortError on abort and when superseded', async () => {
    const s = new FakeSource();
    const ac = new AbortController();
    const p1 = s.ctl.begin({ accept: ['button'], signal: ac.signal });
    ac.abort();
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' });
    const p2 = s.ctl.begin({ accept: ['button'] });
    const p3 = s.ctl.begin({ accept: ['button'], modifiers: false });
    await expect(p2).rejects.toMatchObject({ name: 'AbortError' });
    s.t = 200;
    s.press('Joy_4');
    expect((await p3).ref.key).toBe('Joy_4');
    const pre = new AbortController();
    pre.abort();
    await expect(s.ctl.begin({ accept: ['button'], signal: pre.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
