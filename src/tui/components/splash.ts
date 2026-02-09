import { Container, Spacer, Text } from "@mariozechner/pi-tui";
import chalk from "chalk";
import { palette } from "../theme/theme.js";

// ---------------------------------------------------------------------------
// ANSI Shadow figlet font for "COLD" + "DONKEY" with pixel-art donkey mascot.
// ---------------------------------------------------------------------------

const LOGO_COLD = [
  " ██████╗ ██████╗ ██╗     ██████╗ ",
  "██╔════╝██╔═══██╗██║     ██╔══██╗",
  "██║     ██║   ██║██║     ██║  ██║",
  "██║     ██║   ██║██║     ██║  ██║",
  "╚██████╗╚██████╔╝███████╗██████╔╝",
  " ╚═════╝ ╚═════╝ ╚══════╝╚═════╝ ",
];

const LOGO_DONKEY = [
  "██████╗  ██████╗ ███╗   ██╗██╗  ██╗███████╗██╗   ██╗",
  "██╔══██╗██╔═══██╗████╗  ██║██║ ██╔╝██╔════╝╚██╗ ██╔╝",
  "██║  ██║██║   ██║██╔██╗ ██║█████╔╝ █████╗   ╚████╔╝ ",
  "██║  ██║██║   ██║██║╚██╗██║██╔═██╗ ██╔══╝    ╚██╔╝  ",
  "██████╔╝╚██████╔╝██║ ╚████║██║  ██╗███████╗   ██║   ",
  "╚═════╝  ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝   ╚═╝   ",
];

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

// Sombrero palette (ties into donkey colors).
const SOMBRERO_COLORS: Record<string, string> = {
  S: "#C4A882", // straw brim (matches donkey tan)
  D: "#8B7355", // crown (matches donkey brown)
  R: "#CC3333", // red band
};

// Donkey with glasses. 24 rows x 16 cols = 12 terminal lines.
// Plain version (no glasses) preserved in git at 161fdccfe.
const DONKEY_PIXELS = [
  "....BB......BB..",
  "...BLLB....BLLB.",
  "...BLLB....BLLB.",
  "...BLLB....BLLB.",
  "...BLLB....BLLB.",
  "...BBBBBBBBBBBB.",
  "..FBFFFFBFFFFBBF",
  "..FBFTTFFFTTFBBF",
  "..FBFFFFBFFFFBBF",
  "....BMMMMMMMB...",
  "....BM..MM..MB..",
  "....BMMMMMMMB...",
  ".....BGGGGGB....",
  ".....BLLLLBB....",
  "....BBLLLLLLBB..",
  "...BB.LLLLLL.B..",
  "......LLLLLL.B..",
  "......BLLLLBB.B.",
  "......BBBBBB....",
  "......BB..BB....",
  "......BB..BB....",
  "......BB..BB....",
  "................",
  "................",
];

// Sombrero. 6 rows x 14 cols = 3 terminal lines.
// Classic shape with upturned brim edges.
const SOMBRERO_PIXELS = [
  "......DD......",
  ".....DDDD.....",
  "....DDDDDD....",
  "..SSRRRRRRSS..",
  ".SSSSSSSSSSSS.",
  "SS..........SS",
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

// DONKEY text is the widest logo line. COLD text is narrower.
const DONKEY_TEXT_WIDTH = 54;
const COLD_TEXT_WIDTH = 34;

function padRight(str: string, targetLen: number): string {
  if (str.length >= targetLen) return str;
  return str + " ".repeat(targetLen - str.length);
}

const SHORTCUTS = [
  "/help  commands        /theme  colors        Ctrl+C x2  exit",
  "/model change model    /agent  switch agent  Ctrl+O     tools",
];

export class SplashComponent extends Container {
  constructor() {
    super();
    this.addChild(new Spacer(1));

    const dimFn = (t: string) => chalk.hex(palette.dim)(t);

    // Color the logo text to match the donkey mascot palette.
    // Solid blocks in brown, decorative line chars in lighter tan.
    const brownFn = chalk.hex(DONKEY_COLORS.B);
    const tanFn = chalk.hex(DONKEY_COLORS.L);
    const colorLogoChar = (ch: string): string => {
      // Full blocks and half blocks get the brown body color.
      if ("\u2588\u2591\u2592\u2593".includes(ch)) return brownFn(ch);
      // Box-drawing / decorative chars get the lighter tan.
      if ("\u2550\u2551\u2554\u2557\u255A\u255D\u2560\u2563\u2566\u2569\u256C\u2553\u2556\u2559\u255C".includes(ch))
        return tanFn(ch);
      // Space stays space.
      if (ch === " ") return ch;
      // Default: brown for everything else (block chars like half-blocks).
      return brownFn(ch);
    };
    const colorLogoLine = (line: string): string =>
      [...line].map(colorLogoChar).join("");

    const gap = "   ";
    const donkeyLines = renderPixelArt(DONKEY_PIXELS, DONKEY_COLORS);
    const sombreroLines = renderPixelArt(SOMBRERO_PIXELS, SOMBRERO_COLORS);

    const allLogoLines = [
      ...LOGO_COLD.map((line) => padRight(line, DONKEY_TEXT_WIDTH)),
      ...LOGO_DONKEY,
    ];

    // Composite: logo text + sombrero (floats in COLD padding) + donkey mascot.
    // Sombrero (3 lines) sits on COLD lines 0-2, in the padding after the text.
    const SOMBRERO_VIS_WIDTH = 14;
    const SOMBRERO_GAP = 3;
    for (let i = 0; i < allLogoLines.length; i++) {
      let textPart: string;
      if (i < LOGO_COLD.length && i < sombreroLines.length) {
        // COLD line with sombrero: color text, then append pre-colored sombrero.
        const coldPadded = padRight(LOGO_COLD[i]!, COLD_TEXT_WIDTH);
        const coloredCold = colorLogoLine(coldPadded);
        const padAfter = DONKEY_TEXT_WIDTH - COLD_TEXT_WIDTH - SOMBRERO_GAP - SOMBRERO_VIS_WIDTH;
        textPart = coloredCold + " ".repeat(SOMBRERO_GAP) + sombreroLines[i]! + " ".repeat(Math.max(0, padAfter));
      } else {
        textPart = colorLogoLine(allLogoLines[i] ?? "");
      }
      const mascot = donkeyLines[i] ?? "";
      const combined = textPart + gap + mascot;
      this.addChild(new Text(combined, 3, 0));
    }

    this.addChild(new Spacer(1));

    for (const line of SHORTCUTS) {
      this.addChild(new Text(dimFn(line), 4, 0));
    }

    this.addChild(new Spacer(1));
  }
}
