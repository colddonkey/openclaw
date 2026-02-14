/**
 * Lightweight TUI preferences persistence.
 * Stored at ~/.openclaw/tui-prefs.json, separate from the main config.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface TuiPrefs {
  theme?: string;
  bannerText?: string;
}

const PREFS_DIR = path.join(os.homedir(), ".openclaw");
const PREFS_FILE = path.join(PREFS_DIR, "tui-prefs.json");

/** Read TUI preferences from disk. Returns empty object on any failure. */
export function loadTuiPrefs(): TuiPrefs {
  try {
    if (!fs.existsSync(PREFS_FILE)) return {};
    const raw = fs.readFileSync(PREFS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return {
      theme: typeof parsed.theme === "string" ? parsed.theme : undefined,
      bannerText: typeof parsed.bannerText === "string" ? parsed.bannerText : undefined,
    };
  } catch {
    return {};
  }
}

/** Write TUI preferences to disk. Merges with existing prefs. */
export function saveTuiPrefs(updates: Partial<TuiPrefs>): void {
  try {
    const current = loadTuiPrefs();
    const merged = { ...current, ...updates };
    // Remove undefined keys.
    for (const key of Object.keys(merged) as (keyof TuiPrefs)[]) {
      if (merged[key] === undefined) delete merged[key];
    }
    if (!fs.existsSync(PREFS_DIR)) {
      fs.mkdirSync(PREFS_DIR, { recursive: true });
    }
    fs.writeFileSync(PREFS_FILE, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  } catch {
    // Non-fatal: preference saving is best-effort.
  }
}
