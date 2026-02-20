/**
 * SQLite-backed task store with dependency-aware state machine.
 *
 * Uses Node's built-in SQLite (node:sqlite via requireNodeSqlite).
 * Stores tasks, dependencies, comments, and event history.
 * Auto-transitions: when a blocker completes, blocked tasks move to ready.
 */

import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { requireNodeSqlite } from "../memory/sqlite.js";
import { isResolvedStatus, isValidTransition, resolveAutoTransition } from "./state-machine.js";
import type {
  Task,
  TaskComment,
  TaskCreateInput,
  TaskDependency,
  TaskDependencyType,
  TaskEvent,
  TaskFilter,
  TaskStatus,
  TaskType,
  TaskUpdateInput,
} from "./types.js";

const log = createSubsystemLogger("tasks");

function generateId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateCommentId(): string {
  return `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'backlog',
      priority TEXT NOT NULL DEFAULT 'medium',
      type TEXT NOT NULL DEFAULT 'task',
      assignee_id TEXT,
      assignee_name TEXT,
      creator_id TEXT NOT NULL,
      creator_name TEXT NOT NULL,
      labels TEXT NOT NULL DEFAULT '[]',
      session_key TEXT,
      parent_id TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      estimate_minutes INTEGER,
      triage_plan TEXT,
      triaged_at INTEGER
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id TEXT NOT NULL,
      depends_on_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'blocked_by',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (task_id, depends_on_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (depends_on_id) REFERENCES tasks(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      detail TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
  `);

  // Migrations: add columns that may not exist in older databases.
  const colCheck = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get() as { sql: string } | undefined;
  const tableSql = colCheck?.sql ?? "";
  if (!tableSql.includes("type TEXT")) {
    db.exec("ALTER TABLE tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'task'");
  }
  if (!tableSql.includes("triage_plan")) {
    db.exec("ALTER TABLE tasks ADD COLUMN triage_plan TEXT");
  }
  if (!tableSql.includes("triaged_at")) {
    db.exec("ALTER TABLE tasks ADD COLUMN triaged_at INTEGER");
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_deps_task ON task_dependencies(task_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_deps_dep ON task_dependencies(depends_on_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id);`);
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    status: row.status as TaskStatus,
    priority: row.priority as Task["priority"],
    type: (row.type as TaskType) || "task",
    assigneeId: (row.assignee_id as string) || null,
    assigneeName: (row.assignee_name as string) || null,
    creatorId: row.creator_id as string,
    creatorName: row.creator_name as string,
    labels: JSON.parse((row.labels as string) || "[]"),
    sessionKey: (row.session_key as string) || null,
    parentId: (row.parent_id as string) || null,
    source: row.source as string,
    metadata: JSON.parse((row.metadata as string) || "{}"),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    startedAt: (row.started_at as number) || null,
    completedAt: (row.completed_at as number) || null,
    estimateMinutes: (row.estimate_minutes as number) || null,
    triagePlan: (row.triage_plan as string) || null,
    triagedAt: (row.triaged_at as number) || null,
  };
}

export class TaskStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const sqlite = requireNodeSqlite();
    this.db = new sqlite.DatabaseSync(dbPath);
    ensureSchema(this.db);
    log.info(`task store opened: ${dbPath}`);
  }

  close(): void {
    this.db.close();
  }

  // ── CRUD ──────────────────────────────────────────────────────────

  create(input: TaskCreateInput): Task {
    const now = Date.now();
    const id = generateId();
    const taskType = input.type ?? "task";
    // Stories and epics default to triage; quick_fix defaults to ready; task defaults to backlog.
    const defaultStatus = taskType === "quick_fix" ? "ready"
      : (taskType === "story" || taskType === "epic") ? "triage"
      : "backlog";
    const status = input.status ?? defaultStatus;

    this.db.prepare(`
      INSERT INTO tasks (
        id, title, description, status, priority, type,
        assignee_id, assignee_name, creator_id, creator_name,
        labels, session_key, parent_id, source, metadata,
        created_at, updated_at, started_at, completed_at, estimate_minutes,
        triage_plan, triaged_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
      )
    `).run(
      id,
      input.title,
      input.description ?? "",
      status,
      input.priority ?? "medium",
      taskType,
      input.assigneeId ?? null,
      input.assigneeName ?? null,
      input.creatorId,
      input.creatorName,
      JSON.stringify(input.labels ?? []),
      input.sessionKey ?? null,
      input.parentId ?? null,
      input.source ?? "manual",
      JSON.stringify(input.metadata ?? {}),
      now,
      now,
      status === "in_progress" ? now : null,
      null,
      input.estimateMinutes ?? null,
      null,
      null,
    );

    this.recordEvent({
      taskId: id,
      type: "created",
      actorId: input.creatorId,
      actorName: input.creatorName,
      newValue: status,
      detail: input.title,
    });

    if (input.blockedBy?.length) {
      for (const blockerId of input.blockedBy) {
        this.addDependency(id, blockerId, "blocked_by");
      }
      this.checkAutoTransition(id, input.creatorId, input.creatorName);
    }

    return this.get(id)!;
  }

  get(id: string): Task | null {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? rowToTask(row) : null;
  }

  update(id: string, input: TaskUpdateInput, actorId: string, actorName: string): Task | null {
    const existing = this.get(id);
    if (!existing) return null;

    const now = Date.now();
    const sets: string[] = ["updated_at = ?"];
    const values: (string | number | null)[] = [now];

    if (input.title !== undefined) {
      sets.push("title = ?");
      values.push(input.title);
    }
    if (input.description !== undefined) {
      sets.push("description = ?");
      values.push(input.description);
    }
    if (input.priority !== undefined) {
      sets.push("priority = ?");
      values.push(input.priority);
    }
    if (input.assigneeId !== undefined) {
      sets.push("assignee_id = ?");
      values.push(input.assigneeId);
      sets.push("assignee_name = ?");
      values.push(input.assigneeName ?? null);
      if (input.assigneeId !== existing.assigneeId) {
        this.recordEvent({
          taskId: id,
          type: "assignment",
          actorId,
          actorName,
          oldValue: existing.assigneeId ?? undefined,
          newValue: input.assigneeId ?? undefined,
        });
      }
    }
    if (input.labels !== undefined) {
      sets.push("labels = ?");
      values.push(JSON.stringify(input.labels));
    }
    if (input.sessionKey !== undefined) {
      sets.push("session_key = ?");
      values.push(input.sessionKey);
    }
    if (input.metadata !== undefined) {
      sets.push("metadata = ?");
      values.push(JSON.stringify(input.metadata));
    }
    if (input.estimateMinutes !== undefined) {
      sets.push("estimate_minutes = ?");
      values.push(input.estimateMinutes);
    }
    if (input.type !== undefined) {
      sets.push("type = ?");
      values.push(input.type);
    }
    if (input.triagePlan !== undefined) {
      sets.push("triage_plan = ?");
      values.push(input.triagePlan);
    }

    if (input.status !== undefined && input.status !== existing.status) {
      if (!isValidTransition(existing.status, input.status)) {
        throw new Error(
          `invalid task transition: ${existing.status} -> ${input.status} (task ${id})`,
        );
      }
      sets.push("status = ?");
      values.push(input.status);

      if (input.status === "in_progress" && !existing.startedAt) {
        sets.push("started_at = ?");
        values.push(now);
      }
      if (isResolvedStatus(input.status) && !existing.completedAt) {
        sets.push("completed_at = ?");
        values.push(now);
      }
      if (existing.status === "triage" && input.status !== "triage" && !existing.triagedAt) {
        sets.push("triaged_at = ?");
        values.push(now);
      }

      this.recordEvent({
        taskId: id,
        type: "status_change",
        actorId,
        actorName,
        oldValue: existing.status,
        newValue: input.status,
      });
    }

    values.push(id);
    this.db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...values);

    // If this task was resolved, check if any tasks that were blocked_by it can auto-transition.
    if (input.status && isResolvedStatus(input.status) && !isResolvedStatus(existing.status)) {
      this.cascadeBlockerResolution(id, actorId, actorName);
    }

    return this.get(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
    if (result.changes > 0) {
      this.db.prepare(`DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_id = ?`).run(id, id);
      this.db.prepare(`DELETE FROM task_comments WHERE task_id = ?`).run(id);
      this.db.prepare(`DELETE FROM task_history WHERE task_id = ?`).run(id);
      return true;
    }
    return false;
  }

  list(filter?: TaskFilter): Task[] {
    const conditions: string[] = [];
    const params: (string | number | null)[] = [];

    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    }
    if (filter?.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      conditions.push(`type IN (${types.map(() => "?").join(", ")})`);
      params.push(...types);
    }
    if (filter?.assigneeId) {
      conditions.push("assignee_id = ?");
      params.push(filter.assigneeId);
    }
    if (filter?.creatorId) {
      conditions.push("creator_id = ?");
      params.push(filter.creatorId);
    }
    if (filter?.parentId !== undefined) {
      if (filter.parentId === null) {
        conditions.push("parent_id IS NULL");
      } else {
        conditions.push("parent_id = ?");
        params.push(filter.parentId);
      }
    }
    if (filter?.priority) {
      const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
      conditions.push(`priority IN (${priorities.map(() => "?").join(", ")})`);
      params.push(...priorities);
    }
    if (filter?.source) {
      conditions.push("source = ?");
      params.push(filter.source);
    }
    if (filter?.labels?.length) {
      for (const label of filter.labels) {
        conditions.push("labels LIKE ?");
        params.push(`%"${label}"%`);
      }
    }
    if (filter?.search) {
      conditions.push("(title LIKE ? OR description LIKE ?)");
      const searchTerm = `%${filter.search}%`;
      params.push(searchTerm, searchTerm);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const orderBy = filter?.orderBy ?? "created_at";
    const orderDir = filter?.orderDir ?? "desc";
    const orderCol =
      orderBy === "created_at" ? "created_at" :
      orderBy === "updated_at" ? "updated_at" :
      orderBy === "priority" ? "priority" :
      "status";

    const limit = filter?.limit ?? 100;
    const offset = filter?.offset ?? 0;

    const sql = `SELECT * FROM tasks ${where} ORDER BY ${orderCol} ${orderDir} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(rowToTask);
  }

  // ── Dependencies ─────────────────────────────────────────────────

  addDependency(taskId: string, dependsOnId: string, type: TaskDependencyType = "blocked_by"): void {
    if (taskId === dependsOnId) throw new Error("task cannot depend on itself");

    const now = Date.now();
    this.db.prepare(`
      INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id, type, created_at)
      VALUES (?, ?, ?, ?)
    `).run(taskId, dependsOnId, type, now);
  }

  removeDependency(taskId: string, dependsOnId: string): void {
    this.db.prepare(`
      DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?
    `).run(taskId, dependsOnId);
  }

  getDependencies(taskId: string): TaskDependency[] {
    const rows = this.db.prepare(`
      SELECT depends_on_id, type FROM task_dependencies WHERE task_id = ?
    `).all(taskId) as Array<{ depends_on_id: string; type: string }>;

    return rows.map((r) => ({
      taskId: r.depends_on_id,
      type: r.type as TaskDependencyType,
    }));
  }

  getDependents(taskId: string): TaskDependency[] {
    const rows = this.db.prepare(`
      SELECT task_id, type FROM task_dependencies WHERE depends_on_id = ?
    `).all(taskId) as Array<{ task_id: string; type: string }>;

    return rows.map((r) => ({
      taskId: r.task_id,
      type: r.type as TaskDependencyType,
    }));
  }

  hasUnresolvedBlockers(taskId: string): boolean {
    const deps = this.getDependencies(taskId)
      .filter((d) => d.type === "blocked_by");

    for (const dep of deps) {
      const blocker = this.get(dep.taskId);
      if (blocker && !isResolvedStatus(blocker.status)) {
        return true;
      }
    }
    return false;
  }

  // ── Comments ─────────────────────────────────────────────────────

  addComment(taskId: string, authorId: string, authorName: string, text: string): TaskComment {
    const id = generateCommentId();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO task_comments (id, task_id, author_id, author_name, text, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, taskId, authorId, authorName, text, now);

    this.recordEvent({
      taskId,
      type: "comment",
      actorId: authorId,
      actorName: authorName,
      detail: text.slice(0, 200),
    });

    return { id, taskId, authorId, authorName, text, createdAt: now };
  }

  getComments(taskId: string): TaskComment[] {
    const rows = this.db.prepare(`
      SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC
    `).all(taskId) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: r.id as string,
      taskId: r.task_id as string,
      authorId: r.author_id as string,
      authorName: r.author_name as string,
      text: r.text as string,
      createdAt: r.created_at as number,
    }));
  }

  // ── Events / History ─────────────────────────────────────────────

  getEvents(taskId: string, limit = 50): TaskEvent[] {
    const rows = this.db.prepare(`
      SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(taskId, limit) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: r.id as string,
      taskId: r.task_id as string,
      type: r.type as TaskEvent["type"],
      actorId: r.actor_id as string,
      actorName: r.actor_name as string,
      oldValue: (r.old_value as string) || undefined,
      newValue: (r.new_value as string) || undefined,
      detail: (r.detail as string) || undefined,
      createdAt: r.created_at as number,
    }));
  }

  // ── Statistics ────────────────────────────────────────────────────

  getStatusCounts(): Record<TaskStatus, number> {
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM tasks GROUP BY status
    `).all() as Array<{ status: string; count: number }>;

    const counts: Record<string, number> = {
      triage: 0, backlog: 0, ready: 0, in_progress: 0, blocked: 0,
      review: 0, done: 0, archived: 0,
    };
    for (const row of rows) {
      counts[row.status] = row.count;
    }
    return counts as Record<TaskStatus, number>;
  }

  // ── Internal: auto-transitions ───────────────────────────────────

  private checkAutoTransition(taskId: string, actorId: string, actorName: string): void {
    const task = this.get(taskId);
    if (!task) return;

    const hasBlockers = this.hasUnresolvedBlockers(taskId);
    const newStatus = resolveAutoTransition(task.status, hasBlockers);

    if (newStatus && newStatus !== task.status) {
      log.info(`auto-transition: ${taskId} ${task.status} -> ${newStatus}`);
      this.update(taskId, { status: newStatus }, actorId, actorName);
    }
  }

  /**
   * When a task is resolved (done/archived), find all tasks that were
   * blocked_by it and check if they can auto-transition to ready.
   */
  private cascadeBlockerResolution(resolvedTaskId: string, actorId: string, actorName: string): void {
    const dependents = this.getDependents(resolvedTaskId);
    for (const dep of dependents) {
      if (dep.type === "blocked_by") {
        continue;
      }
      // dep.taskId here is the task that depends on resolvedTaskId. 
      // But getDependents returns tasks where depends_on_id = resolvedTaskId,
      // meaning those tasks have resolvedTaskId as a blocker.
    }

    // Get all tasks that have resolvedTaskId as a blocker.
    const rows = this.db.prepare(`
      SELECT task_id FROM task_dependencies WHERE depends_on_id = ? AND type = 'blocked_by'
    `).all(resolvedTaskId) as Array<{ task_id: string }>;

    for (const row of rows) {
      this.checkAutoTransition(row.task_id, actorId, actorName);
    }
  }

  private recordEvent(params: {
    taskId: string;
    type: TaskEvent["type"];
    actorId: string;
    actorName: string;
    oldValue?: string;
    newValue?: string;
    detail?: string;
  }): void {
    const id = generateEventId();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO task_events (id, task_id, type, actor_id, actor_name, old_value, new_value, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.taskId,
      params.type,
      params.actorId,
      params.actorName,
      params.oldValue ?? null,
      params.newValue ?? null,
      params.detail ?? null,
      now,
    );
  }
}
