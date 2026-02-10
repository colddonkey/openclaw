import { Container, Spacer, Text } from "@mariozechner/pi-tui";
import chalk from "chalk";
import figlet from "figlet";
import { palette } from "../theme/theme.js";

// ---------------------------------------------------------------------------
// Pixel-art ant mascot (half-block rendering, 24x16 pixel grid).
// Each char in the grid maps to a color. "." = transparent.
// Pairs of rows render as one terminal line via half-blocks.
// Donkey mascot preserved in git at b6c52fe9a.
// ---------------------------------------------------------------------------
const MASCOT_COLORS: Record<string, string> = {
  B: "#CC3333", // red body
  D: "#8B0000", // dark red (segment accents)
  W: "#E8E8E8", // eye whites
  P: "#1A1A1A", // pupils
  M: "#DEB887", // mandibles (tan)
  L: "#8B4513", // legs (brown)
};

// Text coloring (matches ant red theme).
const TEXT_PRIMARY = "#CC3333";
const TEXT_ACCENT = "#FF6B6B";

// Max words to render in the banner (each word = 6 figlet lines).
const MAX_BANNER_WORDS = 3;

// Cartoon ant. 24 rows x 16 cols = 12 terminal lines.
// Elbowed antennae, big head, clear petiole waist, 3 leg pairs.
const ANT_PIXELS = [
  "B.............B.",
  ".B...........B..",
  "..B.........B...",
  "...BB.....BB....",
  "....B.....B.....",
  "....B.....B.....",
  ".....BBBBB......",
  "....DBBBBBD.....",
  "...BWWPBBBWWPB..",
  "...BBBBBBBBBB...",
  "....BBMMMBB.....",
  ".....DBBBD......",
  "L....BBBBB....L.",
  "L...DBBBBBD...L.",
  "L...DBBBBBD...L.",
  ".....BBBBB......",
  "......BBB.......",
  "......BBB.......",
  ".....BBBBB......",
  "L..BBBBBBBBB..L.",
  "...BBBDBDBBB....",
  "...BBBBBBBBB....",
  "....BBBBBBB.....",
  ".....BBBBB......",
];

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
  constructor(bannerText = "ANT") {
    super();
    this.addChild(new Spacer(1));

    const dimFn = (t: string) => chalk.hex(palette.dim)(t);

    // Color figlet text to match the ant mascot palette (red theme).
    const primaryFn = chalk.hex(TEXT_PRIMARY);
    const accentFn = chalk.hex(TEXT_ACCENT);
    const colorLogoChar = (ch: string): string => {
      if (ch === " ") return ch;
      const code = ch.charCodeAt(0);
      if (code >= 0x2550 && code <= 0x256c) return accentFn(ch);
      return primaryFn(ch);
    };
    const colorLogoLine = (line: string): string =>
      [...line].map(colorLogoChar).join("");

    const gap = "   ";
    const mascotLines = renderPixelArt(ANT_PIXELS, MASCOT_COLORS);

    // Render the banner text with figlet.
    const logoLines = renderBannerText(bannerText);
    const maxWidth = logoLines.reduce((max, l) => Math.max(max, l.length), 0);

    // Vertically center the text when it's shorter than the donkey mascot.
    const totalLines = Math.max(logoLines.length, mascotLines.length);
    const textOffset = Math.max(0, Math.floor((totalLines - logoLines.length) / 2));

    // Composite: figlet text (centered) + gap + ant mascot.
    for (let i = 0; i < totalLines; i++) {
      const textIdx = i - textOffset;
      const rawText = textIdx >= 0 && textIdx < logoLines.length ? logoLines[textIdx]! : "";
      const textPart = colorLogoLine(padRight(rawText, maxWidth));
      const mascot = mascotLines[i] ?? "";
      this.addChild(new Text(textPart + gap + mascot, 3, 0));
    }

    this.addChild(new Spacer(1));

    for (const line of SHORTCUTS) {
      this.addChild(new Text(dimFn(line), 4, 0));
    }

    this.addChild(new Spacer(1));
  }
}
