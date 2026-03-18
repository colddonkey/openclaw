/**
 * Local file-based store for phone -> Telegram forum thread mapping.
 * Stored at ~/.openclaw/tasker-sms-threads.json
 *
 * On first load, auto-migrates from the legacy sms-bridge format
 * (~/.openclaw/workspace/jafr-comms-topics.json) if present.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type ThreadEntry = {
  phone: string;
  name?: string;
  threadId: number;
  isSpam?: boolean;
  messageCount?: number;
  needsNameResolution?: boolean;
  createdAt: string;
  lastMessageAt: string;
};

type ThreadStore = Record<string, ThreadEntry>;

const STORE_DIR = join(homedir(), ".openclaw");
const STORE_PATH = join(STORE_DIR, "tasker-sms-threads.json");
const LEGACY_PATH = join(homedir(), ".openclaw", "workspace", "jafr-comms-topics.json");

let cache: ThreadStore | null = null;
let migrationDone = false;

type LegacyContact = {
  name?: string;
  topic_id?: number;
  created?: string;
  message_count?: number;
  needs_name_resolution?: boolean;
};

type LegacyMapping = {
  version?: number;
  supergroup_id?: string;
  contacts: Record<string, LegacyContact>;
};

function migrateLegacyStore(existing: ThreadStore): ThreadStore {
  if (migrationDone) return existing;
  migrationDone = true;

  if (!existsSync(LEGACY_PATH)) return existing;

  try {
    const raw = readFileSync(LEGACY_PATH, "utf-8");
    const legacy = JSON.parse(raw) as LegacyMapping;
    if (!legacy.contacts) return existing;

    let imported = 0;
    const now = new Date().toISOString();

    for (const [phone, contact] of Object.entries(legacy.contacts)) {
      const key = normalizePhone(phone);
      if (existing[key]) continue;
      if (!contact.topic_id) continue;

      existing[key] = {
        phone: key,
        name: contact.name,
        threadId: contact.topic_id,
        messageCount: contact.message_count ?? 0,
        needsNameResolution: contact.needs_name_resolution,
        createdAt: contact.created ?? now,
        lastMessageAt: now,
      };
      imported++;
    }

    if (imported > 0) {
      console.log(`[tasker-sms] Migrated ${imported} contact(s) from legacy sms-bridge store`);
    }
    return existing;
  } catch (err) {
    console.warn("[tasker-sms] Legacy migration failed (non-fatal):", err);
    return existing;
  }
}

function loadStore(): ThreadStore {
  if (cache) return cache;
  try {
    const raw = readFileSync(STORE_PATH, "utf-8");
    cache = JSON.parse(raw) as ThreadStore;
  } catch {
    cache = {};
  }
  cache = migrateLegacyStore(cache);
  saveStore(cache);
  return cache;
}

function saveStore(store: ThreadStore): void {
  cache = store;
  try {
    mkdirSync(STORE_DIR, { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("[tasker-sms] Failed to save thread store:", err);
  }
}

/** Normalize phone to a consistent key (strip non-digits, ensure +1 prefix). */
export function normalizePhone(phone: string): string {
  let digits = phone.replace(/[^\d+]/g, "");
  if (digits.length === 10) digits = "+1" + digits;
  else if (digits.length === 11 && digits.startsWith("1")) digits = "+" + digits;
  else if (!digits.startsWith("+") && digits.length > 10) digits = "+" + digits;
  return digits;
}

export function getThread(phone: string): ThreadEntry | null {
  const store = loadStore();
  const key = normalizePhone(phone);
  return store[key] ?? null;
}

export function setThread(phone: string, entry: Omit<ThreadEntry, "phone">): void {
  const store = loadStore();
  const key = normalizePhone(phone);
  store[key] = { ...entry, phone: key };
  saveStore(store);
}

export function updateThreadTimestamp(phone: string): void {
  const store = loadStore();
  const key = normalizePhone(phone);
  const entry = store[key];
  if (entry) {
    entry.lastMessageAt = new Date().toISOString();
    saveStore(store);
  }
}

export function incrementMessageCount(phone: string): void {
  const store = loadStore();
  const key = normalizePhone(phone);
  const entry = store[key];
  if (entry) {
    entry.messageCount = (entry.messageCount ?? 0) + 1;
    entry.lastMessageAt = new Date().toISOString();
    saveStore(store);
  }
}

export function deleteThread(phone: string): boolean {
  const store = loadStore();
  const key = normalizePhone(phone);
  if (!store[key]) return false;
  delete store[key];
  saveStore(store);
  return true;
}

export function listContacts(): Array<{
  phone: string;
  name?: string;
  threadId: number;
  messageCount: number;
}> {
  const store = loadStore();
  return Object.values(store).map((e) => ({
    phone: e.phone,
    name: e.name,
    threadId: e.threadId,
    messageCount: e.messageCount ?? 0,
  }));
}

export function contactCount(): number {
  return Object.keys(loadStore()).length;
}
