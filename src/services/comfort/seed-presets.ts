import type { StorageService } from "../storage";
import { BUILT_IN_COMFORT_PRESETS } from "../storage/comfort-repository";

export async function seedBuiltInPresets(
  storage: StorageService,
): Promise<number> {
  const existing = await storage.comfortPresets.getAll();
  const existingNames = new Set(existing.map((p) => p.name));

  let created = 0;
  for (const preset of BUILT_IN_COMFORT_PRESETS) {
    if (existingNames.has(preset.name)) continue;
    await storage.comfortPresets.create(preset);
    created++;
  }
  return created;
}
