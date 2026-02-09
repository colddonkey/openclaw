import { Container, Spacer, Text } from "@mariozechner/pi-tui";
import chalk from "chalk";
import figlet from "figlet";
import { palette } from "../theme/theme.js";

// ---------------------------------------------------------------------------
// Pixel-art donkey mascot (half-block rendering, 24x16 pixel grid).
// Each char in the grid maps to a color. "." = transparent.
// Pairs of rows render as one terminal line via half-blocks.
// Inspired by Gemini-generated pixel art donkey.
// ---------------------------------------------------------------------------
const DONKEY_COLORS: Record<string, string> = {
  B: "#8B7355", // brown body
  L: "#C4A882", // light (inner ears, belly)
  M: "#D4C4A8", // muzzle
  W: "#E8E8E8", // eye whites
  P: "#2A2A2A", // pupils
  G: "#5CB85C", // green collar
  F: "#333333", // sunglasses frame (dark)
  T: "#2C3E50", // tinted lens (dark blue-gray)
};

// Max words to render in the banner (each word = 6 figlet lines).
const MAX_BANNER_WORDS = 3;
// Animation interval in milliseconds.
const ANIM_INTERVAL_MS = 900;

// Donkey with sunglasses, waving arm, curled tail.
// 24 rows x 16 cols = 12 terminal lines.
// Previous versions in git: plain (161fdccfe), first glasses (cb85db437).
const DONKEY_PIXELS = [
  "....BB......BB..",
  "...BBLB....BLBB.",
  "...BLLB....BLLB.",
  "...BLLB....BLLB.",
  "...BBLB....BLBB.",
  "....BBBBBBBBBB..",
  "..FBFFFFBFFFFBBF",
  "..FBFTTFFFTTFBBF",
  "..FBFFFFBFFFFBBF",
  "...BMMMMMMMMMMB.",
  "...BM...MM...MB.",
  "...BMMMMMMMMMMB.",
  "....BBGGGGGGBB..",
  "....BBLLLLLLBB..",
  "...BBBLLLLLLBBB.",
  "..BB..LLLLLL.BB.",
  "..B...LLLLLL..B.",
  "......BLLLLB..B.",
  ".....BBBBBBB..B.",
  ".....BB...BB..B.",
  ".....BB...BB.B..",
  ".....BB...BB....",
  "................",
  "................",
];

// Alternate frame: tail swings down, arm expands. Only changed rows.
const DONKEY_ALT_ROWS: Record<number, string> = {
  16: "......LLLLLL.BB.",
  17: "......BLLLLB....",
  18: ".....BBBBBBB....",
  19: ".....BB...BB..B.",
  20: ".....BB...BB...B",
};

function buildAltPixels(): string[] {
  return DONKEY_PIXELS.map((row, i) => DONKEY_ALT_ROWS[i] ?? row);
}

// Generic half-block pixel art renderer for any grid + color map.
function renderPixelArt(
  pixels: string[],
  colors: Record<string, string>,
): string[] {
  const lines: string[] = [];
  for (let y = 0; y < pixels.length; y += 2) {
    const topRow = pixels[y] ?? "";
    const botRow = pixels[y + 1] ?? "";
    const width = Math.max(topRow.length, botRow.length);
    let line = "";
    for (let x = 0; x < width; x++) {
      const tc = topRow[x] ?? ".";
      const bc = botRow[x] ?? ".";
      const topClr = tc !== "." ? (colors[tc] ?? null) : null;
      const botClr = bc !== "." ? (colors[bc] ?? null) : null;
      if (!topClr && !botClr) {
        line += " ";
      } else if (topClr && botClr && topClr === botClr) {
        line += chalk.hex(topClr)("\u2588");
      } else if (topClr && !botClr) {
        line += chalk.hex(topClr)("\u2580");
      } else if (!topClr && botClr) {
        line += chalk.hex(botClr)("\u2584");
      } else {
        line += chalk.hex(topClr!).bgHex(botClr!)("\u2580");
      }
    }
    lines.push(line);
  }
  return lines;
}

function padRight(str: string, targetLen: number): string {
  if (str.length >= targetLen) return str;
  return str + " ".repeat(targetLen - str.length);
}

/**
 * Render banner text using ANSI Shadow figlet font.
 * Each word becomes a separate figlet block (6 lines each).
 * Returns an array of plain-text lines.
 */
