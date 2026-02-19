/**
 * Forward agent communication board messages to Telegram.
 *
 * When `multiAgentOs.comms.telegramForward` is enabled, messages posted
 * to channels are formatted and forwarded to the configured Telegram chat.
 * This allows operators to monitor agent communications from Telegram.
 *
 * The forwarding is one-way: Telegram -> comms board is not supported here
 * (that would require a separate Telegram command handler).
 */

import type { OpenClawConfig } from "../config/types.js";
import { resolveMultiAgentOsGate } from "../tasks/feature-gate.js";
import type { Message, Channel } from "./types.js";

export type TelegramForwardSender = (chatId: string, text: string, opts?: { parseMode?: string }) => Promise<unknown>;

export type TelegramForwardConfig = {
  chatId: string;
  sender: TelegramForwardSender;
};

const CHANNEL_ICONS: Record<string, string> = {
  general: "#",
  system: "!",
  task: "T",
  direct: "@",
};

/**
 * Format a comms message for Telegram delivery.
 */
export function formatMessageForTelegram(channel: Channel, message: Message): string {
  const icon = CHANNEL_ICONS[channel.kind] || "#";
  const header = `[${icon} ${channel.name}]`;
  const author = message.authorName || message.authorId;

  let body = `<b>${escHtml(author)}</b>`;

  if (message.kind === "system") {
    body = `<i>${escHtml(message.text)}</i>`;
  } else if (message.kind === "status") {
    body += ` <code>${escHtml(message.text)}</code>`;
  } else if (message.kind === "task_ref" && message.taskRef) {
    body += `: ${escHtml(message.text)}\n<code>${message.taskRef}</code>`;
  } else {
    body += `: ${escHtml(message.text)}`;
  }

  return `${escHtml(header)}\n${body}`;
}

/**
 * Check if Telegram forwarding is enabled for this config.
 */
export function isTelegramForwardEnabled(cfg: OpenClawConfig): boolean {
  const gate = resolveMultiAgentOsGate(cfg);
  return gate.enabled && gate.commsEnabled && gate.commsTelegramForward;
}

/**
 * Forward a single message to Telegram if forwarding is enabled.
 * Returns true if the message was forwarded, false if skipped.
 */
export async function forwardToTelegram(
  config: TelegramForwardConfig,
  channel: Channel,
  message: Message,
): Promise<boolean> {
  if (message.authorId === "system" && message.kind === "system") {
    const text = formatMessageForTelegram(channel, message);
    await config.sender(config.chatId, text, { parseMode: "HTML" });
    return true;
  }

  if (channel.kind === "direct") {
    return false;
  }

  const text = formatMessageForTelegram(channel, message);
  await config.sender(config.chatId, text, { parseMode: "HTML" });
  return true;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
