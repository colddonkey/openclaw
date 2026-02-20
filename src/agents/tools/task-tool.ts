/**
 * Agent task tool — lets agents create, update, list, assign, and
 * comment on tasks in the task store. Also triggers identity updates
 * (skill/trait reinforcement) on task completion.
 */

import { Type } from "@sinclair/typebox";
import { getSharedIdentityStore, getSharedTaskStore } from "../../tasks/store-registry.js";
import type { TaskPriority, TaskStatus, TaskType } from "../../tasks/types.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { optionalStringEnum, stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, ToolInputError, jsonResult, readStringParam } from "./common.js";

const TASK_ACTIONS = [
  "create",
  "update",
  "get",
  "list",
  "assign",
  "comment",
  "add_dependency",
  "remove_dependency",
  "board",
  "my_tasks",
  "identity",
] as const;

const TASK_STATUSES = [
  "triage",
  "backlog",
  "ready",
  "in_progress",
  "blocked",
  "review",
  "done",
  "archived",
] as const;

const TASK_PRIORITIES = ["critical", "high", "medium", "low", "none"] as const;

const TASK_TYPES = ["quick_fix", "task", "story", "epic"] as const;

const TaskToolSchema = Type.Object({
  action: stringEnum(TASK_ACTIONS, {
    description:
      "Action to perform. " +
      "create: new task. update: modify task fields/status. get: single task details. " +
      "list: filtered task list. assign: assign task to an agent. comment: add a comment. " +
      "add_dependency/remove_dependency: manage blockers. board: kanban board summary. " +
      "my_tasks: tasks assigned to you. identity: view your emergent identity.",
  }),
  id: Type.Optional(Type.String({ description: "Task ID (for get/update/assign/comment/dependency actions)." })),
  title: Type.Optional(Type.String({ description: "Task title (create/update)." })),
  description: Type.Optional(Type.String({ description: "Task description (create/update)." })),
  status: optionalStringEnum(TASK_STATUSES, { description: "Task status (create/update). Stories/epics default to triage." }),
  priority: optionalStringEnum(TASK_PRIORITIES, { description: "Task priority (create/update)." }),
  type: optionalStringEnum(TASK_TYPES, { description: "Task type: quick_fix (no triage), task (default), story (needs planning), epic (large effort)." }),
  assigneeId: Type.Optional(Type.String({ description: "Agent ID to assign (assign action)." })),
  assigneeName: Type.Optional(Type.String({ description: "Display name of assignee." })),
  text: Type.Optional(Type.String({ description: "Comment text (comment action)." })),
  labels: Type.Optional(Type.Array(Type.String(), { description: "Labels (create/update/filter)." })),
  parentId: Type.Optional(Type.String({ description: "Parent task ID (create)." })),
  source: Type.Optional(Type.String({ description: "Task source: conversation, agent, cron, manual." })),
  blockedBy: Type.Optional(Type.Array(Type.String(), { description: "Task IDs that block this task (create)." })),
  dependsOnId: Type.Optional(Type.String({ description: "Task ID for dependency operations." })),
  search: Type.Optional(Type.String({ description: "Search text (list action)." })),
  estimateMinutes: Type.Optional(Type.Number({ description: "Estimated effort in minutes." })),
  limit: Type.Optional(Type.Number({ description: "Max results (list action, default 20)." })),
});

type TaskToolOptions = {
  agentSessionKey?: string;
  config?: Record<string, unknown>;
};

function getTaskStore() {
  return getSharedTaskStore();
}

function getIdentityStore() {
  return getSharedIdentityStore();
}

function resolveActorId(params: Record<string, unknown>, opts?: TaskToolOptions): string {
  if (opts?.agentSessionKey) {
    return resolveSessionAgentId({
      sessionKey: opts.agentSessionKey,
      config: opts.config as Record<string, unknown> | undefined,
    });
  }
  return "agent:main";
}

function resolveActorName(actorId: string): string {
  return actorId.replace(/^agent:/, "").replace(/-/g, " ");
}