function renderBannerText(text: string): string[] {
  const words = text
    .split(/[\n\r]+|\s+/)
    .filter(Boolean)
    .slice(0, MAX_BANNER_WORDS);
  if (words.length === 0) return [];
  const allLines: string[] = [];
  for (const word of words) {
    const rendered = figlet.textSync(word, { font: "ANSI Shadow" });
    allLines.push(...rendered.split("\n"));
  }
  return allLines;
}

const SHORTCUTS = [
  "/help  commands        /theme  colors        Ctrl+C x2  exit",
  "/model change model    /agent  switch agent  Ctrl+O     tools",
];

export class SplashComponent extends Container {
  private _animTimer: ReturnType<typeof setInterval> | null = null;

  constructor(bannerText = "COLD\nDONKEY", requestRender?: () => void) {
    super();
    this.addChild(new Spacer(1));

    const dimFn = (t: string) => chalk.hex(palette.dim)(t);

    // Color figlet text to match the donkey mascot palette.
    const brownFn = chalk.hex(DONKEY_COLORS.B);
    const tanFn = chalk.hex(DONKEY_COLORS.L);
    const colorLogoChar = (ch: string): string => {
      if (ch === " ") return ch;
      const code = ch.charCodeAt(0);
      if (code >= 0x2550 && code <= 0x256c) return tanFn(ch);
      return brownFn(ch);
    };
    const colorLogoLine = (line: string): string =>
      [...line].map(colorLogoChar).join("");

    const gap = "   ";

    // Pre-render both animation frames.
    const frame0 = renderPixelArt(DONKEY_PIXELS, DONKEY_COLORS);
    const frame1 = renderPixelArt(buildAltPixels(), DONKEY_COLORS);

    // Render the banner text with figlet.
    const logoLines = renderBannerText(bannerText);
    const maxWidth = logoLines.reduce((max, l) => Math.max(max, l.length), 0);

    // Vertically center the text when it's shorter than the donkey mascot.
    const totalLines = Math.max(logoLines.length, frame0.length);
    const textOffset = Math.max(0, Math.floor((totalLines - logoLines.length) / 2));

    // Pre-build the logo portion (doesn't change between frames).
    const logoParts: string[] = [];
    for (let i = 0; i < totalLines; i++) {
      const textIdx = i - textOffset;
      const rawText = textIdx >= 0 && textIdx < logoLines.length ? logoLines[textIdx]! : "";
      logoParts.push(colorLogoLine(padRight(rawText, maxWidth)));
    }

    // Build full lines for both frames and find which lines differ.
    const fullFrame0: string[] = [];
    const fullFrame1: string[] = [];
    const animatedIndices: number[] = [];
    for (let i = 0; i < totalLines; i++) {
      const logo = logoParts[i]!;
      const line0 = logo + gap + (frame0[i] ?? "");
      const line1 = logo + gap + (frame1[i] ?? "");
      fullFrame0.push(line0);
      fullFrame1.push(line1);
      if (line0 !== line1) animatedIndices.push(i);
    }

    // Create Text components and store refs for animated lines.
    const textRefs: Text[] = [];
    for (let i = 0; i < totalLines; i++) {
      const t = new Text(fullFrame0[i]!, 3, 0);
      textRefs.push(t);
      this.addChild(t);
    }

    this.addChild(new Spacer(1));

    for (const line of SHORTCUTS) {
      this.addChild(new Text(dimFn(line), 4, 0));
    }

    this.addChild(new Spacer(1));

    // Subtle idle animation: alternate frames on a slow timer.
    if (requestRender && animatedIndices.length > 0) {
      let currentFrame = 0;
      this._animTimer = setInterval(() => {
        currentFrame = currentFrame === 0 ? 1 : 0;
        const frame = currentFrame === 0 ? fullFrame0 : fullFrame1;
        for (const idx of animatedIndices) {
          textRefs[idx]!.setText(frame[idx]!);
        }
        requestRender();
      }, ANIM_INTERVAL_MS);
    }
  }

  /** Stop the animation timer. Call before removing the component. */
  dispose(): void {
    if (this._animTimer) {
      clearInterval(this._animTimer);
      this._animTimer = null;
    }
  }
}
