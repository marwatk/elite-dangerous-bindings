import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { InputRef, inputId } from '../binds/binds-document';
import { CatalogService } from '../data/catalog.service';
import { InputCorrection, UsbId } from '../data/catalog.types';
import { BindingsStore } from '../state/bindings-store.service';
import { CaptureController, HeldInput } from './capture';
import {
  CORRECTIONS_KEY,
  CorrectionMap,
  IDENTITY_KEY,
  IdentityOverrides,
  chooseIdentity,
  identityKey,
  mergeCorrections,
  readStored,
  writeStored,
} from './device-identity';
import {
  HatAxes,
  PadProfile,
  PadSnapshot,
  applyCorrection,
  mapJoystickBanks,
  mapStandardPad,
  padProfile,
  parseGamepadId,
  snapshotGamepad,
  usbKey,
} from './gamepad-mapping';
import { DecodedReport, HidLayout, decodeReport, describeField, parseHidLayout, toHex } from './hid-parser';
import {
  CONTROLLER_FILTERS,
  HidConnectionEvent,
  HidDevice,
  HidInputReportEvent,
  isControllerCollection,
  navigatorHid,
} from './hid-types';
import { eliteKeyForEvent } from './keyboard-map';
import { CaptureKind, CaptureOptions, CaptureResult, InputEvent, LiveDevice } from './input.types';

/** Raw data per device for the diagnostics panel. */
export interface DeviceDiagnostics {
  id: string;
  backend: LiveDevice['backend'];
  /** WebHID: last report as hex. Gamepad: summary line. */
  raw: string;
  rawAt: number;
  /** WebHID: parsed descriptor fields. */
  fields?: string[];
  /** Gamepad API: the Gamepad objects behind this device. */
  pads?: { index: number; id: string; mapping: string; buttons: number[]; axes: number[] }[];
  profile?: PadProfile;
  correction?: InputCorrection;
  error?: string;
}

interface Runtime {
  id: string;
  backend: 'webhid' | 'gamepad';
  name: string;
  usb?: UsbId;
  ordinal: number;
  live: LiveDevice;
  pressed: Set<string>;
  axes: Map<string, number>;
  rest: Map<string, number>;
  emitted: Map<string, number>;
  deflected: Set<string>;
  correction?: InputCorrection;
  notes: string[];
  counts: { buttons: number; axes: number; hats: number };
  diag: DeviceDiagnostics;
  // WebHID
  hid?: HidDevice;
  layout?: HidLayout;
  byReport?: Map<number, DecodedReport>;
  onReport?: (e: Event) => void;
  // Gamepad API
  profile?: PadProfile;
  hatAxes?: HatAxes;
}

const KEYBOARD_ID = 'keyboard';
/** Axis movement that counts as "pressed" in events (same as capture). */
const AXIS_PRESS = 0.5;
/** Axis movement from rest that lights up a control in the UI. */
const AXIS_ACTIVE = 0.3;
/** Minimum change before another axis event is emitted. */
const AXIS_EVENT_STEP = 0.02;

/**
 * Reads the keyboard and game controllers (WebHID first, Gamepad API as the
 * fallback) and reports everything in Elite's naming.
 *
 * PUBLIC API CONTRACT: other features code against these members.
 */
@Injectable({ providedIn: 'root' })
export class InputService {
  private readonly catalog = inject(CatalogService);
  private readonly store = inject(BindingsStore);

  /** True when the browser supports WebHID (Chromium). */
  readonly webHidSupported = typeof navigator !== 'undefined' && 'hid' in navigator;
  readonly gamepadSupported = typeof navigator !== 'undefined' && 'getGamepads' in navigator;

  /** Controllers seen this session. */
  readonly devices = signal<LiveDevice[]>([]);
  /** Buttons, hat directions and keys currently held down. */
  readonly held = signal<InputRef[]>([]);
  /** Latest value of every axis, keyed by inputId(ref). */
  readonly axisValues = signal<ReadonlyMap<string, number>>(new Map());

  private readonly eventSubject = new Subject<InputEvent>();
  /** Every button/hat/key change and every significant axis movement. */
  readonly events: Observable<InputEvent> = this.eventSubject.asObservable();

