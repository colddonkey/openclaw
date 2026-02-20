/**
 * SQLite-backed communication store for inter-agent messaging.
 *
 * Stores channels, messages, and membership. Each channel is a named room
 * with a kind (general, task, direct, system). Messages support text,
 * task references, and system notifications.
 */

import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { requireNodeSqlite } from "../memory/sqlite.js";
import type {
  Channel,
  ChannelCreateInput,
  ChannelMember,
  Message,
  MessageCreateInput,
  MessageFilter,
} from "./types.js";

const log = createSubsystemLogger("comms");

function generateChannelId(): string {
  return `ch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'general',
      description TEXT NOT NULL DEFAULT '',
      task_id TEXT,
      participants TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_message_at INTEGER,
      archived INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'text',
      text TEXT NOT NULL,
      task_ref TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      edited_at INTEGER,
      FOREIGN KEY (channel_id) REFERENCES channels(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_members (
      channel_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      member_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at INTEGER NOT NULL,
      last_read_at INTEGER,
      PRIMARY KEY (channel_id, member_id),
      FOREIGN KEY (channel_id) REFERENCES channels(id)
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(author_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_channels_kind ON channels(kind);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_channels_task ON channels(task_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_members_member ON channel_members(member_id);`);
}

function rowToChannel(row: Record<string, unknown>): Channel {
  return {
    id: row.id as string,
    name: row.name as string,
    kind: row.kind as Channel["kind"],
    description: row.description as string,
    taskId: (row.task_id as string) || null,
    participants: row.participants ? JSON.parse(row.participants as string) : null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    lastMessageAt: (row.last_message_at as number) || null,
    archived: Boolean(row.archived),
  };
}

function rowToMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    channelId: row.channel_id as string,
    authorId: row.author_id as string,
    authorName: row.author_name as string,
    kind: row.kind as Message["kind"],
    text: row.text as string,
    taskRef: (row.task_ref as string) || null,
    metadata: JSON.parse((row.metadata as string) || "{}"),
    createdAt: row.created_at as number,
    editedAt: (row.edited_at as number) || null,
  };
}

function rowToMember(row: Record<string, unknown>): ChannelMember {
  return {
    channelId: row.channel_id as string,
    memberId: row.member_id as string,
    memberName: row.member_name as string,
    role: row.role as ChannelMember["role"],
    joinedAt: row.joined_at as number,
    lastReadAt: (row.last_read_at as number) || null,
  };
}

