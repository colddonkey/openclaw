/**
 * Forum topic name cache for Telegram supergroups.
 *
 * Telegram Bot API messages don't include the topic name — only the numeric topic ID
 * (message_thread_id). This module listens for `forum_topic_created` / `forum_topic_edited`
 * service messages to build and persist a chatId:topicId → topicName mapping, so that
 * inbound metadata can include the human-readable topic name alongside the ID.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { logVerbose } from "../globals.js";

/** In-memory cache: "chatId:topicId" → topic name */
const topicNameCache = new Map<string, string>();

function cacheKey(chatId: string | number, topicId: number): string {
  return `${chatId}:${topicId}`;
}

function resolveCacheFilePath(): string {
  const base =
    process.env.OPENCLAW_STORE_DIR ??
    join(homedir(), ".openclaw");
  return join(base, "telegram-forum-topics.json");
}

let cacheLoaded = false;

function ensureCacheLoaded(): void {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const path = resolveCacheFilePath();
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
      for (const [key, name] of Object.entries(data)) {
        topicNameCache.set(key, name);
      }
      logVerbose(`telegram forum-topic-cache: loaded ${topicNameCache.size} entries`);
    }
  } catch (err) {
    logVerbose(`telegram forum-topic-cache: load failed: ${String(err)}`);
  }
}

function persistCache(): void {
  try {
    const path = resolveCacheFilePath();
    const dir = path.substring(0, path.lastIndexOf("/") !== -1 ? path.lastIndexOf("/") : path.lastIndexOf("\\"));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const data: Record<string, string> = {};
    for (const [key, name] of topicNameCache.entries()) {
      data[key] = name;
    }
    writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    logVerbose(`telegram forum-topic-cache: persist failed: ${String(err)}`);
  }
}

/**
 * Cache a forum topic name. Called when a `forum_topic_created` or `forum_topic_edited`
 * service message is received.
 */
export function cacheForumTopicName(
  chatId: string | number,
  topicId: number,
  name: string,
): void {
  ensureCacheLoaded();
  const key = cacheKey(chatId, topicId);
  const existing = topicNameCache.get(key);
  if (existing === name) return; // no-op
  topicNameCache.set(key, name);
  logVerbose(`telegram forum-topic-cache: cached "${name}" for ${key}`);
  persistCache();
}

/**
 * Look up a forum topic name by chat ID and topic ID.
 * Returns undefined if not yet cached (i.e., we've never seen the topic created/edited event).
 */
export function getForumTopicName(
  chatId: string | number,
  topicId: number,
): string | undefined {
  ensureCacheLoaded();
  return topicNameCache.get(cacheKey(chatId, topicId));
}
