import type {
  EditorTheme,
  MarkdownTheme,
  SelectListTheme,
  SettingsListTheme,
} from "@mariozechner/pi-tui";
import chalk from "chalk";
import { highlight, supportsLanguage } from "cli-highlight";
import type { SearchableSelectListTheme } from "../components/searchable-select-list.js";
import { createSyntaxTheme } from "./syntax-theme.js";

// ---------------------------------------------------------------------------
// Palette – mutable so `/theme` can swap presets at runtime.
// All theme functions read from `palette` lazily (not captured at init).
// ---------------------------------------------------------------------------

export type ThemePalette = {
  text: string;
  dim: string;
  accent: string;
  accentSoft: string;
  border: string;
  userBg: string;
  userText: string;
  systemText: string;
  toolPendingBg: string;
  toolSuccessBg: string;
  toolErrorBg: string;
  toolTitle: string;
  toolOutput: string;
  quote: string;
  quoteBorder: string;
  code: string;
  codeBlock: string;
  codeBorder: string;
  link: string;
  error: string;
  success: string;
};

const DEFAULT_PALETTE: Readonly<ThemePalette> = {
  text: "#E8E3D5",
  dim: "#7B7F87",
  accent: "#F6C453",
  accentSoft: "#F2A65A",
  border: "#3C414B",
  userBg: "#2B2F36",
  userText: "#F3EEE0",
  systemText: "#9BA3B2",
  toolPendingBg: "#1F2A2F",
  toolSuccessBg: "#1E2D23",
  toolErrorBg: "#2F1F1F",
  toolTitle: "#F6C453",
  toolOutput: "#E1DACB",
  quote: "#8CC8FF",
  quoteBorder: "#3B4D6B",
  code: "#F0C987",
  codeBlock: "#1E232A",
  codeBorder: "#343A45",
  link: "#7DD3A5",
  error: "#F97066",
  success: "#7DD3A5",
};

// Preset themes keyed by name. Each preset only overrides the fields it
// changes; the rest fall through from DEFAULT_PALETTE.
export const THEME_PRESETS: Record<string, Partial<ThemePalette> & { label: string }> = {
  default: { label: "Default" },
  midnight: {
    label: "Midnight Blue",
    accent: "#7AAFFF",
    accentSoft: "#5B8BD6",
    userBg: "#1A2236",
    userText: "#D0DFFF",
    border: "#2A3555",
    code: "#8CC8FF",
    codeBorder: "#2A3555",
    link: "#7AAFFF",
    toolTitle: "#7AAFFF",
    quote: "#A0C4FF",
    quoteBorder: "#2A3555",
  },
  forest: {
    label: "Forest",
    accent: "#8FBF7F",
    accentSoft: "#6DA05D",
    userBg: "#1C2B1E",
    userText: "#D6F0D0",
    border: "#2E4433",
    code: "#A8D89E",
    codeBorder: "#2E4433",
    link: "#8FBF7F",
    toolTitle: "#8FBF7F",
    toolSuccessBg: "#1A2E1A",
    quote: "#A8D89E",
    quoteBorder: "#2E4433",
  },
  warm: {
    label: "Warm Amber",
    accent: "#FFB347",
    accentSoft: "#E89530",
    userBg: "#332A1E",
    userText: "#FFE8C8",
    border: "#4A3D2E",
    code: "#FFD08A",
    codeBorder: "#4A3D2E",
    link: "#FFB347",
    toolTitle: "#FFB347",
    quote: "#FFD08A",
    quoteBorder: "#4A3D2E",
  },
  ocean: {
    label: "Ocean Teal",
    accent: "#4FD1C5",
    accentSoft: "#38B2AC",
    userBg: "#162B2B",
    userText: "#C6F6F0",
    border: "#264545",
    code: "#81E6D9",
    codeBorder: "#264545",
    link: "#4FD1C5",
    toolTitle: "#4FD1C5",
    toolPendingBg: "#142828",
    quote: "#81E6D9",
    quoteBorder: "#264545",
  },
  rose: {
    label: "Rose",
    accent: "#F5A0B0",
    accentSoft: "#E0788E",
    userBg: "#2E1E25",
    userText: "#FFE0E8",
    border: "#4A2E3A",
    code: "#F0B8C4",
    codeBorder: "#4A2E3A",
    link: "#F5A0B0",
    toolTitle: "#F5A0B0",
    quote: "#F0B8C4",
    quoteBorder: "#4A2E3A",
  },
};

/** Active palette – shallow-cloned so mutations don't affect the preset objects. */
export const palette: ThemePalette = { ...DEFAULT_PALETTE };

/** Current preset name. */
let currentPresetName = "default";

/** Apply a preset by name and return true, or false if the name is unknown. */
export function applyThemePreset(name: string): boolean {
  const preset = THEME_PRESETS[name];
  if (!preset) {
    return false;
  }
  Object.assign(palette, DEFAULT_PALETTE, preset);
  currentPresetName = name;
  return true;
}

/** Return the name of the currently active preset. */
export function currentThemeName(): string {
  return currentPresetName;
}

