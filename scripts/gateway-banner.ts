#!/usr/bin/env tsx
/**
 * Print the OpenClaw Gateway banner to the terminal.
 * Uses figlet + the ant mascot, same style as the TUI splash.
 * Called by the gateway-launcher.cmd before starting the gateway.
 */

import chalk from "chalk";
import figlet from "figlet";

const MASCOT_COLORS: Record<string, string> = {
  B: "#DD3333", // bright red body
  D: "#1A0808", // near-black outline
  H: "#FF6655", // highlight
  W: "#FFFFFF", // sparkle
  M: "#DDAA77", // mouth
  A: "#441111", // antennae
  C: "#FFAAAA", // cheek
  K: "#112233", // sunglasses lens
  G: "#333333", // sunglasses frame
};

const ANT_PIXELS = [
  "BD................DB.",
  ".A..................A..",
  "..AA..............AA..",
  "....A............A....",
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

function renderPixelArt(pixels: string[], colors: Record<string, string>): string[] {
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

function padRight(str: string, len: number): string {
  if (str.length >= len) return str;
  return str + " ".repeat(len - str.length);
}

// Render the banner.
const bannerText = "ANT";
const port = process.argv[2] ?? "18789";
const logPath = process.argv[3] ?? "";

const primaryFn = chalk.hex("#DD3333");
const accentFn = chalk.hex("#E85D5D");
const dimFn = chalk.hex("#8B7F6E");
const warnFn = chalk.hex("#FFB020");

// Figlet text.
const figletLines: string[] = [];
const rendered = figlet.textSync(bannerText, { font: "ANSI Shadow" });
figletLines.push(...rendered.split("\n"));

const maxWidth = figletLines.reduce((max, l) => Math.max(max, l.length), 0);

// Color the figlet chars.
function colorLine(line: string): string {
  return [...line]
    .map((ch) => {
      if (ch === " ") return ch;
      const code = ch.charCodeAt(0);
      if (code >= 0x2550 && code <= 0x256c) return accentFn(ch);
      return primaryFn(ch);
    })
    .join("");
}

// Ant mascot.
const mascotLines = renderPixelArt(ANT_PIXELS, MASCOT_COLORS);

// Vertical centering (same logic as splash.ts).
const ANTENNA_ROWS = 4;
const antennaTermLines = Math.ceil(ANTENNA_ROWS / 2);
const headTermLines = mascotLines.length - antennaTermLines;
const totalArtLines = Math.max(figletLines.length + antennaTermLines, mascotLines.length);
const headCenter = antennaTermLines + Math.floor(headTermLines / 2);
const textCenter = Math.floor(figletLines.length / 2);
const textOffset = Math.max(0, headCenter - textCenter);

const gap = "   ";

console.log("");
for (let i = 0; i < totalArtLines; i++) {
  const textIdx = i - textOffset;
  const rawText = textIdx >= 0 && textIdx < figletLines.length ? figletLines[textIdx]! : "";
  const textPart = colorLine(padRight(rawText, maxWidth));
  const mascot = mascotLines[i] ?? "";
  console.log(`  ${textPart}${gap}${mascot}`);
}

console.log("");
console.log(dimFn("  ═══════════════════════════════════════════════════"));
console.log(primaryFn("    OPENCLAW GATEWAY") + dimFn(`    port ${port}`));
console.log(dimFn("  ═══════════════════════════════════════════════════"));
console.log("");
console.log(warnFn("    DO NOT CLOSE THIS WINDOW"));
console.log(dimFn("    The gateway is running..."));
console.log("");
if (logPath) {
  console.log(dimFn(`    Log: ${logPath}`));
}
console.log(dimFn(`    Started: ${new Date().toLocaleString()}`));
console.log("");
console.log(dimFn("  ═══════════════════════════════════════════════════"));
console.log("");
