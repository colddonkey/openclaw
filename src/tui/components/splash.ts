import { Container, Spacer, Text } from "@mariozechner/pi-tui";
import chalk from "chalk";
import { palette } from "../theme/theme.js";

// ---------------------------------------------------------------------------
// ANSI Shadow figlet font for "COLD" + "DONKEY".
// Uses full-block and box-drawing double-line chars -- universal terminal support.
// ---------------------------------------------------------------------------

/* eslint-disable no-irregular-whitespace */

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

    // COLD
    for (const line of LOGO_COLD) {
      this.addChild(new Text(accentFn(line), 3, 0));
    }

    // DONKEY (no gap -- flows visually from COLD)
    for (const line of LOGO_DONKEY) {
      this.addChild(new Text(accentFn(line), 3, 0));
    }

    this.addChild(new Spacer(1));

    // Keyboard shortcuts / quick reference
    for (const line of SHORTCUTS) {
      this.addChild(new Text(dimFn(line), 4, 0));
    }

    this.addChild(new Spacer(1));
  }
}