  // ------------------------------------------------------------ additions to the contract

  /** True while at least one start() is active. */
  readonly started = signal(false);
  /** The computer keyboard, as reported in events (not listed in `devices`). */
  readonly keyboardDevice: LiveDevice = {
    id: KEYBOARD_ID,
    name: 'Keyboard',
    backend: 'keyboard',
    bindsId: 'Keyboard',
    deviceIndex: 0,
    candidates: ['Keyboard'],
    connected: true,
    buttons: 0,
    axes: 0,
    hats: 0,
  };
  /** inputId()s of axes currently moved noticeably away from their resting value. */
  readonly movedAxes = signal<ReadonlySet<string>>(new Set());
  /** Resting value of every axis (first value seen), keyed by inputId. */
  readonly axisRest = signal<ReadonlyMap<string, number>>(new Map());
  /** Raw per-device data for diagnostics (refreshed at most ~8×/s). */
  readonly diagnostics = signal<ReadonlyMap<string, DeviceDiagnostics>>(new Map());
  /** Messages about WebHID devices that were skipped or failed to open. */
  readonly hidNotes = signal<string[]>([]);
  /** Numbering corrections saved in this browser, keyed by Elite device ID. */
  readonly userCorrections = signal<CorrectionMap>(readStored<CorrectionMap>(CORRECTIONS_KEY) ?? {});
  /** True while a capture() is waiting for input. */
  readonly capturing = signal(false);
  /** The open file's keyboard layout, used to name keys. */
  readonly keyboardLayout = computed(() => this.store.doc()?.keyboardLayout ?? null);

  private refCount = 0;
  private readonly runtimes = new Map<string, Runtime>();
  private readonly keysDown = new Map<string, string>(); // code -> Elite key
  private overrides: IdentityOverrides = readStored<IdentityOverrides>(IDENTITY_KEY) ?? {};
  private readonly defCorrections = new Map<string, InputCorrection | null>();
  private rafId: number | null = null;
  private flushQueued = false;
  private lastDiagFlush = 0;
  private diagDirty = false;
  private readonly knownKeys = computed(() => new Set(this.catalog.keys().keys()));

  private readonly captureCtl = new CaptureController(
    () => this.heldInputs(),
    () => this.currentAxisValues(),
  );

  constructor() {
    // Re-pick device IDs when a file is opened or catalogue data arrives.
    effect(() => {
      this.store.devicesUsed();
      this.catalog.namedIds();
      this.catalog.devices();
      untracked(() => this.reresolveAll());
    });
    const hid = navigatorHid();
    if (hid) {
      hid.addEventListener('connect', (e) => {
        if (this.refCount > 0) void this.attachHid((e as HidConnectionEvent).device);
      });
      hid.addEventListener('disconnect', (e) => this.onHidDisconnect((e as HidConnectionEvent).device));
    }
  }

  // ------------------------------------------------------------ lifecycle

