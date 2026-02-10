// Lazy-load pi-coding-agent model metadata so we can infer context windows when
// the agent reports a model id. This includes custom models.json entries.

import { loadConfig } from "../config/config.js";
import { resolveOpenClawAgentDir } from "./agent-paths.js";
import { ensureOpenClawModelsJson } from "./models-config.js";

type ModelEntry = { id: string; provider?: string; contextWindow?: number };

const MODEL_CACHE = new Map<string, number>();
const loadPromise = (async () => {
  try {
    const { discoverAuthStorage, discoverModels } = await import("./pi-model-discovery.js");
    const cfg = loadConfig();
    await ensureOpenClawModelsJson(cfg);
    const agentDir = resolveOpenClawAgentDir();
    const authStorage = discoverAuthStorage(agentDir);
    const modelRegistry = discoverModels(authStorage, agentDir);
    const models = modelRegistry.getAll() as ModelEntry[];
    for (const m of models) {
      if (!m?.id) {
        continue;
      }
      if (typeof m.contextWindow === "number" && m.contextWindow > 0) {
        MODEL_CACHE.set(m.id, m.contextWindow);
        // Also store with provider prefix for "provider/model" lookups.
        if (m.provider) {
          MODEL_CACHE.set(`${m.provider}/${m.id}`, m.contextWindow);
        }
      }
    }
  } catch {
    // If pi-ai isn't available, leave cache empty; lookup will fall back.
  }

  // Secondary: try the full model catalog which may include more models
  // (e.g. built-in provider models that weren't in models.json).
  try {
    const { loadModelCatalog } = await import("./model-catalog.js");
    const catalog = await loadModelCatalog({ useCache: true });
    for (const entry of catalog) {
      if (!entry?.id || !entry.contextWindow || entry.contextWindow <= 0) {
        continue;
      }
      // Only add if not already in cache (pi-model-discovery takes priority).
      if (!MODEL_CACHE.has(entry.id)) {
        MODEL_CACHE.set(entry.id, entry.contextWindow);
      }
      const prefixed = `${entry.provider}/${entry.id}`;
      if (!MODEL_CACHE.has(prefixed)) {
        MODEL_CACHE.set(prefixed, entry.contextWindow);
      }
    }
  } catch {
    // Model catalog unavailable; best-effort.
  }
})();

export function lookupContextTokens(modelId?: string): number | undefined {
  if (!modelId) {
    return undefined;
  }
  // Best-effort: kick off loading, but don't block.
  void loadPromise;

  // Exact match first (e.g. "gemini-3-flash-preview" or "google/gemini-3-flash-preview").
  const exact = MODEL_CACHE.get(modelId);
  if (exact !== undefined) return exact;

  // Try without provider prefix (e.g. "google/gemini-3-flash-preview" -> "gemini-3-flash-preview").
  const slash = modelId.indexOf("/");
  if (slash >= 0) {
    return MODEL_CACHE.get(modelId.slice(slash + 1));
  }
  return undefined;
}
