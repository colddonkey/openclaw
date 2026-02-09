import { Container, Spacer, Text } from "@mariozechner/pi-tui";
import chalk from "chalk";
import { palette } from "../theme/theme.js";

// ---------------------------------------------------------------------------
// ANSI Shadow figlet font for "COLD" + "DONKEY" with a donkey face beside it.
// Uses full-block and box-drawing chars -- universal terminal support.
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

// Donkey face -- 12 lines tall to span both COLD (6) and DONKEY (6) blocks.
// Long ears, expressive eyes, little snout. Box-drawing for clean lines.
const DONKEY_FACE = [
  " ╭─╮    ╭─╮",
  " │ │    │ │",
  " │ │    │ │",
  " │ │    │ │",
  " │ ╰────╯ │",
  " │         │",
  " │  ●   ●  │",
  " │         │",
  " │   ╭─╮   │",
  " │   ╰─╯   │",
  " │         │",
  " ╰─────────╯",
];

// DONKEY text is widest at 54 chars. Pad COLD lines to match.
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

    const accentFn = (t: string) => chalk.hex(palette.accent)(t);
    const dimFn = (t: string) => chalk.hex(palette.dim)(t);

    const gap = "   ";

    // Merge COLD (6 lines) + DONKEY (6 lines) with the donkey face alongside.
    const allLogoLines = [
      ...LOGO_COLD.map((line) => padRight(line, DONKEY_WIDTH)),
      ...LOGO_DONKEY,
    ];

    for (let i = 0; i < allLogoLines.length; i++) {
      const logoLine = allLogoLines[i] ?? "";
      const faceLine = DONKEY_FACE[i] ?? "";
      const combined = accentFn(logoLine) + gap + dimFn(faceLine);
      this.addChild(new Text(combined, 3, 0));
    }

    this.addChild(new Spacer(1));

    // Keyboard shortcuts / quick reference
    for (const line of SHORTCUTS) {
      this.addChild(new Text(dimFn(line), 4, 0));
    }

    this.addChild(new Spacer(1));
  }
}
