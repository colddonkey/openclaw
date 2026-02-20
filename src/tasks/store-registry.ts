/**
 * Shared singleton registry for multi-agent OS stores.
 *
 * All runtime code should use these getters instead of constructing
 * stores directly. This guarantees that the scheduler, autonomy service,
 * gateway WebSocket handlers, agent tools, and hooks all share the same
 * SQLite connections — which means EventEmitter subscriptions on one
 * store instance are visible everywhere.
 *
 * Tests that need isolated `:memory:` stores should keep constructing
 * their own instances directly.
 */

import path from "node:path";
import { loadConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { CommsStore } from "../comms/store.js";
import { AgentIdentityStore } from "./agent-identity.js";
import { TaskStore } from "./store.js";

let _taskStore: TaskStore | null = null;
let _identityStore: AgentIdentityStore | null = null;
let _commsStore: CommsStore | null = null;
let _basePath: string | null = null;

/**
 * Resolve the base directory for all multi-agent OS SQLite databases.
 * Respects `multiAgentOs.dbPath` from config, falling back to
 * `~/.openclaw/tasks/`.
 */
function resolveBasePath(): string {
  if (_basePath) return _basePath;
  const cfg = loadConfig();
  _basePath = cfg.multiAgentOs?.dbPath
    ? path.dirname(cfg.multiAgentOs.dbPath)
    : path.join(resolveStateDir(), "tasks");
  return _basePath;
}

export function getSharedTaskStore(): TaskStore {
  if (!_taskStore) {
    _taskStore = new TaskStore(path.join(resolveBasePath(), "tasks.sqlite"));
  }
  return _taskStore;
}

export function getSharedIdentityStore(): AgentIdentityStore {
  if (!_identityStore) {
    _identityStore = new AgentIdentityStore(path.join(resolveBasePath(), "identities.sqlite"));
  }
  return _identityStore;
}

export function getSharedCommsStore(): CommsStore {
  if (!_commsStore) {
    _commsStore = new CommsStore(path.join(resolveBasePath(), "comms.sqlite"));
  }
  return _commsStore;
}

/**
 * Tear down all shared store singletons. Call on gateway shutdown
 * or in tests that need a clean slate.
 */
export function resetSharedStores(): void {
  if (_taskStore) {
    try { _taskStore.close(); } catch {}
  }
  if (_identityStore) {
    try { _identityStore.close(); } catch {}
  }
  if (_commsStore) {
    try { _commsStore.close(); } catch {}
  }
  _taskStore = null;
  _identityStore = null;
  _commsStore = null;
  _basePath = null;
}
