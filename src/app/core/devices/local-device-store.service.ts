import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { CatalogService, LocalDevice } from '../data/catalog.service';
import { DeviceDefinition } from '../data/catalog.types';
import { buildDeviceZip, normalizeDefinition, readDeviceZip, schemaErrors } from './device-files';
import { IdbBackend, KvBackend, MemoryBackend } from './kv-backend';

/** IndexedDB factory (null when unavailable). Overridable in tests. */
export const IDB_FACTORY = new InjectionToken<IDBFactory | null>('IDB_FACTORY', {
  providedIn: 'root',
  factory: () => {
    try {
      return typeof indexedDB === 'undefined' ? null : indexedDB;
    } catch {
      return null;
    }
  },
});

export interface StoredDevice {
  id: string;
  definition: DeviceDefinition;
  /** Artwork, same order as definition.images. */
  images: Blob[];
  updated: number;
}

/**
 * Devices made with the layout editor, kept in this browser (IndexedDB:
 * definition + image blobs) and registered with the CatalogService so the
 * rest of the app uses them like bundled devices. Also keeps editor drafts.
 * Falls back to memory (this session only) when IndexedDB is unavailable.
 */
@Injectable({ providedIn: 'root' })
export class LocalDeviceStore {
  private readonly catalog = inject(CatalogService);
  private readonly factory = inject(IDB_FACTORY);

  /** Saved devices, newest first. */
  readonly devices = signal<StoredDevice[]>([]);
  /** False when saving only lasts for this session. */
  readonly persistent = signal(true);

  private backendPromise: Promise<KvBackend> | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly urls = new Map<string, { updated: number; urls: string[] }>();

  private backend(): Promise<KvBackend> {
    this.backendPromise ??= (async () => {
      if (this.factory) {
        try {
          return await IdbBackend.open(this.factory);
        } catch (e) {
          console.warn('Local devices: IndexedDB unavailable, keeping them for this session only.', e);
        }
      }
      return new MemoryBackend();
    })().then((b) => {
      this.persistent.set(b.persistent);
      return b;
    });
    return this.backendPromise;
  }

  /** Load saved devices and register them with the catalogue (app initializer). */
  init(): Promise<void> {
    this.initPromise ??= (async () => {
      try {
        const b = await this.backend();
        const list = await b.getAll<StoredDevice>('devices');
        this.devices.set(list.filter((d) => d && d.definition && Array.isArray(d.images)).sort((a, b) => b.updated - a.updated));
      } catch (e) {
        console.warn('Local devices: could not load saved devices.', e);
      }
      this.publish();
    })();
    return this.initPromise;
  }

  async list(): Promise<StoredDevice[]> {
    await this.init();
    return this.devices();
  }

  get(id: string): StoredDevice | undefined {
    return this.devices().find((d) => d.id === id);
  }

  /** Save (or replace) a device. Throws if the definition is invalid. */
  async save(definition: DeviceDefinition, images: Blob[]): Promise<StoredDevice> {
    await this.init();
    const def = normalizeDefinition(definition);
    const errors = schemaErrors(def);
    if (errors.length) throw new Error(`Device is not valid: ${errors.slice(0, 3).join('; ')}`);
    if (images.length !== def.images.length) throw new Error('Every image in the definition needs its file');
    const stored: StoredDevice = { id: def.id, definition: def, images: [...images], updated: Date.now() };
    this.devices.update((list) => [stored, ...list.filter((d) => d.id !== def.id)]);
    this.publish();
    await this.persist((b) => b.put('devices', def.id, stored));
    return stored;
  }

  async delete(id: string): Promise<void> {
    await this.init();
    this.devices.update((list) => list.filter((d) => d.id !== id));
    this.publish();
    await this.persist((b) => b.delete('devices', id));
  }

  /** The device as a repo-layout .zip (see buildDeviceZip). */
  async exportZip(id: string): Promise<Blob> {
    await this.init();
    const d = this.get(id);
    if (!d) throw new Error(`No saved device "${id}"`);
    return buildDeviceZip(
      d.definition,
      d.definition.images.map((img, i) => ({ file: img.file, blob: d.images[i] })),
    );
  }

  /** Import a device .zip (as exported by the editor) and save it. */
  async importZip(file: Blob): Promise<StoredDevice> {
    const { definition, images } = await readDeviceZip(file);
    return this.save({ ...definition, source: 'user' }, images);
  }

  // ------------------------------------------------------------ editor drafts

  async saveDraft(key: string, value: unknown): Promise<void> {
    await this.persist((b) => b.put('drafts', key, value));
  }

  async loadDraft<T>(key: string): Promise<T | undefined> {
    try {
      return await (await this.backend()).get<T>('drafts', key);
    } catch (e) {
      console.warn('Local devices: could not read draft.', e);
      return undefined;
    }
  }

  async deleteDraft(key: string): Promise<void> {
    await this.persist((b) => b.delete('drafts', key));
  }

  // ------------------------------------------------------------ internals

  private async persist(op: (b: KvBackend) => Promise<void>): Promise<void> {
    try {
      await op(await this.backend());
    } catch (e) {
      // Still usable for this session; just not saved.
      console.warn('Local devices: could not write to IndexedDB.', e);
      this.persistent.set(false);
    }
  }

  /** Register current devices (with object URLs for their images) with the catalogue. */
  private publish(): void {
    const canUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
    const live = new Set(this.devices().map((d) => d.id));
    for (const [id, entry] of this.urls) {
      const d = this.get(id);
      if (!live.has(id) || d?.updated !== entry.updated) {
        if (canUrl) entry.urls.forEach((u) => u && URL.revokeObjectURL(u));
        this.urls.delete(id);
      }
    }
    const local: LocalDevice[] = this.devices().map((d) => {
      let entry = this.urls.get(d.id);
      if (!entry) {
        entry = { updated: d.updated, urls: canUrl ? d.images.map(objectUrl) : [] };
        this.urls.set(d.id, entry);
      }
      return { definition: d.definition, imageUrls: entry.urls };
    });
    this.catalog.setLocalDevices(local);
  }
}

function objectUrl(b: Blob): string {
  try {
    return URL.createObjectURL(b);
  } catch {
    return '';
  }
}
