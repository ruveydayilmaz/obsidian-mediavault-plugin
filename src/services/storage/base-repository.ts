import { MediaVaultId } from "../../types/common";
import { StorageAdapter } from "./storage-adapter";
import { VaultData } from "./schema";

interface HasId {
  id: MediaVaultId;
}

export function generateId(): MediaVaultId {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export abstract class BaseRepository<T extends HasId> {
  protected adapter: StorageAdapter;
  private collectionKey: keyof VaultData;

  onMutated?: (record: T) => void;

  private version = 0;
  private idIndexVersion = -1;
  private idIndex: Map<MediaVaultId, T> = new Map();

  constructor(adapter: StorageAdapter, collectionKey: keyof VaultData) {
    this.adapter = adapter;
    this.collectionKey = collectionKey;
  }

  protected getCollection(): T[] {
    return this.adapter.getData()[this.collectionKey] as unknown as T[];
  }

  invalidate(): void {
    this.version++;
  }

  getVersion(): number {
    return this.version;
  }

  private ensureIdIndex(): Map<MediaVaultId, T> {
    if (this.idIndexVersion !== this.version) {
      this.idIndex = new Map(
        this.getCollection().map((item) => [item.id, item]),
      );
      this.idIndexVersion = this.version;
    }
    return this.idIndex;
  }

  protected buildIndex<K>(
    keyFn: (item: T) => K,
    cache: { version: number; map: Map<K, T[]> },
  ): Map<K, T[]> {
    if (cache.version !== this.version) {
      const map = new Map<K, T[]>();
      for (const item of this.getCollection()) {
        const key = keyFn(item);
        const bucket = map.get(key);
        if (bucket) bucket.push(item);
        else map.set(key, [item]);
      }
      cache.map = map;
      cache.version = this.version;
    }
    return cache.map;
  }

  async getAll(): Promise<T[]> {
    return [...this.getCollection()];
  }

  async findById(id: MediaVaultId): Promise<T | null> {
    return this.ensureIdIndex().get(id) ?? null;
  }

  async findWhere(predicate: (item: T) => boolean): Promise<T[]> {
    return this.getCollection().filter(predicate);
  }

  async save(record: T): Promise<T> {
    this.getCollection().push(record);
    this.version++;

    void this.adapter.requestSave();
    this.onMutated?.(record);
    return record;
  }

  async upsertRaw(record: T): Promise<boolean> {
    const collection = this.getCollection();
    const index = collection.findIndex((item) => item.id === record.id);
    if (index === -1) {
      collection.push(record);
    } else {
      if (JSON.stringify(collection[index]) === JSON.stringify(record)) {
        return false;
      }
      collection[index] = record;
    }
    this.version++;
    void this.adapter.requestSave();
    this.onMutated?.(record);
    return true;
  }

  async update(id: MediaVaultId, patch: Partial<T>): Promise<T | null> {
    const collection = this.getCollection();
    const index = collection.findIndex((item) => item.id === id);
    if (index === -1) return null;

    const updated = { ...collection[index], ...patch, id };
    collection[index] = updated;
    this.version++;
    void this.adapter.requestSave();
    this.onMutated?.(updated);
    return updated;
  }

  async delete(id: MediaVaultId): Promise<boolean> {
    const collection = this.getCollection();
    const index = collection.findIndex((item) => item.id === id);
    if (index === -1) return false;

    const [removed] = collection.splice(index, 1);
    this.version++;
    void this.adapter.requestSave();
    this.onMutated?.(removed);
    return true;
  }

  async count(): Promise<number> {
    return this.getCollection().length;
  }
}
