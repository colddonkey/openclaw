import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { TaskerSmsConfig } from "./config.js";

type ReadJsonBodyResult = { ok: true; value: unknown } | { ok: false; error: string };

async function readJsonBodyWithLimit(
  req: IncomingMessage,
  opts: { maxBytes: number },
): Promise<ReadJsonBodyResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > opts.maxBytes) {
        req.destroy();
        resolve({ ok: false, error: "body too large" });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve({ ok: true, value: JSON.parse(raw) });
      } catch {
        resolve({ ok: false, error: "invalid JSON" });
      }
    });
    req.on("error", () => resolve({ ok: false, error: "read error" }));
  });
}
import { tryHandleAdmin } from "./admin.js";
import { shouldIgnoreMessage, isLikelySpam } from "./filtering.js";
import {
  getThread,
  setThread,
  updateThreadTimestamp,
  incrementMessageCount,
  deleteThread,
  normalizePhone,
} from "./thread-store.js";

const WEBHOOK_PATH = "/tasker-sms-webhook";

type TaskerSmsPayload = {
  from: string;
  body: string;
  date?: string;
  time?: string;
  senderName?: string;
  imageBase64?: string;
  imageUrl?: string;
  mmsImages?: string[];
};

function isTaskerSmsPayload(value: unknown): value is TaskerSmsPayload {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.from === "string" && typeof obj.body === "string";
}

function safeTokenCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sendJson(res: ServerResponse, status: number, data: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

type TelegramConfig = { botToken: string; chatId: string };

async function telegramApi(
  cfg: TelegramConfig,
  method: string,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; error_code?: number; result?: Record<string, unknown> }> {
  try {
    const url = `https://api.telegram.org/bot${cfg.botToken}/${method}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    return (await response.json()) as { ok: boolean; error_code?: number; result?: Record<string, unknown> };
  } catch (error) {
    console.error(`[tasker-sms] Telegram ${method} error:`, error);
    return { ok: false };
  }
}

async function sendPhotoBase64(
  cfg: TelegramConfig,
  chatId: string,
  base64Data: string,
  caption: string,
  threadId?: number | null,
): Promise<boolean> {
  try {
    const imgBuffer = Buffer.from(base64Data, "base64");
    const boundary = `----TaskerSms${Date.now()}`;
    const parts: Buffer[] = [];

    const addField = (name: string, value: string) => {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        ),
      );
    };

    addField("chat_id", chatId);
    addField("caption", caption);
    addField("parse_mode", "HTML");
    if (threadId) addField("message_thread_id", String(threadId));

    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="mms.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ),
    );
    parts.push(imgBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const body = Buffer.concat(parts);
    const url = `https://api.telegram.org/bot${cfg.botToken}/sendPhoto`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const result = (await response.json()) as { ok: boolean };
    return result.ok;
  } catch (error) {
    console.error("[tasker-sms] sendPhotoBase64 error:", error);
    return false;
  }
}

async function sendPhotoUrl(
  cfg: TelegramConfig,
  chatId: string,
  photoUrl: string,
  caption: string,
  threadId?: number | null,
): Promise<boolean> {
  const params: Record<string, unknown> = {
    chat_id: chatId,
    photo: photoUrl,
    caption,
    parse_mode: "HTML",
  };
  if (threadId) params.message_thread_id = threadId;
  const result = await telegramApi(cfg, "sendPhoto", params);
  return result.ok;
}

async function forwardMmsImages(
  tg: TelegramConfig,
  payload: TaskerSmsPayload,
  threadId: number | null,
): Promise<number> {
  let sent = 0;
  const senderLabel =
    payload.senderName && payload.senderName !== "%SMSRN"
      ? payload.senderName
      : payload.from;
  const caption = `<b>${escapeHtml(senderLabel)}</b>`;

  if (payload.imageBase64) {
    const ok = await sendPhotoBase64(tg, tg.chatId, payload.imageBase64, caption, threadId);
    if (ok) sent++;
    else console.error("[tasker-sms] Failed to send base64 MMS image");
  }

  if (payload.imageUrl) {
    const ok = await sendPhotoUrl(tg, tg.chatId, payload.imageUrl, caption, threadId);
    if (ok) sent++;
    else console.error("[tasker-sms] Failed to send URL MMS image");
  }

  if (payload.mmsImages && payload.mmsImages.length > 0) {
    for (const img of payload.mmsImages) {
      const isUrl = img.startsWith("http://") || img.startsWith("https://");
      const ok = isUrl
        ? await sendPhotoUrl(tg, tg.chatId, img, caption, threadId)
        : await sendPhotoBase64(tg, tg.chatId, img, caption, threadId);
      if (ok) sent++;
      else console.error("[tasker-sms] Failed to send MMS image from array");
    }
  }

  return sent;
}

/**
 * Get or create a Telegram forum topic for a phone number.
 * If the existing topic returns a 400 error (deleted), re-creates it.
 */
async function getOrCreateThread(
  tg: TelegramConfig,
  phone: string,
  senderName?: string,
): Promise<number | null> {
  const existing = getThread(phone);
  if (existing) {
    updateThreadTimestamp(phone);
    if (senderName && senderName !== "%SMSRN" && senderName !== existing.name) {
      setThread(phone, { ...existing, name: senderName });
    }
    return existing.threadId;
  }

  return createNewTopic(tg, phone, senderName);
}

async function createNewTopic(
  tg: TelegramConfig,
  phone: string,
  senderName?: string,
): Promise<number | null> {
  const topicName =
    senderName && senderName !== "%SMSRN" ? senderName : normalizePhone(phone);

  const result = await telegramApi(tg, "createForumTopic", {
    chat_id: tg.chatId,
    name: topicName.substring(0, 128),
  });

  if (!result.ok || !result.result) {
    console.error("[tasker-sms] Failed to create forum topic:", result);
    return null;
  }

  const threadId = result.result.message_thread_id as number;

  setThread(phone, {
    name: senderName && senderName !== "%SMSRN" ? senderName : undefined,
    threadId,
    createdAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
  });

  console.log(`[tasker-sms] Created forum topic "${topicName}" (thread ${threadId})`);
  return threadId;
}

/**
 * If a Telegram send fails with 400 (topic deleted), delete the thread
 * mapping and re-create a fresh topic.
 */
async function handleSendWithRecreate(
  tg: TelegramConfig,
  phone: string,
  senderName: string | undefined,
  threadId: number,
  sendFn: (tid: number) => Promise<{ ok: boolean; error_code?: number }>,
): Promise<{ ok: boolean; threadId: number }> {
  const result = await sendFn(threadId);
  if (result.ok) return { ok: true, threadId };

  if (result.error_code === 400) {
    console.warn(`[tasker-sms] Topic ${threadId} gone for ${phone} -- re-creating`);
    deleteThread(phone);
    const newThreadId = await createNewTopic(tg, phone, senderName);
    if (!newThreadId) return { ok: false, threadId };

    const retry = await sendFn(newThreadId);
    return { ok: retry.ok, threadId: newThreadId };
  }

  return { ok: false, threadId };
}

function formatSmsForTelegram(payload: TaskerSmsPayload, isSpam: boolean): string {
  const emoji = isSpam ? "\u{1F916}" : "\u{1F4F1}";
  const sender =
    payload.senderName && payload.senderName !== "%SMSRN"
      ? payload.senderName
      : payload.from;
  const timestamp =
    payload.date && payload.time ? `${payload.date} ${payload.time}` : new Date().toLocaleString();

  const lines = [
    `${emoji} <b>${escapeHtml(sender)}</b>`,
    `<code>${escapeHtml(normalizePhone(payload.from))}</code>`,
    "",
    escapeHtml(payload.body),
    "",
    `<i>${escapeHtml(timestamp)}</i>`,
  ];

  if (isSpam) {
    lines.push("", "<i>\u{26A0}\u{FE0F} Flagged as likely spam</i>");
  }

  return lines.join("\n");
}

let readyLogged = false;

export function createTaskerSmsWebhookHandler(config: TaskerSmsConfig) {
  const expectedToken = config.webhookToken || null;
  const tg: TelegramConfig = {
    botToken: config.telegramBotToken,
    chatId: config.telegramChatId,
  };

  if (!readyLogged) {
    console.log(`[tasker-sms] Ready -- forwarding SMS to Telegram group ${tg.chatId}`);
    readyLogged = true;
  }

  return async function handleTaskerSmsWebhook(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    if (tryHandleAdmin(req, res)) return true;

    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== WEBHOOK_PATH) return false;

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.end("Method Not Allowed");
      return true;
    }

    if (expectedToken) {
      const provided = (req.headers["x-tasker-token"] as string | undefined) ?? "";
      if (!provided || !safeTokenCompare(provided, expectedToken)) {
        sendJson(res, 401, { error: "unauthorized" });
        return true;
      }
    }

    const bodyResult = await readJsonBodyWithLimit(req, { maxBytes: 10 * 1024 * 1024 });
    if (!bodyResult.ok) {
      sendJson(res, 400, { error: bodyResult.error });
      return true;
    }

    if (!isTaskerSmsPayload(bodyResult.value)) {
      sendJson(res, 400, { error: "invalid payload: requires 'from' and 'body' fields" });
      return true;
    }

    const payload = bodyResult.value;

    if (shouldIgnoreMessage(payload.body)) {
      console.log(`[tasker-sms] Filtered out: ${payload.body.substring(0, 50)}`);
      sendJson(res, 200, { ok: true, filtered: true });
      return true;
    }

    const spam = isLikelySpam(payload.from, payload.body, payload.senderName);
    if (spam) {
      console.log(`[tasker-sms] Spam detected from ${payload.from}`);
    }

    console.log(
      `[tasker-sms] ${spam ? "SPAM " : ""}SMS from ${payload.from} (name: ${JSON.stringify(payload.senderName)}): ${payload.body.substring(0, 80)}`,
    );

    const threadId = await getOrCreateThread(tg, payload.from, payload.senderName);
    const telegramText = formatSmsForTelegram(payload, spam);

    if (threadId) {
      const { ok, threadId: finalThreadId } = await handleSendWithRecreate(
        tg,
        payload.from,
        payload.senderName,
        threadId,
        (tid) =>
          telegramApi(tg, "sendMessage", {
            chat_id: tg.chatId,
            text: telegramText,
            parse_mode: "HTML",
            disable_notification: spam,
            message_thread_id: tid,
          }),
      );

      if (ok) {
        incrementMessageCount(payload.from);
        console.log(`[tasker-sms] Forwarded to Telegram (thread ${finalThreadId})`);
      } else {
        console.error("[tasker-sms] Failed to forward to Telegram");
      }

      const hasImages =
        payload.imageBase64 || payload.imageUrl || (payload.mmsImages && payload.mmsImages.length > 0);
      let imagesSent = 0;
      if (hasImages) {
        imagesSent = await forwardMmsImages(tg, payload, finalThreadId);
        console.log(`[tasker-sms] Forwarded ${imagesSent} MMS image(s)`);
      }

      sendJson(res, 200, { ok: true, forwarded: ok, spam, threadId: finalThreadId, imagesSent });
    } else {
      // No thread could be created -- send without thread
      const result = await telegramApi(tg, "sendMessage", {
        chat_id: tg.chatId,
        text: telegramText,
        parse_mode: "HTML",
        disable_notification: spam,
      });
      sendJson(res, 200, { ok: true, forwarded: result.ok, spam, threadId: null });
    }

    return true;
  };
}