  /** Begin listening (ref-counted; call stop() when done). */
  start(): void {
    this.refCount++;
    if (this.refCount > 1) return;
    this.started.set(true);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown, true);
      window.addEventListener('keyup', this.onKeyUp, true);
      window.addEventListener('blur', this.onBlur);
      if (this.gamepadSupported) {
        window.addEventListener('gamepadconnected', this.onPadConnected);
        window.addEventListener('gamepaddisconnected', this.onPadConnected);
        this.rafId = requestAnimationFrame(this.poll);
      }
    }
    const hid = navigatorHid();
    if (hid) {
      hid
        .getDevices()
        .then((ds) => Promise.all(ds.map((d) => this.attachHid(d))))
        .catch((e) => this.noteHid(`Could not list WebHID devices: ${(e as Error).message}`));
    }
  }

  stop(): void {
    if (this.refCount === 0) return;
    this.refCount--;
    if (this.refCount > 0) return;
    this.started.set(false);
    this.captureCtl.abort('Input stopped');
    this.capturing.set(false);
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown, true);
      window.removeEventListener('keyup', this.onKeyUp, true);
      window.removeEventListener('blur', this.onBlur);
      window.removeEventListener('gamepadconnected', this.onPadConnected);
      window.removeEventListener('gamepaddisconnected', this.onPadConnected);
      if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    this.keysDown.clear();
    for (const rt of this.runtimes.values()) {
      rt.pressed.clear();
      rt.deflected.clear();
      if (rt.hid && rt.onReport) {
        rt.hid.removeEventListener('inputreport', rt.onReport);
        rt.onReport = undefined;
        const dev = rt.hid;
        if (dev.opened) dev.close().catch(() => undefined);
      }
    }
    this.queueFlush(true);
  }

  // ------------------------------------------------------------ WebHID

  /** Show the browser's WebHID device picker and start reading what the user grants. */
  async requestHidDevices(): Promise<LiveDevice[]> {
    const hid = navigatorHid();
    if (!hid) return [];
    const granted = await hid.requestDevice({ filters: CONTROLLER_FILTERS });
    const out: LiveDevice[] = [];
    for (const d of granted) {
      const rt = await this.attachHid(d);
      if (rt) out.push(rt.live);
    }
    return out;
  }

  async forgetHidDevice(id: string): Promise<void> {
    const rt = this.runtimes.get(id);
    if (!rt?.hid) return;
    if (rt.onReport) rt.hid.removeEventListener('inputreport', rt.onReport);
    try {
      if (rt.hid.opened) await rt.hid.close();
      await rt.hid.forget?.();
    } catch {
      // Already gone.
    }
    this.runtimes.delete(id);
    this.queueFlush(true);
  }

  private hidRuntimeFor(device: HidDevice): Runtime | undefined {
    for (const rt of this.runtimes.values()) if (rt.hid === device) return rt;
    return undefined;
  }

  private async attachHid(device: HidDevice): Promise<Runtime | null> {
    const usb: UsbId = {
      vid: device.vendorId.toString(16).toUpperCase().padStart(4, '0'),
      pid: device.productId.toString(16).toUpperCase().padStart(4, '0'),
    };
    const label = `${device.productName || 'HID device'} (${usb.vid}:${usb.pid})`;
    if (!device.collections.some(isControllerCollection)) {
      this.noteHid(`${label}: not a joystick/gamepad interface, ignored.`);
      return null;
    }
    await this.catalog.whenReady().catch(() => undefined);
    if (this.catalog.bindsIdsForUsb(usb).includes('GamePad')) {
      this.noteHid(`${label}: an XInput-style gamepad; read through the Gamepad API so it reports as Elite's GamePad.`);
      return null;
    }
    let rt = this.hidRuntimeFor(device);
    if (!rt) {
      // A replugged device comes back as a new HIDDevice object: reuse its old slot.
      rt = [...this.runtimes.values()].find(
        (r) => r.backend === 'webhid' && !r.live.connected && usbKey(r.usb) === usbKey(usb),
      );
      if (rt) {
        rt.hid = device;
        rt.onReport = undefined;
      }
    }
    if (!rt) {
      const layout = parseHidLayout(device.collections);
      const ordinal = this.nextOrdinal(usb);
      const id = `hid:${usb.vid}:${usb.pid}:${ordinal}`;
      rt = this.newRuntime(id, 'webhid', device.productName || 'HID controller', usb, ordinal);
      rt.hid = device;
      rt.layout = layout;
      rt.byReport = new Map();
      rt.counts = { buttons: layout.buttons, axes: layout.axes, hats: layout.hats };
      rt.diag.fields = layout.fields.map(describeField);
      if (layout.fields.some((f) => f.kind === 'axis' && f.usagePage === 0x02)) {
        rt.notes.push('Simulation-page axes (rudder/throttle) were placed in free axis slots; confirm with the numbering check.');
      }
      this.runtimes.set(id, rt);
      this.resolve(rt);
    }
    rt.live = { ...rt.live, connected: true };
    if (this.refCount > 0 && !rt.onReport) {
      try {
        if (!device.opened) await device.open();
        const r = rt;
        r.onReport = (e: Event) => this.onHidReport(r, e as HidInputReportEvent);
        device.addEventListener('inputreport', r.onReport);
        r.diag.error = undefined;
      } catch (e) {
        rt.diag.error = `Could not open: ${(e as Error).message}`;
      }
    }
    this.queueFlush(true);
    return rt;
  }

  private onHidDisconnect(device: HidDevice): void {
    const rt = this.hidRuntimeFor(device);
    if (!rt) return;
    if (rt.onReport) device.removeEventListener('inputreport', rt.onReport);
    rt.onReport = undefined;
    this.ingest(rt, new Set(), new Map());
    rt.live = { ...rt.live, connected: false };
    this.queueFlush(true);
  }

  private onHidReport(rt: Runtime, e: HidInputReportEvent): void {
    if (!rt.layout || !rt.byReport) return;
    rt.diag.raw = `report ${e.reportId} [${e.data.byteLength} B]: ${toHex(e.data)}`;
    rt.diag.rawAt = Date.now();
    this.diagDirty = true;
    const decoded = decodeReport(rt.layout, e.reportId, e.data);
    if (!decoded) {
      this.queueFlush();
      return;
    }
    rt.byReport.set(e.reportId, decoded);
    const pressed = new Set<string>();
    const axes = new Map<string, number>();
    for (const d of rt.byReport.values()) {
      for (const k of d.pressed) pressed.add(applyCorrection(k, rt.correction));
      for (const [k, v] of d.axes) axes.set(applyCorrection(k, rt.correction), v);
    }
    this.ingest(rt, pressed, axes);
  }

  private noteHid(msg: string): void {
    this.hidNotes.update((n) => (n.includes(msg) ? n : [...n.slice(-19), msg]));
  }

  // ------------------------------------------------------------ Gamepad API

  private readonly onPadConnected = () => {
    // Chrome/Firefox only expose pads to pages that listen; polling does the rest.
  };

  private readonly poll = () => {
    if (this.refCount === 0) return;
    this.rafId = requestAnimationFrame(this.poll);
    let raw: (Gamepad | null)[] = [];
    try {
      raw = [...navigator.getGamepads()];
    } catch {
      return;
    }
    const hidUsb = new Set(
      [...this.runtimes.values()].filter((r) => r.backend === 'webhid' && r.live.connected).map((r) => usbKey(r.usb)),
    );
    const groups = new Map<string, { usb?: UsbId; name: string; pads: PadSnapshot[] }>();
    for (const gp of raw) {
      if (!gp || gp.connected === false) continue;
      const pad = snapshotGamepad(gp);
      const { usb, name } = parseGamepadId(pad.id);
      if (usb && hidUsb.has(usbKey(usb))) continue;
      const key = usb ? usbKey(usb) : `idx${pad.index}`;
      const g = groups.get(key);
      if (g) g.pads.push(pad);
      else groups.set(key, { usb, name, pads: [pad] });
    }
    const seen = new Set<string>();
    for (const g of groups.values()) {
      g.pads.sort((a, b) => a.index - b.index);
      // Several pads with one VID/PID: one big device split into 32-button banks
      // (when a bank is full), otherwise identical devices.
      const banked = g.pads.length > 1 && g.pads.some((p) => p.buttons.length >= 32);
      const sets = banked ? [g.pads] : g.pads.map((p) => [p]);
      sets.forEach((pads, n) => {
        const id = g.usb ? `gp:${usbKey(g.usb)}:${n}` : `gp:${pads[0].index}`;
        seen.add(id);
        let rt = this.runtimes.get(id);
        if (!rt) {
          rt = this.newRuntime(id, 'gamepad', g.name, g.usb, g.usb ? n : 0);
          rt.hatAxes = new Map();
          const named = !!g.usb && this.catalog.bindsIdsForUsb(g.usb).includes('GamePad');
          rt.profile = padProfile(pads[0], g.usb, named);
          this.runtimes.set(id, rt);
          this.resolve(rt);
        }
        if (!rt.live.connected) {
          rt.live = { ...rt.live, connected: true };
          this.queueFlush(true);
        }
        if (banked && !rt.notes.some((x) => x.startsWith('Split'))) {
          rt.notes.push(
            `Split by the browser into ${pads.length} banks of 32 buttons; bank order is a guess, use the numbering check to confirm.`,
          );
        }
        this.ingestPads(rt, pads);
      });
    }
    for (const rt of [...this.runtimes.values()]) {
      if (rt.backend === 'gamepad' && rt.usb && hidUsb.has(usbKey(rt.usb))) {
        // Now read through WebHID instead.
        this.releaseAll(rt);
        this.runtimes.delete(rt.id);
        this.queueFlush(true);
        continue;
      }
      if (rt.backend === 'gamepad' && rt.live.connected && !seen.has(rt.id)) {
        this.ingest(rt, new Set(), new Map());
        rt.live = { ...rt.live, connected: false };
        this.queueFlush(true);
      }
    }
  };

  private ingestPads(rt: Runtime, pads: PadSnapshot[]): void {
    let pressed: Set<string>;
    let axes: Map<string, number>;
    if (rt.profile === 'xinput' || rt.profile === 'sony') {
      const m = mapStandardPad(pads[0], rt.profile);
      pressed = new Set([...m.pressed].map((k) => applyCorrection(k, rt.profile === 'sony' ? rt.correction : undefined)));
      axes = new Map(
        [...m.axes].map(([k, v]) => [applyCorrection(k, rt.profile === 'sony' ? rt.correction : undefined), v] as const),
      );
      rt.counts = {
        buttons: rt.profile === 'xinput' ? Math.min(16, pads[0].buttons.length) : Math.min(15, pads[0].buttons.length),
        axes: m.axes.size,
        hats: rt.profile === 'sony' ? 1 : 0,
      };
    } else {
      const m = mapJoystickBanks(pads, rt.hatAxes!, rt.correction);
      pressed = m.pressed;
      axes = m.axes;
      rt.counts = { buttons: m.buttons, axes: m.axisCount, hats: m.hats };
    }
    const summary = pads
      .map((p) => `#${p.index}: ${p.buttons.filter((b) => b.pressed).length} pressed, axes ${p.axes.map((a) => a.toFixed(2)).join(' ')}`)
      .join(' | ');
    if (summary !== rt.diag.raw) {
      rt.diag.raw = summary;
      rt.diag.rawAt = Date.now();
      rt.diag.pads = pads.map((p) => ({
        index: p.index,
        id: p.id,
        mapping: p.mapping,
        buttons: p.buttons.map((b) => Math.round(b.value * 100) / 100),
        axes: p.axes.map((a) => Math.round(a * 1000) / 1000),
      }));
      this.diagDirty = true;
    }
    if (
      rt.live.buttons !== rt.counts.buttons ||
      rt.live.axes !== rt.counts.axes ||
      rt.live.hats !== rt.counts.hats
    ) {
      rt.live = { ...rt.live, ...rt.counts };
      this.queueFlush(true);
    }
    this.ingest(rt, pressed, axes);
  }

  // ------------------------------------------------------------ keyboard

  private readonly onKeyDown = (e: KeyboardEvent) => {
    const capturing = this.captureCtl.active;
    const isEscape = e.code === 'Escape' || e.key === 'Escape';
    if (capturing && !isEscape) {
      e.preventDefault();
      e.stopPropagation();
    }
    const key = eliteKeyForEvent(e, this.keyboardLayout(), this.knownKeys());
    if (!key || this.keysDown.has(e.code)) return;
    this.keysDown.set(e.code, key);
    this.emitKey(key, true);
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    if (this.captureCtl.active && e.code !== 'Escape') {
      e.preventDefault();
      e.stopPropagation();
    }
    const key = this.keysDown.get(e.code);
    if (!key) return;
    this.keysDown.delete(e.code);
    this.emitKey(key, false);
  };

  private readonly onBlur = () => {
    for (const [code, key] of [...this.keysDown]) {
      this.keysDown.delete(code);
      this.emitKey(key, false);
    }
  };

  private emitKey(key: string, pressed: boolean): void {
    this.emit({
      device: this.keyboardDevice,
      ref: { device: 'Keyboard', key },
      kind: 'key',
      value: pressed ? 1 : 0,
      pressed,
      timestamp: performance.now(),
    });
    this.queueFlush();
  }

  // ------------------------------------------------------------ identity & corrections

  /** Override which Elite device ID a live device reports as. */
  setBindsId(deviceId: string, bindsId: string, deviceIndex = 0): void {
    const rt = this.runtimes.get(deviceId);
    if (!rt) return;
    const k = identityKey(rt.usb, rt.ordinal, rt.id);
    this.overrides = { ...this.overrides, [k]: { bindsId, deviceIndex } };
    if (rt.usb) writeStored(IDENTITY_KEY, this.overrides);
    this.releaseAll(rt);
    this.resolve(rt);
    this.queueFlush(true);
  }

  /** Forget a setBindsId() override and go back to the automatic choice. */
  resetBindsId(deviceId: string): void {
    const rt = this.runtimes.get(deviceId);
    if (!rt) return;
    const k = identityKey(rt.usb, rt.ordinal, rt.id);
    const { [k]: _gone, ...rest } = this.overrides;
    this.overrides = rest;
    writeStored(IDENTITY_KEY, this.overrides);
    this.releaseAll(rt);
    this.resolve(rt);
    this.queueFlush(true);
  }

  /** True when the device's ID was chosen by the user. */
  hasBindsIdOverride(deviceId: string): boolean {
    const rt = this.runtimes.get(deviceId);
    return !!rt && !!this.overrides[identityKey(rt.usb, rt.ordinal, rt.id)];
  }

  /** Save (or with null, remove) a numbering correction for an Elite device ID; applies immediately. */
  setCorrection(bindsId: string, correction: InputCorrection | null): void {
    const next = { ...this.userCorrections() };
    if (correction && (correction.buttonOffset || (correction.axisMap && Object.keys(correction.axisMap).length))) {
      next[bindsId] = correction;
    } else delete next[bindsId];
    this.userCorrections.set(next);
    writeStored(CORRECTIONS_KEY, next);
    for (const rt of this.runtimes.values()) {
      if (rt.live.bindsId === bindsId) {
        this.releaseAll(rt);
        this.resolve(rt);
      }
    }
    this.queueFlush(true);
  }

  /** Correction in effect for an Elite device ID (device definition + user's). */
  correctionFor(bindsId: string): InputCorrection | undefined {
    return mergeCorrections(this.defCorrections.get(bindsId) ?? undefined, this.userCorrections()[bindsId]);
  }

  private newRuntime(id: string, backend: 'webhid' | 'gamepad', name: string, usb: UsbId | undefined, ordinal: number): Runtime {
    const live: LiveDevice = {
      id,
      name,
      backend,
      usb,
      bindsId: '',
      deviceIndex: 0,
      candidates: [],
      connected: true,
      buttons: 0,
      axes: 0,
      hats: 0,
    };
    return {
      id,
      backend,
      name,
      usb,
      ordinal,
      live,
      pressed: new Set(),
      axes: new Map(),
      rest: new Map(),
      emitted: new Map(),
      deflected: new Set(),
      notes: [],
      counts: { buttons: 0, axes: 0, hats: 0 },
      diag: { id, backend, raw: '', rawAt: 0 },
    };
  }

  private nextOrdinal(usb: UsbId): number {
    const taken = new Set(
      [...this.runtimes.values()]
        .filter((r) => usbKey(r.usb) === usbKey(usb) && r.backend === 'webhid' && r.live.connected)
        .map((r) => r.ordinal),
    );
    let n = 0;
    while (taken.has(n)) n++;
    return n;
  }

  private reresolveAll(): void {
    for (const rt of this.runtimes.values()) this.resolve(rt);
    this.queueFlush(true);
  }

  private resolve(rt: Runtime): void {
    let candidates = rt.usb ? this.catalog.bindsIdsForUsb(rt.usb) : [];
    if (rt.profile === 'xinput') candidates = ['GamePad', ...candidates.filter((c) => c !== 'GamePad')];
    const sameUsb = [...this.runtimes.values()].filter(
      (r) => r.usb && rt.usb && usbKey(r.usb) === usbKey(rt.usb) && r.live.connected,
    ).length;
    const auto = chooseIdentity({
      candidates,
      namedIds: new Set(Object.keys(this.catalog.namedIds())),
      used: this.store.devicesUsed(),
      ordinal: rt.ordinal,
      sameUsbCount: Math.max(1, sameUsb),
    });
    if (rt.profile === 'xinput') auto.bindsId = 'GamePad';
    const ov = this.overrides[identityKey(rt.usb, rt.ordinal, rt.id)];
    const bindsId = ov?.bindsId ?? auto.bindsId;
    const deviceIndex = ov?.deviceIndex ?? auto.deviceIndex;
    const cands = auto.candidates.includes(bindsId) ? auto.candidates : [bindsId, ...auto.candidates];
    if (bindsId !== rt.live.bindsId || deviceIndex !== rt.live.deviceIndex) this.releaseAll(rt);
    rt.live = {
      ...rt.live,
      bindsId,
      deviceIndex,
      candidates: cands,
      ...rt.counts,
      notes: rt.notes.length ? [...rt.notes] : undefined,
    };
    rt.correction = this.correctionFor(bindsId);
    rt.diag.correction = rt.correction;
    rt.diag.profile = rt.profile;
    this.loadDefCorrection(bindsId, deviceIndex);
  }

  private loadDefCorrection(bindsId: string, deviceIndex: number): void {
    if (this.defCorrections.has(bindsId)) return;
    const summary = this.catalog.deviceFor(bindsId, deviceIndex);
    if (!summary) return;
    this.defCorrections.set(bindsId, null);
    this.catalog
      .loadDevice(summary.id)
      .then((def) => {
        const c = def.inputCorrections?.[bindsId];
        if (c) {
          this.defCorrections.set(bindsId, c);
          this.reresolveAll();
        }
      })
      .catch(() => undefined);
  }

  // ------------------------------------------------------------ state & events

  private refFor(rt: Runtime, key: string): InputRef {
    const d = rt.live.deviceIndex;
    return d ? { device: rt.live.bindsId, key, deviceIndex: d } : { device: rt.live.bindsId, key };
  }

  private kindOf(key: string): CaptureKind {
    return /POV\d+(Up|Down|Left|Right)$/.test(key) ? 'hat' : 'button';
  }

  /** Diff a device's new state against the previous one and emit events. */
  private ingest(rt: Runtime, pressed: Set<string>, axes: Map<string, number>): void {
    const now = performance.now();
    const released = [...rt.pressed].filter((k) => !pressed.has(k));
    const added = [...pressed].filter((k) => !rt.pressed.has(k));
    rt.pressed = pressed;
    let changed = released.length > 0 || added.length > 0;
    for (const k of released) {
      this.emit({ device: rt.live, ref: this.refFor(rt, k), kind: this.kindOf(k), value: 0, pressed: false, timestamp: now });
    }
    for (const k of added) {
      this.emit({ device: rt.live, ref: this.refFor(rt, k), kind: this.kindOf(k), value: 1, pressed: true, timestamp: now });
    }
    for (const [k, v] of axes) {
      const prev = rt.axes.get(k);
      if (prev === v) continue;
      rt.axes.set(k, v);
      changed = true;
      if (!rt.rest.has(k)) rt.rest.set(k, v);
      const rest = rt.rest.get(k)!;
      const ref = this.refFor(rt, k);
      const isPressed = Math.abs(v - rest) > AXIS_PRESS;
      const wasPressed = rt.deflected.has(k);
      if (Math.abs(v - rest) > AXIS_ACTIVE) rt.deflected.add(k);
      else rt.deflected.delete(k);
      const last = rt.emitted.get(k);
      const ev: InputEvent = { device: rt.live, ref, kind: 'axis', value: v, pressed: isPressed, timestamp: now };
      if (last === undefined || Math.abs(v - last) >= AXIS_EVENT_STEP || isPressed !== wasPressed) {
        rt.emitted.set(k, v);
        this.eventSubject.next(ev);
      }
      // The capture sees every sample (it needs consecutive readings).
      this.captureCtl.feed(ev);
    }
    if (changed) this.queueFlush();
  }

  private emit(ev: InputEvent): void {
    this.eventSubject.next(ev);
    this.captureCtl.feed(ev);
  }

  private releaseAll(rt: Runtime): void {
    if (rt.pressed.size) this.ingest(rt, new Set(), new Map());
    rt.axes.clear();
    rt.rest.clear();
    rt.emitted.clear();
    rt.deflected.clear();
    rt.byReport?.clear();
  }

  /** Held controls right now (`held` is refreshed once per frame; this is exact). */
  heldNow(): InputRef[] {
    return this.heldInputs().map((h) => h.ref);
  }

  private heldInputs(): HeldInput[] {
    const out: HeldInput[] = [];
    for (const rt of this.runtimes.values()) {
      if (!rt.live.connected) continue;
      for (const k of rt.pressed) out.push({ ref: this.refFor(rt, k), kind: this.kindOf(k), device: rt.live });
    }
    for (const key of this.keysDown.values()) {
      out.push({ ref: { device: 'Keyboard', key }, kind: 'key', device: this.keyboardDevice });
    }
    return out;
  }

  private currentAxisValues(): Map<string, number> {
    const m = new Map<string, number>();
    for (const rt of this.runtimes.values()) {
      if (!rt.live.connected) continue;
      for (const [k, v] of rt.axes) m.set(inputId(this.refFor(rt, k)), v);
    }
    return m;
  }

  private queueFlush(structural = false): void {
    if (structural) this.diagDirty = true;
    if (this.flushQueued) return;
    this.flushQueued = true;
    const run = () => {
      this.flushQueued = false;
      this.flush();
    };
    if (typeof requestAnimationFrame !== 'undefined' && typeof document !== 'undefined' && !document.hidden) {
      requestAnimationFrame(run);
    } else setTimeout(run, 16);
  }

  private flush(): void {
    const list = [...this.runtimes.values()].map((rt) => {
      if (
        rt.live.buttons !== rt.counts.buttons ||
        rt.live.axes !== rt.counts.axes ||
        rt.live.hats !== rt.counts.hats ||
        (rt.live.notes?.length ?? 0) !== rt.notes.length
      ) {
        rt.live = { ...rt.live, ...rt.counts, notes: rt.notes.length ? [...rt.notes] : undefined };
      }
      return rt.live;
    });
    const prev = this.devices();
    if (list.length !== prev.length || list.some((d, i) => d !== prev[i])) this.devices.set(list);
    this.held.set(this.heldInputs().map((h) => h.ref));
    this.axisValues.set(this.currentAxisValues());
    const moved = new Set<string>();
    const rest = new Map<string, number>();
    for (const rt of this.runtimes.values()) {
      for (const k of rt.deflected) moved.add(inputId(this.refFor(rt, k)));
      for (const [k, v] of rt.rest) rest.set(inputId(this.refFor(rt, k)), v);
    }
    this.movedAxes.set(moved);
    this.axisRest.set(rest);
    const now = Date.now();
    if (this.diagDirty && now - this.lastDiagFlush > 120) {
      this.diagDirty = false;
      this.lastDiagFlush = now;
      this.diagnostics.set(new Map([...this.runtimes.values()].map((rt) => [rt.id, { ...rt.diag }])));
    } else if (this.diagDirty) {
      setTimeout(() => this.queueFlush(), 130);
    }
  }

  // ------------------------------------------------------------ capture

  /**
   * Resolve with the next accepted input: a button/hat/key press (with any
   * other held controls as modifiers), or an axis moved away from rest.
   * Rejects with a DOMException named AbortError when `signal` aborts.
   *
   * Combinations: the capture completes when the first held control is
   * released, so "hold A, press B" gives B with modifier A. With
   * `modifiers: false` it completes on the press. Escape is never captured
   * (it stays free to cancel dialogs). A new capture aborts the previous one.
   */
  capture(opts: CaptureOptions): Promise<CaptureResult> {
    this.start();
    this.capturing.set(true);
    const p = this.captureCtl.begin(opts);
    const done = () => {
      if (!this.captureCtl.active) this.capturing.set(false);
      this.stop();
    };
    p.then(done, done);
    return p;
  }
}
