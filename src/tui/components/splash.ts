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
};

// 24 rows x 16 cols = 12 terminal lines.
const DONKEY_PIXELS = [
  "....BB......BB..",
  "...BLLB....BLLB.",
  "...BLLB....BLLB.",
  "...BLLB....BLLB.",
  "...BLLB....BLLB.",
  "...BBBBBBBBBBBB.",
  "....BBBBBBBBBB..",
  "...BWPBBBBBBWPB.",
  "...BBBBBBBBBBBB.",
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

function renderPixelDonkey(): string[] {
  const lines: string[] = [];
  for (let y = 0; y < DONKEY_PIXELS.length; y += 2) {
    const topRow = DONKEY_PIXELS[y] ?? "";
    const botRow = DONKEY_PIXELS[y + 1] ?? "";
    const width = Math.max(topRow.length, botRow.length);
    let line = "";
    for (let x = 0; x < width; x++) {
      const tc = topRow[x] ?? ".";
      const bc = botRow[x] ?? ".";
      const topClr = tc !== "." ? DONKEY_COLORS[tc] : null;
      const botClr = bc !== "." ? DONKEY_COLORS[bc] : null;
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

const DONKEY_WIDTH = 54;

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
    const donkeyLines = renderPixelDonkey();

    const allLogoLines = [
      ...LOGO_COLD.map((line) => padRight(line, DONKEY_WIDTH)),
      ...LOGO_DONKEY,
    ];

    for (let i = 0; i < allLogoLines.length; i++) {
      const logoLine = allLogoLines[i] ?? "";
      const mascot = donkeyLines[i] ?? "";
      const combined = colorLogoLine(logoLine) + gap + mascot;
      this.addChild(new Text(combined, 3, 0));
    }

    this.addChild(new Spacer(1));

    for (const line of SHORTCUTS) {
      this.addChild(new Text(dimFn(line), 4, 0));
    }

    this.addChild(new Spacer(1));
  }
}
