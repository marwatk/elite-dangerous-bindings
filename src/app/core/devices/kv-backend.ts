/**
 * Tiny key/value persistence used by the local device store: IndexedDB when
 * available, otherwise an in-memory map (private windows, blocked storage).
 */

export type StoreName = 'devices' | 'drafts';
const STORES: StoreName[] = ['devices', 'drafts'];

export interface KvBackend {
  readonly persistent: boolean;
  getAll<T>(store: StoreName): Promise<T[]>;
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
}

export class MemoryBackend implements KvBackend {
  readonly persistent = false;
  private readonly data = new Map<StoreName, Map<string, unknown>>(STORES.map((s) => [s, new Map()]));

  async getAll<T>(store: StoreName): Promise<T[]> {
    return [...this.data.get(store)!.values()] as T[];
  }
  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return this.data.get(store)!.get(key) as T | undefined;
  }
  async put(store: StoreName, key: string, value: unknown): Promise<void> {
    this.data.get(store)!.set(key, value);
  }
  async delete(store: StoreName, key: string): Promise<void> {
    this.data.get(store)!.delete(key);
  }
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export class IdbBackend implements KvBackend {
  readonly persistent = true;

  private constructor(private readonly db: IDBDatabase) {}

  /** Open (and create/upgrade) the database. Rejects if IndexedDB is unusable or too slow. */
  static open(factory: IDBFactory, name = 'edb-devices', timeoutMs = 3000): Promise<IdbBackend> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('IndexedDB did not open in time')), timeoutMs);
      let req: IDBOpenDBRequest;
      try {
        req = factory.open(name, 1);
      } catch (e) {
        clearTimeout(timer);
        reject(e);
        return;
      }
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        resolve(new IdbBackend(req.result));
      };
      req.onerror = () => {
        clearTimeout(timer);
        reject(req.error ?? new Error('IndexedDB open failed'));
      };
      req.onblocked = () => {
        clearTimeout(timer);
        reject(new Error('IndexedDB is blocked by another tab'));
      };
    });
  }

  private store(name: StoreName, mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(name, mode).objectStore(name);
  }

  getAll<T>(store: StoreName): Promise<T[]> {
    return promisify(this.store(store, 'readonly').getAll()) as Promise<T[]>;
  }
  get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return promisify(this.store(store, 'readonly').get(key)) as Promise<T | undefined>;
  }
  async put(store: StoreName, key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    await txDone(tx);
  }
  async delete(store: StoreName, key: string): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await txDone(tx);
  }
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted (storage full?)'));
  });
}
