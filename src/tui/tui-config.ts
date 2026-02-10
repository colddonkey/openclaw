import type { OpenClawConfig, TuiConfig } from "../config/types.js";
import { readConfigFileSnapshot, writeConfigFile } from "../config/io.js";
import { applyThemePreset } from "./theme/theme.js";

/**
 * Extract TUI preferences from the loaded config.
 * Returns a normalized TuiConfig with defaults filled in.
 */
export function readTuiPrefs(config: OpenClawConfig): Required<TuiConfig> {
  const tui = config.tui ?? {};
  return {
    theme: tui.theme ?? "default",
    showTimestamps: tui.showTimestamps ?? false,
    compactMode: tui.compactMode ?? false,
    showThinking: tui.showThinking ?? false,
    toolsExpanded: tui.toolsExpanded ?? false,
    bannerText: tui.bannerText ?? "ANT",
  };
}

/**
 * Apply stored TUI preferences: set the theme preset, return the prefs.
 */
export function applyTuiPrefs(config: OpenClawConfig): Required<TuiConfig> {
  const prefs = readTuiPrefs(config);
  if (prefs.theme !== "default") {
    applyThemePreset(prefs.theme);
  }
  return prefs;
}

/**
 * Persist a partial set of TUI preferences to the config file.
 * Merges with existing tui config; only overwrites provided keys.
 * Fire-and-forget: errors are silently ignored (TUI should not crash
 * because config save failed).
 */
export function saveTuiPrefs(patch: Partial<TuiConfig>): void {
  void (async () => {
    try {
      const snapshot = await readConfigFileSnapshot();
      const cfg = snapshot.config as OpenClawConfig & Record<string, unknown>;
      cfg.tui = { ...cfg.tui, ...patch };
      await writeConfigFile(cfg);
    } catch {
      // Best-effort. Config save failure should never interrupt the TUI.
    }
  })();
}
