import { TestBed } from '@angular/core/testing';
import JSZip from 'jszip';
import { CatalogService, LocalDevice } from '../data/catalog.service';
import { DeviceDefinition } from '../data/catalog.types';
import { IDB_FACTORY, LocalDeviceStore } from './local-device-store.service';

/** Just enough of IndexedDB for IdbBackend: open/upgrade, get/getAll/put/delete. */
function fakeIndexedDb(): IDBFactory {
  const dbs = new Map<string, Map<string, Map<string, unknown>>>();
  const later = (fn: () => void) => setTimeout(fn, 0);
  const request = <T>(get: () => T) => {
    const r: { result?: T; onsuccess?: () => void; onerror?: () => void } = {};
    later(() => {
      r.result = get();
      r.onsuccess?.();
    });
    return r;
  };
  return {
    open(name: string) {
      const req: Record<string, unknown> & { onupgradeneeded?: () => void; onsuccess?: () => void } = {};
      later(() => {
        const fresh = !dbs.has(name);
        if (fresh) dbs.set(name, new Map());
        const stores = dbs.get(name)!;
        req['result'] = {
          objectStoreNames: { contains: (s: string) => stores.has(s) },
          createObjectStore: (s: string) => stores.set(s, new Map()),
          transaction(storeName: string) {
            const tx: { oncomplete?: () => void; objectStore?: unknown } = {};
            const data = stores.get(storeName)!;
            tx.objectStore = () => ({
              getAll: () => request(() => [...data.values()]),
              get: (k: string) => request(() => data.get(k)),
              put: (v: unknown, k: string) => {
                data.set(k, v);
                later(() => tx.oncomplete?.());
              },
              delete: (k: string) => {
                data.delete(k);
                later(() => tx.oncomplete?.());
              },
            });
            return tx;
          },
        };
        if (fresh) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  } as unknown as IDBFactory;
}

function def(id = 'Test-Stick'): DeviceDefinition {
  return {
    id,
    name: 'Test stick',
    source: 'user',
    ids: [{ bindsId: '12345678' }],
    images: [{ file: `${id}.webp`, width: 100, height: 50 }],
    controls: [{ bindsId: '12345678', key: 'Joy_1', label: 'Trigger', kind: 'button', image: 0, box: { x: 1, y: 2, w: 30, h: 10 } }],
  };
}

function setup(factory: IDBFactory | null) {
  const published: LocalDevice[][] = [];
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: IDB_FACTORY, useValue: factory },
      { provide: CatalogService, useValue: { setLocalDevices: (d: LocalDevice[]) => published.push(d) } },
    ],
  });
  return { store: TestBed.inject(LocalDeviceStore), published };
}

const image = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });

describe('LocalDeviceStore', () => {
  it('persists devices in IndexedDB and registers them with the catalogue', async () => {
    const idb = fakeIndexedDb();
    const a = setup(idb);
    await a.store.init();
    expect(a.store.persistent()).toBe(true);
    await a.store.save(def(), [image()]);
    expect(a.published.at(-1)?.map((d) => d.definition.id)).toEqual(['Test-Stick']);
    expect(a.published.at(-1)?.[0].definition.$schema).toBe('../../schemas/device.schema.json');

    // A new app instance sees it.
    const b = setup(idb);
    await b.store.init();
    expect((await b.store.list()).map((d) => d.id)).toEqual(['Test-Stick']);
    expect(b.published.at(-1)?.length).toBe(1);

    await b.store.delete('Test-Stick');
    expect(b.published.at(-1)).toEqual([]);
    const c = setup(idb);
    expect(await c.store.list()).toEqual([]);
  });

  it('keeps drafts', async () => {
    const { store } = setup(fakeIndexedDb());
    await store.saveDraft('new', { name: 'x' });
    expect(await store.loadDraft('new')).toEqual({ name: 'x' });
    await store.deleteDraft('new');
    expect(await store.loadDraft('new')).toBeUndefined();
  });

  it('works for the session when IndexedDB is unavailable', async () => {
    const { store, published } = setup(null);
    await store.init();
    expect(store.persistent()).toBe(false);
    await store.save(def(), [image()]);
    expect(published.at(-1)?.length).toBe(1);
    expect((await store.list()).length).toBe(1);
  });

  it('falls back when opening IndexedDB throws', async () => {
    const broken = {
      open() {
        throw new DOMException('denied', 'SecurityError');
      },
    } as unknown as IDBFactory;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { store } = setup(broken);
    await store.save(def(), [image()]);
    expect(store.persistent()).toBe(false);
    expect(store.get('Test-Stick')).toBeTruthy();
    warn.mockRestore();
  });

  it('rejects invalid definitions and missing images', async () => {
    const { store } = setup(null);
    await expect(store.save({ ...def(), id: 'bad id' }, [image()])).rejects.toThrow(/not valid/);
    await expect(store.save(def(), [])).rejects.toThrow(/image/);
  });

  it('exports and imports a .zip', async () => {
    const { store } = setup(null);
    await store.save(def('Zip-Me'), [image()]);
    const zip = await store.exportZip('Zip-Me');
    const files = Object.keys((await JSZip.loadAsync(await zip.arrayBuffer())).files);
    expect(files).toContain('devices/Zip-Me/device.json');
    expect(files).toContain('devices/Zip-Me/Zip-Me.webp');
    expect(files).toContain('buttonmaps/12345678.buttonMap');

    await store.delete('Zip-Me');
    const imported = await store.importZip(zip);
    expect(imported.id).toBe('Zip-Me');
    expect(imported.images[0].size).toBe(3);
    expect(store.get('Zip-Me')?.definition.controls[0].label).toBe('Trigger');
  });
});
