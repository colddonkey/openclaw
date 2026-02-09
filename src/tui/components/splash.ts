import { Container, Spacer, Text } from "@mariozechner/pi-tui";
import chalk from "chalk";
import { palette } from "../theme/theme.js";

// ASCII donkey art – compact enough for 80-col terminals.
// Uses escaped backslashes (no String.raw – rolldown misparses raw backslash sequences).
const DONKEY_ART = [
  "         \\\\\\",
  "          \\\\\\_",
  "       .--'  o\\",
  "      /  __    |",
  "     ( /(  \\   |",
  "      \\\\  \\  \\ |",
  "       '\\_/\\__/",
  "        |  |",
  "       /|  |",
  "      / |  |\\",
  "     (  |  | )",
  "     '--|  |--'",
  "        |  |",
];

const BRAND = "c o l d d o n k e y";

export class SplashComponent extends Container {
  constructor() {
    super();
    this.addChild(new Spacer(1));

    const accentFn = (t: string) => chalk.hex(palette.accent)(t);
    const dimFn = (t: string) => chalk.hex(palette.dim)(t);

    // Render the donkey in accent color.
    for (const line of DONKEY_ART) {
      this.addChild(new Text(accentFn(line), 2, 0));
    }

    this.addChild(new Spacer(1));

    // Brand line.
    this.addChild(new Text(chalk.bold(accentFn(BRAND)), 2, 0));

    this.addChild(new Spacer(1));
    this.addChild(
      new Text(
        dimFn("Type a message to chat, /help for commands, /theme to change colors."),
        2,
        0,
      ),
    );
    this.addChild(new Spacer(1));
  }
}
