/**
 * Lightweight Telegram Bot API helper for proactive system notifications.
 * Uses raw fetch — no grammY dependency — for use inside server-side code
 * where the full bot runtime is not available.
 */

import type { OpenClawConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("telegram-notify");

/**
 * Send a plain-text Telegram DM via the Bot API to a single chat.
 * Fire-and-forget: logs warnings on failure but never throws.
 */
export async function sendTelegramSystemDm(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      log.warn(`DM to ${chatId} failed (${res.status}): ${await res.text()}`);
    }
  } catch (err) {
    log.warn(`DM to ${chatId} error: ${String(err)}`);
  }
}

/**
 * Broadcast a system message to all Telegram users in the allowlist.
 * Returns the number of users notified.
 */
export async function broadcastTelegramSystemAlert(
  cfg: OpenClawConfig,
  text: string,
): Promise<number> {
  const botToken = cfg.channels?.telegram?.botToken?.trim();
  const allowFrom = cfg.channels?.telegram?.allowFrom ?? [];
  if (!botToken || allowFrom.length === 0) {
    return 0;
  }
  await Promise.all(
    allowFrom.map((chatId) => sendTelegramSystemDm(botToken, String(chatId), text)),
  );
  return allowFrom.length;
}
