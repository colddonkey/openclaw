import { Container, Spacer, Text } from "@mariozechner/pi-tui";
import chalk from "chalk";

// ---------------------------------------------------------------------------
// Sticker-style 8-bit ant mascot splash screen.
// Bold outlines, big cute eyes, clean shapes -- like a die-cut sticker.
// ---------------------------------------------------------------------------

const MASCOT_COLORS: Record<string, string> = {
  B: "#DD3333", // bright red body
  D: "#1A0808", // near-black outline (sticker border)
  H: "#FF6655", // highlight / shine
  W: "#FFFFFF", // eye/lens sparkle (white)
  P: "#0A0A0A", // pupil / lens dark
  M: "#DDAA77", // mouth (warm tan)
  A: "#441111", // antennae (dark red-brown)
  C: "#FFAAAA", // cheek blush (soft pink)
  K: "#112233", // sunglasses lens (very dark blue-tint)
  G: "#333333", // sunglasses frame (dark gray)
};

const TEXT_PRIMARY = "#DD3333";

// Number of pixel rows that are antennae (used for centering).
const ANTENNA_ROWS = 4;

// Sticker-style ant head with large sunglasses. 20 rows = 10 terminal lines.
const ANT_PIXELS = [
  // -- antennae with bulb tips (4 rows, excluded from centering) --
  "BD................DB.",
  ".A..................A..",
  "..AA..............AA..",
  "....A............A....",
  // -- head with large sunglasses (16 rows) --
  "......DDDDDDDDDDDDD...",
  ".....DBBBBBBBBBBBBBBD..",
  "....DBBBBBBBBBBBBBBBBD.",
  "....DBBBBHBWBBBBHBBBBD.",
  "...DBBBBBBBBBBBBBBBBBBD",
  "...DBBBBBBBBBBBBBBBBBBD",
  "...GGKKKKKKKGGKKKKKKKGG",
  "..GGKWKKKKKGGKKKKKWKGG.",
  "...DBBBBBBBBBBBBBBBBBBD",
  "...DBBBBBBBBBBBBBBBBBD.",
  "....DBBCCBBBBBBCCBBBD..",
  ".....DBBBBMMMMMBBBD....",
  "......DDDDDDDDDDDDD...",
  ".........DDDDDDD.......",
  "..........DDDDD........",
  "...........DDD.........",
];

// Hardcoded "ANT" in ANSI Shadow style (no figlet dependency needed).
const ANT_ASCII = [
  " ██████╗ ███╗   ██╗████████╗",
  "██╔════╝ ████╗  ██║╚══██╔══╝",
  "███████╗ ██╔██╗ ██║   ██║   ",
  "██╔═══██╗██║╚██╗██║   ██║   ",
  "╚██████╔╝██║ ╚████║   ██║   ",
  " ╚═════╝ ╚═╝  ╚═══╝   ╚═╝   ",
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
  if (str.length >= targetLen) {
    return str;
  }
  return str + " ".repeat(targetLen - str.length);
}

const SHORTCUTS = [
  "/help  commands        /model  change model   Ctrl+C x2  exit",
  "/agent switch agent    /session  switch sess   Ctrl+O     tools",
];

export class SplashComponent extends Container {
  constructor() {
    super();
    this.addChild(new Spacer(1));

    const dimFn = (t: string) => chalk.hex("#7B7F87")(t);
    const primaryFn = chalk.hex(TEXT_PRIMARY);

    const colorChar = (ch: string): string => {
      if (ch === " ") {
        return ch;
      }
      return primaryFn(ch);
    };
    const colorLine = (line: string): string =>
      [...line].map(colorChar).join("");

    const gap = "   ";
    const mascotLines = renderPixelArt(ANT_PIXELS, MASCOT_COLORS);
    const logoLines = ANT_ASCII;
    const maxWidth = logoLines.reduce((max, l) => Math.max(max, l.length), 0);

    // Vertically center the text relative to the HEAD (exclude antenna rows).
    const antennaTermLines = Math.ceil(ANTENNA_ROWS / 2);
    const headTermLines = mascotLines.length - antennaTermLines;
    const totalLines = Math.max(logoLines.length + antennaTermLines, mascotLines.length);
    const headCenter = antennaTermLines + Math.floor(headTermLines / 2);
    const textCenter = Math.floor(logoLines.length / 2);
    const textOffset = Math.max(0, headCenter - textCenter);

    // Composite: ASCII text (vertically centered) + gap + ant mascot.
    for (let i = 0; i < totalLines; i++) {
      const textIdx = i - textOffset;
      const rawText = textIdx >= 0 && textIdx < logoLines.length ? logoLines[textIdx]! : "";
      const textPart = colorLine(padRight(rawText, maxWidth));
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
