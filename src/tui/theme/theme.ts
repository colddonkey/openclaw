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
// Palette type + presets
// ---------------------------------------------------------------------------

export interface ThemePalette {
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
}

/** Built-in theme presets. */
export const THEME_PRESETS: Record<string, ThemePalette> = {
  default: {
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
  },
  ant: {
    text: "#F0E6D3",
    dim: "#8B7F6E",
    accent: "#DD3333",
    accentSoft: "#E85D5D",
    border: "#4A3030",
    userBg: "#2A1F1F",
    userText: "#F5ECE0",
    systemText: "#B89A8A",
    toolPendingBg: "#1F1A2A",
    toolSuccessBg: "#1E2D1E",
    toolErrorBg: "#3A1A1A",
    toolTitle: "#DD3333",
    toolOutput: "#E8D8C8",
    quote: "#E88A5A",
    quoteBorder: "#5A3A2A",
    code: "#F0A060",
    codeBlock: "#1A1515",
    codeBorder: "#4A3535",
    link: "#E8A060",
    error: "#FF4444",
    success: "#66BB6A",
  },
  ocean: {
    text: "#D4E8F0",
    dim: "#6A8899",
    accent: "#00BCD4",
    accentSoft: "#4DD0E1",
    border: "#2A4050",
    userBg: "#1A2A35",
    userText: "#E0F0F8",
    systemText: "#8AB0C0",
    toolPendingBg: "#152530",
    toolSuccessBg: "#153025",
    toolErrorBg: "#2A1520",
    toolTitle: "#00BCD4",
    toolOutput: "#C0D8E5",
    quote: "#80DEEA",
    quoteBorder: "#2A5565",
    code: "#80CBC4",
    codeBlock: "#0F1A22",
    codeBorder: "#2A4555",
    link: "#4FC3F7",
    error: "#EF5350",
    success: "#66BB6A",
  },
  forest: {
    text: "#D8E8D0",
    dim: "#7A9A70",
    accent: "#8BC34A",
    accentSoft: "#AED581",
    border: "#3A4A30",
    userBg: "#1E2A1A",
    userText: "#E5F0DD",
    systemText: "#90A888",
    toolPendingBg: "#1A2518",
    toolSuccessBg: "#1A3018",
    toolErrorBg: "#2A1A18",
    toolTitle: "#8BC34A",
    toolOutput: "#C8D8B8",
    quote: "#A5D6A7",
    quoteBorder: "#3A5A3A",
    code: "#C5E1A5",
    codeBlock: "#141A10",
    codeBorder: "#3A4A30",
    link: "#81C784",
    error: "#EF5350",
    success: "#66BB6A",
  },
  neon: {
    text: "#E0E0F0",
    dim: "#7070A0",
    accent: "#FF00FF",
    accentSoft: "#DA70D6",
    border: "#402060",
    userBg: "#1A0A2A",
    userText: "#F0E0FF",
    systemText: "#9080C0",
    toolPendingBg: "#150A25",
    toolSuccessBg: "#0A2518",
    toolErrorBg: "#2A0A18",
    toolTitle: "#FF00FF",
    toolOutput: "#D0C0E8",
    quote: "#BB86FC",
    quoteBorder: "#4A2080",
    code: "#CF94DA",
    codeBlock: "#100818",
    codeBorder: "#3A2050",
    link: "#03DAC5",
    error: "#CF6679",
    success: "#03DAC5",
  },
};

// ---------------------------------------------------------------------------
// Active palette (mutable for runtime switching via ESM live bindings)
// ---------------------------------------------------------------------------

let currentThemeName = "default";
let activePalette: ThemePalette = { ...THEME_PRESETS.default! };

const fg = (hex: string) => (text: string) => chalk.hex(hex)(text);
const bg = (hex: string) => (text: string) => chalk.bgHex(hex)(text);

// ---------------------------------------------------------------------------
// Theme builders
// ---------------------------------------------------------------------------

function buildTheme(p: ThemePalette) {
  return {
    fg: fg(p.text),
    dim: fg(p.dim),
    accent: fg(p.accent),
    accentSoft: fg(p.accentSoft),
    success: fg(p.success),
    error: fg(p.error),
    header: (text: string) => chalk.bold(fg(p.accent)(text)),
    system: fg(p.systemText),
    userBg: bg(p.userBg),
    userText: fg(p.userText),
    toolTitle: fg(p.toolTitle),
    toolOutput: fg(p.toolOutput),
    toolPendingBg: bg(p.toolPendingBg),
    toolSuccessBg: bg(p.toolSuccessBg),
    toolErrorBg: bg(p.toolErrorBg),
    border: fg(p.border),
    bold: (text: string) => chalk.bold(text),
    italic: (text: string) => chalk.italic(text),
  };
}

function buildHighlightCode(p: ThemePalette) {
  const syntaxThm = createSyntaxTheme(fg(p.code));
  return function highlightCode(code: string, lang?: string): string[] {
    try {
      const language = lang && supportsLanguage(lang) ? lang : undefined;
      const highlighted = highlight(code, {
        language,
        theme: syntaxThm,
        ignoreIllegals: true,
      });
      return highlighted.split("\n");
    } catch {
      return code.split("\n").map((line) => fg(p.code)(line));
    }
  };
}