/** List available preset names. */
export function listThemePresets(): string[] {
  return Object.keys(THEME_PRESETS);
}

// ---------------------------------------------------------------------------
// Helpers – call chalk lazily so palette mutations take effect immediately.
// ---------------------------------------------------------------------------

const fg = (key: keyof ThemePalette) => (text: string) => chalk.hex(palette[key])(text);
const bg = (key: keyof ThemePalette) => (text: string) => chalk.bgHex(palette[key])(text);

// For code highlighting we need a fresh syntax theme each call
// (the underling createSyntaxTheme is cheap – just an object literal).
function lazySyntaxTheme() {
  return createSyntaxTheme((text: string) => chalk.hex(palette.code)(text));
}

/**
 * Highlight code with syntax coloring.
 * Returns an array of lines with ANSI escape codes.
 */
function highlightCode(code: string, lang?: string): string[] {
  try {
    const language = lang && supportsLanguage(lang) ? lang : undefined;
    const highlighted = highlight(code, {
      language,
      theme: lazySyntaxTheme(),
      ignoreIllegals: true,
    });
    return highlighted.split("\n");
  } catch {
    return code.split("\n").map((line) => chalk.hex(palette.code)(line));
  }
}

// ---------------------------------------------------------------------------
// Exported theme – every function reads `palette` at call time.
// ---------------------------------------------------------------------------

export const theme = {
  fg: fg("text"),
  dim: fg("dim"),
  accent: fg("accent"),
  accentSoft: fg("accentSoft"),
  success: fg("success"),
  error: fg("error"),
  header: (text: string) => chalk.bold(chalk.hex(palette.accent)(text)),
  system: fg("systemText"),
  userBg: bg("userBg"),
  userText: fg("userText"),
  toolTitle: fg("toolTitle"),
  toolOutput: fg("toolOutput"),
  toolPendingBg: bg("toolPendingBg"),
  toolSuccessBg: bg("toolSuccessBg"),
  toolErrorBg: bg("toolErrorBg"),
  border: fg("border"),
  bold: (text: string) => chalk.bold(text),
  italic: (text: string) => chalk.italic(text),
};

export const markdownTheme: MarkdownTheme = {
  heading: (text) => chalk.bold(chalk.hex(palette.accent)(text)),
  link: (text) => chalk.hex(palette.link)(text),
  linkUrl: (text) => chalk.dim(text),
  code: (text) => chalk.hex(palette.code)(text),
  codeBlock: (text) => chalk.hex(palette.code)(text),
  codeBlockBorder: (text) => chalk.hex(palette.codeBorder)(text),
  quote: (text) => chalk.hex(palette.quote)(text),
  quoteBorder: (text) => chalk.hex(palette.quoteBorder)(text),
  hr: (text) => chalk.hex(palette.border)(text),
  listBullet: (text) => chalk.hex(palette.accentSoft)(text),
  bold: (text) => chalk.bold(text),
  italic: (text) => chalk.italic(text),
  strikethrough: (text) => chalk.strikethrough(text),
  underline: (text) => chalk.underline(text),
  highlightCode,
};

export const selectListTheme: SelectListTheme = {
  selectedPrefix: (text) => chalk.hex(palette.accent)(text),
  selectedText: (text) => chalk.bold(chalk.hex(palette.accent)(text)),
  description: (text) => chalk.hex(palette.dim)(text),
  scrollInfo: (text) => chalk.hex(palette.dim)(text),
  noMatch: (text) => chalk.hex(palette.dim)(text),
};

export const filterableSelectListTheme = {
  ...selectListTheme,
  filterLabel: (text: string) => chalk.hex(palette.dim)(text),
};

export const settingsListTheme: SettingsListTheme = {
  label: (text, selected) =>
    selected ? chalk.bold(chalk.hex(palette.accent)(text)) : chalk.hex(palette.text)(text),
  value: (text, selected) =>
    selected ? chalk.hex(palette.accentSoft)(text) : chalk.hex(palette.dim)(text),
  description: (text) => chalk.hex(palette.systemText)(text),
  cursor: chalk.hex(palette.accent)("→ "),
  hint: (text) => chalk.hex(palette.dim)(text),
};

export const editorTheme: EditorTheme = {
  borderColor: (text) => chalk.hex(palette.border)(text),
  selectList: selectListTheme,
};

export const searchableSelectListTheme: SearchableSelectListTheme = {
  selectedPrefix: (text) => chalk.hex(palette.accent)(text),
  selectedText: (text) => chalk.bold(chalk.hex(palette.accent)(text)),
  description: (text) => chalk.hex(palette.dim)(text),
  scrollInfo: (text) => chalk.hex(palette.dim)(text),
  noMatch: (text) => chalk.hex(palette.dim)(text),
  searchPrompt: (text) => chalk.hex(palette.accentSoft)(text),
  searchInput: (text) => chalk.hex(palette.text)(text),
  matchHighlight: (text) => chalk.bold(chalk.hex(palette.accent)(text)),
};
