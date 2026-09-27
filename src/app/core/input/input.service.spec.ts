import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CatalogService } from '../data/catalog.service';
import { UsbId } from '../data/catalog.types';
import { InputService } from './input.service';
import { InputEvent } from './input.types';

interface FakePad {
  index: number;
  id: string;
  mapping: string;
  connected: boolean;
  buttons: { pressed: boolean; value: number }[];
  axes: number[];
}

const named: Record<string, UsbId[]> = {
  ThrustMasterTFlightHOTASX: [{ vid: '044F', pid: 'B108' }],
  GamePad: [{ vid: '045E', pid: '028E' }],
};

const fakeCatalog = {
  namedIds: signal(named),
  devices: signal([]),
  keys: signal(new Map([['Key_K', { key: 'Key_K', label: 'K' }]])),
  definitions: signal(new Map()),
  whenReady: () => Promise.resolve(),
  deviceFor: () => undefined,
  loadDevice: () => Promise.reject(new Error('none')),
  loadDevicesFor: () => Promise.resolve(),
  action: (code: string) => ({ code, longName: code }),
  bindsIdsForUsb(usb: UsbId): string[] {
    const ids = [`${usb.vid}${usb.pid}`];
    for (const [n, list] of Object.entries(named)) if (list.some((u) => u.vid === usb.vid && u.pid === usb.pid)) ids.push(n);
    return ids;
  },
};

describe('InputService (Gamepad API + keyboard)', () => {
  let frames: FrameRequestCallback[] = [];
  let pads: (FakePad | null)[] = [];
  let svc: InputService;
  const frame = (n = 1) => {
    for (let i = 0; i < n; i++) {
      const due = frames;
      frames = [];
      due.forEach((f) => f(performance.now()));
    }
  };
  const stick = (): FakePad => ({
    index: 0,
    id: 'T.Flight Hotas X (Vendor: 044f Product: b108)',
    mapping: '',
    connected: true,
    buttons: Array.from({ length: 12 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857],
  });

  beforeEach(() => {
    frames = [];
    pads = [];
    localStorage.clear();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    Object.defineProperty(navigator, 'getGamepads', { value: () => pads, configurable: true });
    TestBed.configureTestingModule({ providers: [{ provide: CatalogService, useValue: fakeCatalog }] });
    svc = TestBed.inject(InputService);
  });

  afterEach(() => {
    while (svc.started()) svc.stop();
    vi.unstubAllGlobals();
  });

  it('reports a joystick under its named Elite ID with Joy_N, POV and axis names', () => {
    const events: InputEvent[] = [];
    svc.events.subscribe((e) => events.push(e));
    svc.start();
    const p = stick();
    pads = [p];
    frame(2);
    expect(svc.devices()).toHaveLength(1);
    expect(svc.devices()[0]).toMatchObject({
      backend: 'gamepad',
      bindsId: 'ThrustMasterTFlightHOTASX',
      candidates: ['ThrustMasterTFlightHOTASX', '044FB108'],
      usb: { vid: '044F', pid: 'B108' },
      hats: 1,
    });
    p.buttons[4] = { pressed: true, value: 1 };
    p.axes[9] = -1; // hat Up
    p.axes[1] = -0.9;
    frame(2);
    expect(svc.held().map((r) => r.key).sort()).toEqual(['Joy_5', 'Joy_POV1Up']);
    expect(svc.axisValues().get('ThrustMasterTFlightHOTASX::0::Joy_YAxis')).toBe(-0.9);
    expect(events.some((e) => e.ref.key === 'Joy_5' && e.pressed && e.kind === 'button')).toBe(true);
    expect(events.some((e) => e.ref.key === 'Joy_YAxis' && e.pressed && e.kind === 'axis')).toBe(true);
  });

  it('captures a joystick button with a keyboard modifier, and releases on stop', async () => {
    svc.start();
    const p = stick();
    pads = [p];
    frame();
    const cap = svc.capture({ accept: ['button', 'key'] });
    expect(svc.capturing()).toBe(true);
    await new Promise((r) => setTimeout(r, 170));
    const down = new KeyboardEvent('keydown', { code: 'ShiftLeft', key: 'Shift', cancelable: true });
    window.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    p.buttons[0] = { pressed: true, value: 1 };
    frame();
    p.buttons[0] = { pressed: false, value: 0 };
    frame();
    const r = await cap;
    expect(r.ref).toEqual({ device: 'ThrustMasterTFlightHOTASX', key: 'Joy_1' });
    expect(r.modifiers).toEqual([{ device: 'Keyboard', key: 'Key_LeftShift' }]);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft', key: 'Shift' }));
    // Escape is never swallowed.
    const esc = new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', cancelable: true });
    const cap2 = svc.capture({ accept: ['key'] });
    window.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(false);
    const ac = svc.capture({ accept: ['key'] }); // supersedes cap2
    await expect(cap2).rejects.toMatchObject({ name: 'AbortError' });
    svc.stop();
    expect(svc.started()).toBe(true); // the pending capture still holds a reference
    await Promise.resolve();
    ac.catch(() => undefined);
  });

  it('reports Xbox-style pads as GamePad with GamePad_* names', () => {
    svc.start();
    pads = [
      {
        index: 0,
        id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD Vendor: 045e Product: 028e)',
        mapping: 'standard',
        connected: true,
        buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 0, value: i === 0 ? 1 : 0 })),
        axes: [0, 0, 0, 0],
      },
    ];
    frame(2);
    expect(svc.devices()[0].bindsId).toBe('GamePad');
    expect(svc.held()).toEqual([{ device: 'GamePad', key: 'GamePad_FaceDown' }]);
  });

  it('applies saved corrections and setBindsId overrides', () => {
    svc.start();
    const p = stick();
    pads = [p];
    frame();
    svc.setCorrection('ThrustMasterTFlightHOTASX', { buttonOffset: 32 });
    p.buttons[0] = { pressed: true, value: 1 };
    frame(2);
    expect(svc.held().map((r) => r.key)).toEqual(['Joy_33']);
    expect(JSON.parse(localStorage.getItem('edb.inputCorrections')!)).toEqual({
      ThrustMasterTFlightHOTASX: { buttonOffset: 32 },
    });
    svc.setBindsId(svc.devices()[0].id, '044FB108', 1);
    frame(2);
    expect(svc.devices()[0]).toMatchObject({ bindsId: '044FB108', deviceIndex: 1 });
    expect(svc.held()).toEqual([{ device: '044FB108', key: 'Joy_1', deviceIndex: 1 }]);
    expect(JSON.parse(localStorage.getItem('edb.inputDeviceIds')!)).toEqual({
      '044F:B108': { bindsId: '044FB108', deviceIndex: 1 },
    });
  });
});