function buildMarkdownTheme(p: ThemePalette): MarkdownTheme {
  return {
    heading: (text) => chalk.bold(fg(p.accent)(text)),
    link: (text) => fg(p.link)(text),
    linkUrl: (text) => chalk.dim(text),
    code: (text) => fg(p.code)(text),
    codeBlock: (text) => fg(p.code)(text),
    codeBlockBorder: (text) => fg(p.codeBorder)(text),
    quote: (text) => fg(p.quote)(text),
    quoteBorder: (text) => fg(p.quoteBorder)(text),
    hr: (text) => fg(p.border)(text),
    listBullet: (text) => fg(p.accentSoft)(text),
    bold: (text) => chalk.bold(text),
    italic: (text) => chalk.italic(text),
    strikethrough: (text) => chalk.strikethrough(text),
    underline: (text) => chalk.underline(text),
    highlightCode: buildHighlightCode(p),
  };
}

function buildSelectListTheme(p: ThemePalette): SelectListTheme {
  return {
    selectedPrefix: (text) => fg(p.accent)(text),
    selectedText: (text) => chalk.bold(fg(p.accent)(text)),
    description: (text) => fg(p.dim)(text),
    scrollInfo: (text) => fg(p.dim)(text),
    noMatch: (text) => fg(p.dim)(text),
  };
}

function buildFilterableSelectListTheme(p: ThemePalette) {
  return {
    ...buildSelectListTheme(p),
    filterLabel: (text: string) => fg(p.dim)(text),
  };
}

function buildSettingsListTheme(p: ThemePalette): SettingsListTheme {
  return {
    label: (text, selected) =>
      selected ? chalk.bold(fg(p.accent)(text)) : fg(p.text)(text),
    value: (text, selected) => (selected ? fg(p.accentSoft)(text) : fg(p.dim)(text)),
    description: (text) => fg(p.systemText)(text),
    cursor: fg(p.accent)("\u2192 "),
    hint: (text) => fg(p.dim)(text),
  };
}

function buildEditorTheme(p: ThemePalette): EditorTheme {
  return {
    borderColor: (text) => fg(p.border)(text),
    selectList: buildSelectListTheme(p),
  };
}

function buildSearchableSelectListTheme(p: ThemePalette): SearchableSelectListTheme {
  return {
    selectedPrefix: (text) => fg(p.accent)(text),
    selectedText: (text) => chalk.bold(fg(p.accent)(text)),
    description: (text) => fg(p.dim)(text),
    scrollInfo: (text) => fg(p.dim)(text),
    noMatch: (text) => fg(p.dim)(text),
    searchPrompt: (text) => fg(p.accentSoft)(text),
    searchInput: (text) => fg(p.text)(text),
    matchHighlight: (text) => chalk.bold(fg(p.accent)(text)),
  };
}

// ---------------------------------------------------------------------------
// Exports (ESM live bindings - reassigned on theme switch)
// ---------------------------------------------------------------------------

export let theme = buildTheme(activePalette);
export let markdownTheme: MarkdownTheme = buildMarkdownTheme(activePalette);
export let selectListTheme: SelectListTheme = buildSelectListTheme(activePalette);
export let filterableSelectListTheme = buildFilterableSelectListTheme(activePalette);
export let settingsListTheme: SettingsListTheme = buildSettingsListTheme(activePalette);
export let editorTheme: EditorTheme = buildEditorTheme(activePalette);
export let searchableSelectListTheme: SearchableSelectListTheme =
  buildSearchableSelectListTheme(activePalette);

// ---------------------------------------------------------------------------
// Runtime theme switching
// ---------------------------------------------------------------------------

/** Get the names of all available theme presets. */
export function getThemeNames(): string[] {
  return Object.keys(THEME_PRESETS);
}

/** Get the name of the currently active theme. */
export function getThemeName(): string {
  return currentThemeName;
}

/** Get the currently active palette (read-only copy). */
export function getActivePalette(): ThemePalette {
  return { ...activePalette };
}

/**
 * Switch to a named theme preset. Returns true if the theme was found and applied.
 * New TUI content will use the updated theme; existing rendered components keep their
 * original colors (standard TUI behavior).
 */
export function setTheme(name: string): boolean {
  const preset = THEME_PRESETS[name];
  if (!preset) return false;
  currentThemeName = name;
  activePalette = { ...preset };
  // Rebuild all exported theme objects (ESM live bindings propagate to importers).
  theme = buildTheme(activePalette);
  markdownTheme = buildMarkdownTheme(activePalette);
  selectListTheme = buildSelectListTheme(activePalette);
  filterableSelectListTheme = buildFilterableSelectListTheme(activePalette);
  settingsListTheme = buildSettingsListTheme(activePalette);
  editorTheme = buildEditorTheme(activePalette);
  searchableSelectListTheme = buildSearchableSelectListTheme(activePalette);
  return true;
}
