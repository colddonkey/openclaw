import { Container, Text } from "@mariozechner/pi-tui";
import chalk from "chalk";
import { currentThemeName, palette } from "../theme/theme.js";

export type StatusBarData = {
  agent: string;
  session: string;
  model: string;
  think?: string;
  verbose?: string;
  reasoning?: string;
  tokens?: string | null;
  connectionStatus?: string;
};

/**
 * A rich status bar that renders as a single-line bar at the bottom of the TUI.
 * Color-codes different segments for quick scanning.
 */
export class StatusBar extends Container {
  private barText: Text;

  constructor() {
    super();
    this.barText = new Text("", 0, 0);
    this.addChild(this.barText);
  }

  update(data: StatusBarData) {
    const segments: string[] = [];

    // Agent + session: accent color
    const accentFn = (t: string) => chalk.hex(palette.accent)(t);
    const dimFn = (t: string) => chalk.hex(palette.dim)(t);
    const textFn = (t: string) => chalk.hex(palette.text)(t);
    const successFn = (t: string) => chalk.hex(palette.success)(t);
    const warnFn = (t: string) => chalk.hex(palette.accentSoft)(t);

    // Agent
    segments.push(accentFn(data.agent));

    // Session
    segments.push(dimFn(data.session));

    // Model - emphasized
    segments.push(textFn(data.model));

    // Thinking level (only if non-default)
    if (data.think && data.think !== "off") {
      segments.push(warnFn(`think:${data.think}`));
    }

    // Verbose (only if on)
    if (data.verbose && data.verbose !== "off") {
      segments.push(warnFn(`verbose`));
    }

    // Reasoning (only if on)
    if (data.reasoning && data.reasoning !== "off") {
      const label = data.reasoning === "stream" ? "reason:stream" : "reason";
      segments.push(warnFn(label));
    }

    // Tokens
    if (data.tokens) {
      segments.push(dimFn(data.tokens));
    }

    // Theme (only if non-default)
    const themeName = currentThemeName();
    if (themeName !== "default") {
      segments.push(dimFn(`theme:${themeName}`));
    }

    // Connection status
    if (data.connectionStatus) {
      const connFn = data.connectionStatus === "connected" ? successFn : warnFn;
      segments.push(connFn(data.connectionStatus));
    }

    const sep = dimFn(" \u2502 "); // thin vertical bar
    this.barText.setText(segments.join(sep));
  }
}
