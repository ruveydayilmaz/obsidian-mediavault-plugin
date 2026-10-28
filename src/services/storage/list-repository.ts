import { BaseRepository, generateId } from "./base-repository";
import { StorageAdapter } from "./storage-adapter";
import { CustomList, NewCustomListInput } from "../../models/list";
import { MediaVaultId } from "../../types/common";

export class CustomListRepository extends BaseRepository<CustomList> {
  constructor(adapter: StorageAdapter) {
    super(adapter, "customLists");
  }

  async create(input: NewCustomListInput): Promise<CustomList> {
    const now = new Date().toISOString();
    return this.save({
      id: generateId(),
      description: null,
      mediaIds: [],
      sortMode: "recent",
      owner: null,
      isImported: false,
      importSource: null,
      createdAt: now,
      updatedAt: now,
      ...input,
    });
  }

  async update(
    id: MediaVaultId,
    patch: Partial<CustomList>,
  ): Promise<CustomList | null> {
    return super.update(id, {
      ...patch,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    });
  }

  async duplicate(id: MediaVaultId): Promise<CustomList | null> {
    const original = await this.findById(id);
    if (!original) return null;
    return this.create({
      title: `${original.title} (Copy)`,
      description: original.description,
      mediaIds: [...original.mediaIds],
      sortMode: original.sortMode,
    });
  }

  async addMedia(
    id: MediaVaultId,
    mediaId: MediaVaultId,
  ): Promise<CustomList | null> {
    const list = await this.findById(id);
    if (!list) return null;
    if (list.mediaIds.includes(mediaId)) return list;
    return this.update(id, { mediaIds: [...list.mediaIds, mediaId] });
  }

  async removeMedia(
    id: MediaVaultId,
    mediaId: MediaVaultId,
  ): Promise<CustomList | null> {
    const list = await this.findById(id);
    if (!list) return null;
    return this.update(id, {
      mediaIds: list.mediaIds.filter((m) => m !== mediaId),
    });
  }

  async reorder(
    id: MediaVaultId,
    orderedMediaIds: MediaVaultId[],
  ): Promise<CustomList | null> {
    const list = await this.findById(id);
    if (!list) return null;

    const current = new Set(list.mediaIds);
    const proposed = new Set(orderedMediaIds);
    const isValidPermutation =
      current.size === proposed.size &&
      [...current].every((mediaId) => proposed.has(mediaId));

    if (!isValidPermutation) return list;

    return this.update(id, { mediaIds: orderedMediaIds, sortMode: "manual" });
  }

  async removeMediaEverywhere(mediaId: MediaVaultId): Promise<number> {
    const all = await this.getAll();
    const affected = all.filter((list) => list.mediaIds.includes(mediaId));
    for (const list of affected) {
      await this.update(list.id, {
        mediaIds: list.mediaIds.filter((m) => m !== mediaId),
      });
    }
    return affected.length;
  }
}