export class CommsStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const sqlite = requireNodeSqlite();
    this.db = new sqlite.DatabaseSync(dbPath);
    ensureSchema(this.db);
    this.ensureDefaultChannels();
    log.info(`comms store opened: ${dbPath}`);
  }

  close(): void {
    this.db.close();
  }

  // ── Default channels ──────────────────────────────────────────────

  private ensureDefaultChannels(): void {
    const general = this.getChannelByName("general");
    if (!general) {
      this.createChannel({
        name: "general",
        kind: "general",
        description: "Main communication channel for all agents and operators",
      });
    }
    const system = this.getChannelByName("system");
    if (!system) {
      this.createChannel({
        name: "system",
        kind: "system",
        description: "System events and notifications",
      });
    }
  }

  // ── Channels ──────────────────────────────────────────────────────

  createChannel(input: ChannelCreateInput): Channel {
    const now = Date.now();
    const id = generateChannelId();

    this.db.prepare(`
      INSERT INTO channels (id, name, kind, description, task_id, participants, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.kind,
      input.description ?? "",
      input.taskId ?? null,
      input.participants ? JSON.stringify(input.participants) : null,
      now,
      now,
    );

    log.info(`channel created: ${input.name} (${input.kind})`);
    return this.getChannel(id)!;
  }

  getChannel(id: string): Channel | null {
    const row = this.db.prepare(`SELECT * FROM channels WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? rowToChannel(row) : null;
  }

  getChannelByName(name: string): Channel | null {
    const row = this.db.prepare(`SELECT * FROM channels WHERE name = ?`).get(name) as Record<string, unknown> | undefined;
    return row ? rowToChannel(row) : null;
  }

  getChannelForTask(taskId: string): Channel | null {
    const row = this.db.prepare(`SELECT * FROM channels WHERE task_id = ? AND kind = 'task'`).get(taskId) as Record<string, unknown> | undefined;
    return row ? rowToChannel(row) : null;
  }

  getOrCreateTaskChannel(taskId: string, taskTitle: string): Channel {
    const existing = this.getChannelForTask(taskId);
    if (existing) return existing;
    const truncatedTitle = taskTitle.length > 40 ? `${taskTitle.slice(0, 39)}...` : taskTitle;
    return this.createChannel({
      name: truncatedTitle,
      kind: "task",
      description: `Discussion for: ${taskTitle} (${taskId})`,
      taskId,
    });
  }

  getOrCreateDirectChannel(participantA: string, participantB: string, nameA: string, nameB: string): Channel {
    const sorted = [participantA, participantB].sort();
    const rows = this.db.prepare(`
      SELECT * FROM channels WHERE kind = 'direct' AND archived = 0
    `).all() as Record<string, unknown>[];

    for (const row of rows) {
      const ch = rowToChannel(row);
      if (ch.participants && ch.participants.length === 2) {
        const s = [...ch.participants].sort();
        if (s[0] === sorted[0] && s[1] === sorted[1]) return ch;
      }
    }

    return this.createChannel({
      name: `${nameA} & ${nameB}`,
      kind: "direct",
      participants: sorted,
    });
  }

  listChannels(opts?: { kind?: Channel["kind"]; includeArchived?: boolean }): Channel[] {
    const conditions: string[] = [];
    const params: (string | number | null)[] = [];

    if (opts?.kind) {
      conditions.push("kind = ?");
      params.push(opts.kind);
    }
    if (!opts?.includeArchived) {
      conditions.push("archived = 0");
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db.prepare(
      `SELECT * FROM channels ${where} ORDER BY last_message_at DESC NULLS LAST, created_at DESC`,
    ).all(...params) as Record<string, unknown>[];
    return rows.map(rowToChannel);
  }

  archiveChannel(id: string): void {
    this.db.prepare(`UPDATE channels SET archived = 1, updated_at = ? WHERE id = ?`).run(Date.now(), id);
  }

  // ── Messages ──────────────────────────────────────────────────────

  sendMessage(input: MessageCreateInput): Message {
    const now = Date.now();
    const id = generateMessageId();

    this.db.prepare(`
      INSERT INTO messages (id, channel_id, author_id, author_name, kind, text, task_ref, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.channelId,
      input.authorId,
      input.authorName,
      input.kind ?? "text",
      input.text,
      input.taskRef ?? null,
      JSON.stringify(input.metadata ?? {}),
      now,
    );

    this.db.prepare(`UPDATE channels SET last_message_at = ?, updated_at = ? WHERE id = ?`).run(now, now, input.channelId);

    return this.getMessage(id)!;
  }

  getMessage(id: string): Message | null {
    const row = this.db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? rowToMessage(row) : null;
  }

  editMessage(id: string, newText: string): Message | null {
    const now = Date.now();
    this.db.prepare(`UPDATE messages SET text = ?, edited_at = ? WHERE id = ?`).run(newText, now, id);
    return this.getMessage(id);
  }

  listMessages(filter?: MessageFilter): Message[] {
    const conditions: string[] = [];
    const params: (string | number | null)[] = [];

    if (filter?.channelId) {
      conditions.push("channel_id = ?");
      params.push(filter.channelId);
    }
    if (filter?.authorId) {
      conditions.push("author_id = ?");
      params.push(filter.authorId);
    }
    if (filter?.kind) {
      conditions.push("kind = ?");
      params.push(filter.kind);
    }
    if (filter?.since) {
      conditions.push("created_at > ?");
      params.push(filter.since);
    }
    if (filter?.before) {
      conditions.push("created_at < ?");
      params.push(filter.before);
    }
    if (filter?.search) {
      conditions.push("text LIKE ?");
      params.push(`%${filter.search}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter?.limit ?? 50;
    const offset = filter?.offset ?? 0;

    const rows = this.db.prepare(
      `SELECT * FROM messages ${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as Record<string, unknown>[];
    return rows.map(rowToMessage);
  }

  getRecentMessages(channelId: string, limit = 50): Message[] {
    const rows = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?
      ) sub ORDER BY created_at ASC
    `).all(channelId, limit) as Record<string, unknown>[];
    return rows.map(rowToMessage);
  }

  getUnreadCount(channelId: string, memberId: string): number {
    const member = this.getMember(channelId, memberId);
    if (!member || !member.lastReadAt) {
      const row = this.db.prepare(`SELECT COUNT(*) as count FROM messages WHERE channel_id = ?`).get(channelId) as { count: number };
      return row.count;
    }
    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM messages WHERE channel_id = ? AND created_at > ?`,
    ).get(channelId, member.lastReadAt) as { count: number };
    return row.count;
  }

  // ── Members ───────────────────────────────────────────────────────

  addMember(channelId: string, memberId: string, memberName: string, role: ChannelMember["role"] = "member"): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT OR REPLACE INTO channel_members (channel_id, member_id, member_name, role, joined_at, last_read_at)
      VALUES (?, ?, ?, ?, ?, NULL)
    `).run(channelId, memberId, memberName, role, now);
  }

  removeMember(channelId: string, memberId: string): void {
    this.db.prepare(`DELETE FROM channel_members WHERE channel_id = ? AND member_id = ?`).run(channelId, memberId);
  }

  getMember(channelId: string, memberId: string): ChannelMember | null {
    const row = this.db.prepare(
      `SELECT * FROM channel_members WHERE channel_id = ? AND member_id = ?`,
    ).get(channelId, memberId) as Record<string, unknown> | undefined;
    return row ? rowToMember(row) : null;
  }

  getMembers(channelId: string): ChannelMember[] {
    const rows = this.db.prepare(
      `SELECT * FROM channel_members WHERE channel_id = ? ORDER BY joined_at ASC`,
    ).all(channelId) as Record<string, unknown>[];
    return rows.map(rowToMember);
  }

  getChannelsForMember(memberId: string): Channel[] {
    const rows = this.db.prepare(`
      SELECT c.* FROM channels c
      INNER JOIN channel_members m ON c.id = m.channel_id
      WHERE m.member_id = ? AND c.archived = 0
      ORDER BY c.last_message_at DESC NULLS LAST
    `).all(memberId) as Record<string, unknown>[];
    return rows.map(rowToChannel);
  }

  markRead(channelId: string, memberId: string): void {
    const now = Date.now();
    this.db.prepare(
      `UPDATE channel_members SET last_read_at = ? WHERE channel_id = ? AND member_id = ?`,
    ).run(now, channelId, memberId);
  }

  // ── Stats ─────────────────────────────────────────────────────────

  getChannelStats(channelId: string): { messageCount: number; memberCount: number; lastMessageAt: number | null } {
    const msgs = this.db.prepare(
      `SELECT COUNT(*) as count FROM messages WHERE channel_id = ?`,
    ).get(channelId) as { count: number };
    const members = this.db.prepare(
      `SELECT COUNT(*) as count FROM channel_members WHERE channel_id = ?`,
    ).get(channelId) as { count: number };
    const ch = this.getChannel(channelId);
    return {
      messageCount: msgs.count,
      memberCount: members.count,
      lastMessageAt: ch?.lastMessageAt ?? null,
    };
  }
}
