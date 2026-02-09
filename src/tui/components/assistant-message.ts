import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import chalk from "chalk";
import { markdownTheme, palette, theme } from "../theme/theme.js";

export class AssistantMessageComponent extends Container {
  private body: Markdown;

  constructor(text: string, opts?: { timestamp?: boolean; compact?: boolean }) {
    super();
    this.body = new Markdown(text, 1, 0, markdownTheme, {
      color: (line) => theme.fg(line),
    });
    if (!opts?.compact) {
      this.addChild(new Spacer(1));
    }
    if (opts?.timestamp) {
      const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      this.addChild(new Text(chalk.hex(palette.dim)(ts), 1, 0));
    }
    this.addChild(this.body);
  }

  setText(text: string) {
    this.body.setText(text);
  }
}
