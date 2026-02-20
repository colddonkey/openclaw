/**
 * Gateway WebSocket methods for the multi-agent task system.
 *
 * Methods:
 *   tasks.list    — List/filter tasks
 *   tasks.get     — Get task detail with dependencies/comments
 *   tasks.board   — Get board overview (status counts + active columns)
 *   tasks.update  — Update a task (status, assignee, priority, etc.)
 *   tasks.create  — Create a new task
 *   tasks.delete  — Delete a task
 *   tasks.comment — Add a comment to a task
 *
 * All methods are gated behind multiAgentOs.enabled.
 */

import { loadConfig } from "../../config/config.js";
import { isMultiAgentOsEnabled } from "../../tasks/feature-gate.js";
import { getSharedTaskStore } from "../../tasks/store-registry.js";
import type { TaskStore } from "../../tasks/store.js";
import type { TaskFilter, TaskStatus } from "../../tasks/types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function getStore(): TaskStore | null {
  const cfg = loadConfig();
  if (!isMultiAgentOsEnabled(cfg)) return null;
  return getSharedTaskStore();
}

function requireStore(respond: RespondFn): TaskStore | null {
  const store = getStore();
  if (!store) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "multiAgentOs is not enabled"));
    return null;
  }
  return store;
}

export const tasksHandlers: GatewayRequestHandlers = {
  "tasks.list": async ({ params, respond }) => {
    const store = requireStore(respond);
    if (!store) return;

    const filter: TaskFilter = {};
    if (typeof params.status === "string") filter.status = params.status as TaskStatus;
    if (Array.isArray(params.status)) filter.status = params.status as TaskStatus[];
    if (typeof params.assigneeId === "string") filter.assigneeId = params.assigneeId;
    if (typeof params.creatorId === "string") filter.creatorId = params.creatorId;
    if (typeof params.source === "string") filter.source = params.source;
    if (typeof params.search === "string") filter.search = params.search;
    if (Array.isArray(params.labels)) filter.labels = params.labels as string[];
    if (typeof params.limit === "number") filter.limit = params.limit;
    if (typeof params.offset === "number") filter.offset = params.offset;
    if (typeof params.orderBy === "string") filter.orderBy = params.orderBy as TaskFilter["orderBy"];
    if (typeof params.orderDir === "string") filter.orderDir = params.orderDir as TaskFilter["orderDir"];

    const tasks = store.list(filter);
    respond(true, { tasks, count: tasks.length });
  },

  "tasks.get": async ({ params, respond }) => {
    const store = requireStore(respond);
    if (!store) return;

    const id = typeof params.id === "string" ? params.id : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing params.id"));
      return;
    }

    const task = store.get(id);
    if (!task) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `task not found: ${id}`));
      return;
    }

    const dependencies = store.getDependencies(id);
    const comments = store.getComments(id);
    const events = store.getEvents(id, 20);

    respond(true, { task, dependencies, comments, events });
  },

  "tasks.board": async ({ respond }) => {
    const store = requireStore(respond);
    if (!store) return;

    const counts = store.getStatusCounts();
    const columns: Record<string, unknown[]> = {};

    const activeStatuses: TaskStatus[] = ["in_progress", "blocked", "review", "ready"];
    for (const status of activeStatuses) {
      const tasks = store.list({ status, limit: 20, orderBy: "priority", orderDir: "asc" });
      columns[status] = tasks.map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        assigneeId: t.assigneeId,
        assigneeName: t.assigneeName,
        labels: t.labels,
        updatedAt: t.updatedAt,
      }));
    }

    respond(true, { counts, columns });
  },

  "tasks.create": async ({ params, respond, context }) => {
    const store = requireStore(respond);
    if (!store) return;

    const title = typeof params.title === "string" ? params.title.trim() : "";
    if (!title) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing params.title"));
      return;
    }

    const task = store.create({
      title,
      description: typeof params.description === "string" ? params.description : "",
      status: typeof params.status === "string" ? (params.status as TaskStatus) : undefined,
      priority: typeof params.priority === "string" ? (params.priority as any) : undefined,
      assigneeId: typeof params.assigneeId === "string" ? params.assigneeId : undefined,
      assigneeName: typeof params.assigneeName === "string" ? params.assigneeName : undefined,
      creatorId: typeof params.creatorId === "string" ? params.creatorId : "web-user",
      creatorName: typeof params.creatorName === "string" ? params.creatorName : "Web User",
      labels: Array.isArray(params.labels) ? (params.labels as string[]) : undefined,
      sessionKey: typeof params.sessionKey === "string" ? params.sessionKey : undefined,
      source: "web",
    });

    context.broadcast("tasks.changed", { action: "created", task });
    respond(true, { task });
  },

  "tasks.update": async ({ params, respond, context }) => {
    const store = requireStore(respond);
    if (!store) return;

    const id = typeof params.id === "string" ? params.id : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing params.id"));
      return;
    }

    const actorId = typeof params.actorId === "string" ? params.actorId : "web-user";
    const actorName = typeof params.actorName === "string" ? params.actorName : "Web User";

    try {
      const update: Record<string, unknown> = {};
      if (typeof params.title === "string") update.title = params.title;
      if (typeof params.description === "string") update.description = params.description;
      if (typeof params.status === "string") update.status = params.status;
      if (typeof params.priority === "string") update.priority = params.priority;
      if (typeof params.type === "string") update.type = params.type;
      if (params.assigneeId !== undefined) update.assigneeId = params.assigneeId;
      if (params.assigneeName !== undefined) update.assigneeName = params.assigneeName;
      if (Array.isArray(params.labels)) update.labels = params.labels;

      const task = store.update(id, update, actorId, actorName);
      if (!task) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `task not found: ${id}`));
        return;
      }

      context.broadcast("tasks.changed", { action: "updated", task });
      respond(true, { task });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  "tasks.delete": async ({ params, respond, context }) => {
    const store = requireStore(respond);
    if (!store) return;

    const id = typeof params.id === "string" ? params.id : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing params.id"));
      return;
    }

    const deleted = store.delete(id);
    if (!deleted) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `task not found: ${id}`));
      return;
    }

    context.broadcast("tasks.changed", { action: "deleted", taskId: id });
    respond(true, { deleted: true });
  },

  "tasks.comment": async ({ params, respond, context }) => {
    const store = requireStore(respond);
    if (!store) return;

    const taskId = typeof params.taskId === "string" ? params.taskId : "";
    const text = typeof params.text === "string" ? params.text.trim() : "";
    if (!taskId || !text) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing params.taskId or params.text"));
      return;
    }

    const authorId = typeof params.authorId === "string" ? params.authorId : "web-user";
    const authorName = typeof params.authorName === "string" ? params.authorName : "Web User";

    try {
      const comment = store.addComment(taskId, authorId, authorName, text);
      context.broadcast("tasks.changed", { action: "commented", taskId, comment });
      respond(true, { comment });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
};
