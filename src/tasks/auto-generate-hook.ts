/**
 * Hook integration for auto task generation from conversations.
 *
 * Registers on message:received and message:sent internal hooks.
 * Extracts tasks from message content and creates them in the TaskStore.
 *
 * Maintains a rolling window of recent fingerprints to avoid duplicates
 * across consecutive messages in the same session.
 */

import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import {
  type InternalHookEvent,
  isMessageReceivedEvent,
  isMessageSentEvent,
  registerInternalHook,
  unregisterInternalHook,
} from "../hooks/internal-hooks.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { extractTasksFromText, fingerprint, toTaskCreateInputs, type ExtractionContext } from "./auto-generate.js";
import { TaskStore } from "./store.js";

const log = createSubsystemLogger("tasks:auto-generate");

const MAX_FINGERPRINT_CACHE = 500;
const FINGERPRINT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

type FingerprintEntry = {
  fp: string;
  ts: number;
};

let _store: TaskStore | null = null;
const recentFingerprints: FingerprintEntry[] = [];

function getStore(): TaskStore {
  if (!_store) {
    const dbPath = path.join(resolveStateDir(), "tasks", "tasks.sqlite");
    _store = new TaskStore(dbPath);
  }
  return _store;
}

function pruneOldFingerprints(): void {
  const cutoff = Date.now() - FINGERPRINT_WINDOW_MS;
  while (recentFingerprints.length > 0 && recentFingerprints[0]!.ts < cutoff) {
    recentFingerprints.shift();
  }
  while (recentFingerprints.length > MAX_FINGERPRINT_CACHE) {
    recentFingerprints.shift();
  }
}

function getRecentFingerprintSet(): Set<string> {
  pruneOldFingerprints();
  return new Set(recentFingerprints.map((e) => e.fp));
}

function addFingerprints(fps: string[]): void {
  const now = Date.now();
  for (const fp of fps) {
    recentFingerprints.push({ fp, ts: now });
  }
}

// Also dedup against recent DB tasks (last hour, source=conversation)
function getRecentDbFingerprints(store: TaskStore): Set<string> {
  try {
    const recent = store.list({
      source: "conversation",
      limit: 100,
      orderBy: "created_at",
      orderDir: "desc",
    });
    return new Set(recent.map((t) => fingerprint(t.title)));
  } catch {
    return new Set();
  }
}

async function handleMessage(event: InternalHookEvent): Promise<void> {
  let content: string | undefined;
  let ctx: ExtractionContext;

  if (isMessageReceivedEvent(event)) {
    content = event.context.content;
    ctx = {
      senderId: event.context.from,
      senderName: event.context.from,
      channelId: event.context.channelId,
      sessionKey: event.sessionKey,
      conversationId: event.context.conversationId,
    };
  } else if (isMessageSentEvent(event)) {
    content = event.context.content;
    ctx = {
      senderId: "system",
      senderName: "Agent",
      channelId: event.context.channelId,
      sessionKey: event.sessionKey,
      conversationId: event.context.conversationId,
    };
  } else {
    return;
  }

  if (!content || content.length < 10) return;

  try {
    const existing = getRecentFingerprintSet();
    const store = getStore();
    const dbFps = getRecentDbFingerprints(store);
    for (const fp of dbFps) existing.add(fp);

    const result = extractTasksFromText(content, existing);
    if (result.tasks.length === 0) return;

    const inputs = toTaskCreateInputs(result.tasks, ctx);
    let created = 0;

    for (const input of inputs) {
      try {
        store.create(input);
        created++;
      } catch (err) {
        log.error(`failed to create auto-generated task: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (created > 0) {
      addFingerprints(result.fingerprints);
      log.info(
        `auto-generated ${created} task(s) from ${isMessageReceivedEvent(event) ? "received" : "sent"} message (session: ${event.sessionKey})`,
      );
    }
  } catch (err) {
    log.error(
      `auto-generate hook failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── Registration ───────────────────────────────────────────────────

let registered = false;

/**
 * Register the auto task generation hooks.
 * Safe to call multiple times; only registers once.
 */
export function registerAutoTaskGenerationHooks(): void {
  if (registered) return;
  registerInternalHook("message:received", handleMessage);
  registerInternalHook("message:sent", handleMessage);
  registered = true;
  log.info("auto task generation hooks registered");
}

/**
 * Unregister the hooks (useful for testing or disabling the feature).
 */
export function unregisterAutoTaskGenerationHooks(): void {
  if (!registered) return;
  unregisterInternalHook("message:received", handleMessage);
  unregisterInternalHook("message:sent", handleMessage);
  registered = false;
  _store = null;
  recentFingerprints.length = 0;
  log.info("auto task generation hooks unregistered");
}

/**
 * Check if auto task generation is currently active.
 */
export function isAutoTaskGenerationActive(): boolean {
  return registered;
}

/** Reset internal state (for tests). */
export function resetAutoTaskGenerationState(): void {
  recentFingerprints.length = 0;
  _store = null;
}
