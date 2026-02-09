import { Container, Markdown, Spacer, Text, visibleWidth } from "@mariozechner/pi-tui";
import chalk from "chalk";
import { markdownTheme, palette, theme } from "../theme/theme.js";

/** Fraction of terminal width reserved as left indent to right-align user messages. */
const USER_INDENT_RATIO = 0.15;
const MIN_INDENT_COLS = 4;
const MAX_INDENT_COLS = 24;

export class UserMessageComponent extends Container {
  private body: Markdown;
  private timestampText: Text | null = null;

  constructor(text: string, opts?: { timestamp?: boolean; compact?: boolean }) {
    super();
    const paddingY = opts?.compact ? 0 : 1;
    this.body = new Markdown(text, 1, paddingY, markdownTheme, {
      bgColor: (line) => theme.userBg(line),
      color: (line) => theme.userText(line),
    });
    if (!opts?.compact) {
      this.addChild(new Spacer(1));
    }
    if (opts?.timestamp) {
      const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      this.timestampText = new Text(chalk.hex(palette.dim)(ts), 1, 0);
      this.addChild(this.timestampText);
    }
    this.addChild(this.body);
  }

  setText(text: string) {
    this.body.setText(text);
  }

  override render(width: number): string[] {
    const indent = Math.min(
      MAX_INDENT_COLS,
      Math.max(MIN_INDENT_COLS, Math.floor(width * USER_INDENT_RATIO)),
    );
    const contentWidth = width - indent;
    if (contentWidth < 20) {
      // Terminal too narrow for indentation; fall back to full-width.
      return super.render(width);
    }
    const innerLines = super.render(contentWidth);
    const pad = " ".repeat(indent);
    return innerLines.map((line) => {
      // Preserve empty/spacer lines without adding trailing spaces.
      if (visibleWidth(line) === 0) {
        return line;
      }
      return pad + line;
    });
  }
}