export function createTaskTool(opts?: TaskToolOptions): AnyAgentTool {
  return {
    name: "tasks",
    label: "Tasks",
    description:
      "Manage tasks on the shared kanban board. Create, update, assign, comment on tasks. " +
      "Tasks have statuses (triage, backlog, ready, in_progress, blocked, review, done, archived), " +
      "types (quick_fix, task, story, epic), priorities, and dependencies. " +
      "Stories/epics start in triage and need planning before becoming ready. " +
      "Use 'board' for the kanban overview. Use 'my_tasks' for your assignments. " +
      "Use 'identity' to see your emergent skills and traits.",
    parameters: TaskToolSchema,
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      const action = readStringParam(params, "action", { required: true });
      const store = getTaskStore();
      const identities = getIdentityStore();
      const actorId = resolveActorId(params, opts);
      const actorName = resolveActorName(actorId);

      switch (action) {
        case "create": {
          const title = readStringParam(params, "title", { required: true });
          const task = store.create({
            title,
            description: readStringParam(params, "description") ?? "",
            status: params.status as TaskStatus | undefined,
            priority: (params.priority as TaskPriority) ?? "medium",
            type: (params.type as TaskType) ?? "task",
            assigneeId: readStringParam(params, "assigneeId"),
            assigneeName: readStringParam(params, "assigneeName"),
            creatorId: actorId,
            creatorName: actorName,
            labels: Array.isArray(params.labels) ? (params.labels as string[]) : undefined,
            parentId: readStringParam(params, "parentId"),
            source: readStringParam(params, "source") ?? "agent",
            blockedBy: Array.isArray(params.blockedBy) ? (params.blockedBy as string[]) : undefined,
            estimateMinutes: typeof params.estimateMinutes === "number" ? params.estimateMinutes : undefined,
          });

          identities.incrementStat(actorId, "tasksCreated");

          return jsonResult({
            created: true,
            task: {
              id: task.id,
              title: task.title,
              status: task.status,
              type: task.type,
              priority: task.priority,
              assigneeId: task.assigneeId,
            },
          });
        }

        case "update": {
          const id = readStringParam(params, "id", { required: true });
          const oldTask = store.get(id);
          if (!oldTask) throw new ToolInputError(`task not found: ${id}`);

          const updated = store.update(
            id,
            {
              title: readStringParam(params, "title"),
              description: readStringParam(params, "description"),
              status: params.status as TaskStatus | undefined,
              priority: params.priority as TaskPriority | undefined,
              type: params.type as TaskType | undefined,
              labels: Array.isArray(params.labels) ? (params.labels as string[]) : undefined,
              estimateMinutes: typeof params.estimateMinutes === "number" ? params.estimateMinutes : undefined,
            },
            actorId,
            actorName,
          );

          if (updated && params.status === "done" && oldTask.status !== "done") {
            identities.incrementStat(actorId, "tasksCompleted");

            for (const label of updated.labels) {
              identities.recordSkillUpdate(actorId, {
                domain: label,
                success: true,
                taskId: id,
              });
            }

            if (updated.estimateMinutes) {
              identities.incrementStat(actorId, "totalWorkMinutes", updated.estimateMinutes);
            }

            identities.reinforceTrait(actorId, {
              key: "productive",
              delta: 0.03,
              evidence: `completed: ${updated.title}`,
            });
          }

          return jsonResult({
            updated: true,
            task: updated
              ? {
                  id: updated.id,
                  title: updated.title,
                  status: updated.status,
                  priority: updated.priority,
                }
              : null,
          });
        }

        case "get": {
          const id = readStringParam(params, "id", { required: true });
          const task = store.get(id);
          if (!task) throw new ToolInputError(`task not found: ${id}`);

          const deps = store.getDependencies(id);
          const comments = store.getComments(id);
          const events = store.getEvents(id, 10);

          return jsonResult({
            task,
            dependencies: deps,
            comments: comments.map((c) => ({
              author: c.authorName,
              text: c.text,
              at: new Date(c.createdAt).toISOString(),
            })),
            recentEvents: events.map((e) => ({
              type: e.type,
              actor: e.actorName,
              from: e.oldValue,
              to: e.newValue,
              at: new Date(e.createdAt).toISOString(),
            })),
          });
        }

        case "list": {
          const tasks = store.list({
            status: params.status as TaskStatus | undefined,
            assigneeId: readStringParam(params, "assigneeId"),
            labels: Array.isArray(params.labels) ? (params.labels as string[]) : undefined,
            search: readStringParam(params, "search"),
            priority: params.priority as TaskPriority | undefined,
            parentId: readStringParam(params, "parentId"),
            limit: typeof params.limit === "number" ? params.limit : 20,
          });

          return jsonResult({
            count: tasks.length,
            tasks: tasks.map((t) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              priority: t.priority,
              assignee: t.assigneeName ?? t.assigneeId,
              labels: t.labels,
            })),
          });
        }

        case "assign": {
          const id = readStringParam(params, "id", { required: true });
          const assigneeId = readStringParam(params, "assigneeId", { required: true });
          const assigneeName = readStringParam(params, "assigneeName") ?? resolveActorName(assigneeId);

          const updated = store.update(
            id,
            { assigneeId, assigneeName },
            actorId,
            actorName,
          );

          if (!updated) throw new ToolInputError(`task not found: ${id}`);

          return jsonResult({
            assigned: true,
            task: { id: updated.id, title: updated.title, assignee: assigneeName },
          });
        }

        case "comment": {
          const id = readStringParam(params, "id", { required: true });
          const text = readStringParam(params, "text", { required: true });

          const comment = store.addComment(id, actorId, actorName, text);
          identities.incrementStat(actorId, "commentsGiven");

          return jsonResult({
            commented: true,
            comment: { id: comment.id, taskId: id, text: comment.text },
          });
        }

        case "add_dependency": {
          const id = readStringParam(params, "id", { required: true });
          const dependsOnId = readStringParam(params, "dependsOnId", { required: true });

          store.addDependency(id, dependsOnId, "blocked_by");

          return jsonResult({
            added: true,
            task: id,
            blockedBy: dependsOnId,
          });
        }

        case "remove_dependency": {
          const id = readStringParam(params, "id", { required: true });
          const dependsOnId = readStringParam(params, "dependsOnId", { required: true });

          store.removeDependency(id, dependsOnId);

          return jsonResult({
            removed: true,
            task: id,
            unblockedFrom: dependsOnId,
          });
        }

        case "board": {
          const counts = store.getStatusCounts();
          const inProgress = store.list({ status: "in_progress", limit: 10 });
          const blocked = store.list({ status: "blocked", limit: 10 });
          const ready = store.list({ status: "ready", limit: 10 });
          const review = store.list({ status: "review", limit: 10 });
          const triage = store.list({ status: "triage", limit: 10 });

          const brief = (t: { id: string; title: string; assigneeName: string | null; priority: string; type: string }) => ({
            id: t.id, title: t.title, assignee: t.assigneeName, priority: t.priority, type: t.type,
          });

          return jsonResult({
            board: {
              counts,
              columns: {
                triage: triage.map(brief),
                in_progress: inProgress.map(brief),
                blocked: blocked.map(brief),
                ready: ready.map(brief),
                review: review.map(brief),
              },
            },
          });
        }

        case "my_tasks": {
          const tasks = store.list({
            assigneeId: actorId,
            status: ["triage", "ready", "in_progress", "blocked", "review"],
            limit: 20,
          });

          return jsonResult({
            agentId: actorId,
            count: tasks.length,
            tasks: tasks.map((t) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              priority: t.priority,
              labels: t.labels,
            })),
          });
        }

        case "identity": {
          const agentId = readStringParam(params, "assigneeId") ?? actorId;
          const identity = identities.getOrCreate(agentId);
          const summary = identities.summarize(agentId);

          return jsonResult({
            agentId,
            summary,
            traits: identity.traits.slice(0, 10).map((t) => ({
              key: t.key,
              strength: Math.round(t.strength * 100),
            })),
            skills: identity.skills.slice(0, 10).map((s) => ({
              domain: s.domain,
              level: Math.round(s.level * 100),
              tasks: s.taskCount,
            })),
            stats: identity.stats,
            selfReflection: identity.selfReflection || null,
          });
        }

        default:
          throw new ToolInputError(`unknown action: ${action}`);
      }
    },
  };
}
