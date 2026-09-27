import { Injectable, computed, signal } from '@angular/core';
import { InputRef } from '../binds/binds-document';
import {
  ActionInfo,
  DeviceDefinition,
  DeviceSummary,
  GenericControl,
  KeyInfo,
  SettingInfo,
  UsbId,
} from './catalog.types';

/** Devices defined by the game itself rather than by USB ID. */
export const BUILTIN_DEVICES: Record<string, string> = {
  Keyboard: 'Keyboard',
  Mouse: 'Mouse',
  GamePad: 'Gamepad',
};

export interface LocalDevice {
  definition: DeviceDefinition;
  /** Object URLs for definition.images, same order. */
  imageUrls: string[];
}

/** Humanise an Elite control code: `Joy_POV1Up` -> "POV1 Up", `Key_LeftAlt` -> "Left Alt". */
export function humanizeKey(key: string): string {
  const half = /^(Pos|Neg)_(.*)$/.exec(key);
  if (half) return `${humanizeKey(half[2])} ${half[1] === 'Pos' ? '+' : '−'}`;
  return key
    .replace(/^(Joy|Key|GamePad|Pad|Mouse)_/, '')
    .replace(/_/g, ' ')
    .replace(/(?<=[a-z0-9])(?=[A-Z])/g, ' ')
    .replace(/(?<=[A-Z])(?=[A-Z][a-z])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Static data: action catalogue, key names, device definitions and artwork.
 * Loads the small files eagerly; device definitions are fetched on demand.
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  readonly actions = signal<ReadonlyMap<string, ActionInfo>>(new Map());
  readonly settings = signal<ReadonlyMap<string, SettingInfo>>(new Map());
  readonly keys = signal<ReadonlyMap<string, KeyInfo>>(new Map());
  /** Named Elite device IDs (e.g. SaitekX56Joystick) -> USB IDs. */
  readonly namedIds = signal<Readonly<Record<string, UsbId[]>>>({});
  readonly genericControls = signal<readonly GenericControl[]>([]);
  private readonly bundledDevices = signal<readonly DeviceSummary[]>([]);
  private readonly localDevices = signal<readonly LocalDevice[]>([]);
  readonly definitions = signal<ReadonlyMap<string, DeviceDefinition>>(new Map());
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);

  /** All devices: bundled plus ones made in this browser (which win on conflicts). */
  readonly devices = computed<DeviceSummary[]>(() => {
    const local = this.localDevices().map(({ definition: d }) => ({
      id: d.id,
      name: d.name,
      source: d.source,
      ids: d.ids,
      keyBindsIds: d.keyBindsIds,
      images: d.images,
      controlCount: d.controls.length,
      local: true,
    }));
    const localIds = new Set(local.map((d) => d.id));
    return [...local, ...this.bundledDevices().filter((d) => !localIds.has(d.id))];
  });

  /** `bindsId` and `bindsId::index` -> device summary. Index-specific entries win. */
  private readonly byBindsId = computed(() => {
    const map = new Map<string, DeviceSummary>();
    // Iterate in reverse so earlier (local) devices overwrite later ones.
    for (const d of [...this.devices()].reverse()) {
      for (const id of d.ids) {
        map.set(id.deviceIndex === undefined ? id.bindsId : `${id.bindsId}::${id.deviceIndex}`, d);
      }
    }
    return map;
  });

  private readonly ready: Promise<void>;
  private readonly pending = new Map<string, Promise<DeviceDefinition>>();

  constructor() {
    this.ready = this.loadAll();
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  private async loadAll(): Promise<void> {
    try {
      const [actions, settings, keys, namedIds, generic, devices] = await Promise.all([
        fetchJson<ActionInfo[]>('data/actions.json'),
        fetchJson<SettingInfo[]>('data/settings.json'),
        fetchJson<KeyInfo[]>('data/keys.json'),
        fetchJson<Record<string, UsbId[]>>('data/device-ids.json'),
        fetchJson<GenericControl[]>('data/generic-device.json'),
        fetchJson<DeviceSummary[]>('data/devices.index.json'),
      ]);
      this.actions.set(new Map(actions.map((a) => [a.code, a])));
      this.settings.set(new Map(settings.map((s) => [s.code, s])));
      this.keys.set(new Map(keys.map((k) => [k.key, k])));
      this.namedIds.set(namedIds);
      this.genericControls.set(generic);
      this.bundledDevices.set(devices);
      this.loaded.set(true);
    } catch (e) {
      this.error.set(`Could not load app data: ${(e as Error).message}`);
      throw e;
    }
  }

  // ------------------------------------------------------------ actions

  action(code: string): ActionInfo {
    return (
      this.actions().get(code) ?? {
        code,
        name: humanizeKey(code),
        longName: humanizeKey(code),
        group: 'Misc',
        category: 'General',
        area: 'Other',
        section: 'Other',
        type: 'digital',
        order: 10_000,
      }
    );
  }

  // ------------------------------------------------------------ devices

  /** Device summary for an Elite device ID, if any definition handles it. */
  deviceFor(bindsId: string, deviceIndex = 0): DeviceSummary | undefined {
    const map = this.byBindsId();
    return map.get(`${bindsId}::${deviceIndex}`) ?? map.get(bindsId);
  }

  deviceById(id: string): DeviceSummary | undefined {
    return this.devices().find((d) => d.id === id);
  }

  /** Fetch (and cache) the full definition of a device. */
  loadDevice(id: string): Promise<DeviceDefinition> {
    const local = this.localDevices().find((l) => l.definition.id === id);
    if (local) return Promise.resolve(local.definition);
    const cached = this.definitions().get(id);
    if (cached) return Promise.resolve(cached);
    let p = this.pending.get(id);
    if (!p) {
      p = fetchJson<DeviceDefinition>(`devices/${encodeURIComponent(id)}/device.json`).then((def) => {
        this.definitions.update((m) => new Map(m).set(id, def));
        this.pending.delete(id);
        return def;
      });
      this.pending.set(id, p);
    }
    return p;
  }

  /** Load definitions for every device referenced by these IDs. */
  async loadDevicesFor(refs: { device: string; deviceIndex?: number }[]): Promise<void> {
    await this.ready;
    const ids = new Set<string>();
    for (const r of refs) {
      const d = this.deviceFor(r.device, r.deviceIndex ?? 0);
      if (d) ids.add(d.id);
    }
    await Promise.all([...ids].map((id) => this.loadDevice(id).catch(() => undefined)));
  }

  /** URL of a device image, for <img>/<image> use. */
  imageUrl(device: DeviceSummary | DeviceDefinition, index = 0): string | null {
    const local = this.localDevices().find((l) => l.definition.id === device.id);
    if (local) return local.imageUrls[index] ?? null;
    const img = device.images[index];
    return img ? `devices/${encodeURIComponent(device.id)}/${encodeURIComponent(img.file)}` : null;
  }

  /** Register devices made in the layout editor (persisted elsewhere). */
  setLocalDevices(devices: LocalDevice[]): void {
    this.localDevices.set(devices);
    const ids = new Set(devices.map((d) => d.definition.id));
    this.definitions.update((m) => {
      const next = new Map(m);
      for (const id of ids) next.delete(id);
      return next;
    });
  }

  localDevice(id: string): LocalDevice | undefined {
    return this.localDevices().find((l) => l.definition.id === id);
  }

  /** Elite device IDs that might be written for a USB device, most specific first. */
  bindsIdsForUsb(usb: UsbId): string[] {
    const vid = usb.vid.toUpperCase();
    const pid = usb.pid.toUpperCase();
    const ids = [`${vid}${pid}`];
    for (const [name, list] of Object.entries(this.namedIds())) {
      if (list.some((u) => u.vid === vid && u.pid === pid)) ids.push(name);
    }
    for (const d of this.devices()) {
      for (const id of d.ids) {
        if (id.usb && id.usb.vid === vid && id.usb.pid === pid && !ids.includes(id.bindsId)) ids.push(id.bindsId);
      }
    }
    return ids;
  }

  // ------------------------------------------------------------ labels

  deviceName(bindsId: string, deviceIndex = 0): string {
    if (bindsId in BUILTIN_DEVICES) return BUILTIN_DEVICES[bindsId];
    if (bindsId === '{NoDevice}' || bindsId === '') return '';
    const d = this.deviceFor(bindsId, deviceIndex);
    const base = d ? d.name : bindsId;
    return deviceIndex > 0 ? `${base} #${deviceIndex + 1}` : base;
  }

  /** Friendly name of one control, e.g. "TG1 (Trigger)" or "Left Alt". */
  controlLabel(ref: InputRef): string {
    if (!ref.key) return '';
    if (ref.device === 'Keyboard') return this.keys().get(ref.key)?.label ?? humanizeKey(ref.key);
    if (ref.device === 'Mouse') return humanizeKey(ref.key).replace(/^(\d+)$/, 'Button $1');

    const summary = this.deviceFor(ref.device, ref.deviceIndex ?? 0);
    const def = summary ? this.definitions().get(summary.id) ?? this.localDevice(summary.id)?.definition : undefined;
    if (def) {
      const idx = ref.deviceIndex ?? 0;
      const find = (key: string) =>
        def.controls.find((c) => c.bindsId === ref.device && c.key === key && (c.deviceIndex ?? idx) === idx) ??
        def.controls.find((c) => c.bindsId === ref.device && c.key === key);
      const exact = find(ref.key);
      if (exact) return exact.label;
      const half = /^(Pos|Neg)_(.*)$/.exec(ref.key);
      if (half) {
        const base = find(half[2]);
        if (base) return `${base.label} ${half[1] === 'Pos' ? '+' : '−'}`;
      }
    }
    return this.genericControls().find((g) => g.key === ref.key)?.label ?? humanizeKey(ref.key);
  }

  /** "Device › Control", e.g. "Logitech/Saitek X56 › TG1 (Trigger)". */
  inputLabel(ref: InputRef | null | undefined): string {
    if (!ref || !ref.key || ref.device === '{NoDevice}') return '';
    return `${this.deviceName(ref.device, ref.deviceIndex ?? 0)} › ${this.controlLabel(ref)}`;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}
