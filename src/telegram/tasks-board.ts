/**
 * Telegram kanban board renderer.
 *
 * Renders the task board as a formatted Telegram HTML message with inline
 * keyboards for quick task actions (status transitions, assignment, etc.).
 *
 * Telegram limits:
 * - Message text: 4096 chars
 * - callback_data: 64 bytes
 * - Inline keyboard: up to 100 buttons total
 */

import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { TaskStore } from "../tasks/store.js";
import { PRIORITY_WEIGHT, STATUS_WEIGHT } from "../tasks/state-machine.js";
import type { Task, TaskStatus } from "../tasks/types.js";
import type { TelegramInlineButton, TelegramInlineButtons } from "./button-types.js";

let _boardStore: TaskStore | null = null;

function getBoardStore(): TaskStore {
  if (!_boardStore) {
    const stateDir = resolveStateDir(process.env);
    _boardStore = new TaskStore(path.join(stateDir, "tasks", "tasks.sqlite"));
  }
  return _boardStore;
}

const STATUS_EMOJI: Record<TaskStatus, string> = {
  backlog: "[ ]",
  ready: "[R]",
  in_progress: "[>]",
  blocked: "[X]",
  review: "[?]",
  done: "[v]",
  archived: "[-]",
};

const PRIORITY_MARKER: Record<string, string> = {
  critical: "!!!",
  high: "!!",
  medium: "!",
  low: ".",
  none: "",
};

const COLUMN_HEADERS: Record<string, string> = {
  in_progress: "IN PROGRESS",
  blocked: "BLOCKED",
  review: "REVIEW",
  ready: "READY",
  backlog: "BACKLOG",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}..`;
}

function formatTaskLine(task: Task): string {
  const priority = PRIORITY_MARKER[task.priority] ?? "";
  const assignee = task.assigneeName ? ` @${task.assigneeName}` : "";
  const title = escapeHtml(truncate(task.title, 40));
  const id = task.id.slice(-6);
  return `${priority} <code>${id}</code> ${title}${assignee}`;
}

/**
 * Render the kanban board as a Telegram HTML message.
 */
export function renderBoardMessage(opts?: { maxPerColumn?: number }): {
  text: string;
  buttons: TelegramInlineButtons;
} {
  const store = getBoardStore();
  const counts = store.getStatusCounts();
  const maxPerCol = opts?.maxPerColumn ?? 5;

  const columns: Array<{ status: string; tasks: Task[] }> = [];
  for (const status of ["in_progress", "blocked", "review", "ready"] as const) {
    const tasks = store.list({ status, limit: maxPerCol });
    columns.push({ status, tasks });
  }

  const lines: string[] = [];
  lines.push("<b>TASK BOARD</b>");
  lines.push("");

  const totalActive =
    counts.in_progress + counts.blocked + counts.review + counts.ready;
  lines.push(
    `<i>${totalActive} active | ${counts.done} done | ${counts.backlog} backlog</i>`,
  );
  lines.push("");

  for (const col of columns) {
    const header = COLUMN_HEADERS[col.status] ?? col.status.toUpperCase();
    const count = counts[col.status as TaskStatus] ?? 0;
    lines.push(`<b>${STATUS_EMOJI[col.status as TaskStatus]} ${header}</b> (${count})`);

    if (col.tasks.length === 0) {
      lines.push("  <i>empty</i>");
    } else {
      for (const task of col.tasks) {
        lines.push(`  ${formatTaskLine(task)}`);
      }
      if (count > col.tasks.length) {
        lines.push(`  <i>+${count - col.tasks.length} more</i>`);
      }
    }
    lines.push("");
  }

  const buttons: TelegramInlineButtons = [
    [
      { text: "Refresh", callback_data: "tsk_brd" },
      { text: "My Tasks", callback_data: "tsk_my" },
    ],
    [
      { text: "Backlog", callback_data: "tsk_ls_backlog" },
      { text: "Done", callback_data: "tsk_ls_done" },
    ],
  ];

  return { text: lines.join("\n"), buttons };
}

/**
 * Render a task detail view with action buttons.
 */
export function renderTaskDetail(taskId: string): {
  text: string;
  buttons: TelegramInlineButtons;
} | null {
  const store = getBoardStore();
  const task = store.get(taskId);
  if (!task) return null;

  const deps = store.getDependencies(taskId);
  const comments = store.getComments(taskId);

  const lines: string[] = [];
  lines.push(`<b>${escapeHtml(task.title)}</b>`);
  lines.push(`<code>${task.id}</code>`);
  lines.push("");
  lines.push(`Status: <b>${task.status}</b>`);
  lines.push(`Priority: ${task.priority}`);
  if (task.assigneeName) lines.push(`Assigned: ${escapeHtml(task.assigneeName)}`);
  if (task.estimateMinutes) lines.push(`Estimate: ${task.estimateMinutes}m`);
  if (task.labels.length > 0) lines.push(`Labels: ${task.labels.join(", ")}`);

  if (task.description) {
    lines.push("");
    lines.push(escapeHtml(truncate(task.description, 200)));
  }

  if (deps.length > 0) {
    lines.push("");
    lines.push("<b>Dependencies:</b>");
    for (const dep of deps) {
      const depTask = store.get(dep.taskId);
      if (depTask) {
        lines.push(`  ${STATUS_EMOJI[depTask.status]} ${escapeHtml(truncate(depTask.title, 30))}`);
      }
    }
  }

  if (comments.length > 0) {
    lines.push("");
    lines.push(`<b>Comments (${comments.length}):</b>`);
    for (const c of comments.slice(-3)) {
      const time = new Date(c.createdAt).toLocaleTimeString();
      lines.push(`  ${escapeHtml(c.authorName)} (${time}): ${escapeHtml(truncate(c.text, 60))}`);
    }
  }

  const shortId = taskId.slice(-8);
  const statusButtons: TelegramInlineButton[] = [];

  if (task.status === "ready" || task.status === "backlog") {
    statusButtons.push({ text: "Start", callback_data: `tsk_mv_${shortId}_inp`, style: "primary" });
  }
  if (task.status === "in_progress") {
    statusButtons.push({ text: "Review", callback_data: `tsk_mv_${shortId}_rev` });
    statusButtons.push({ text: "Done", callback_data: `tsk_mv_${shortId}_don`, style: "success" });
    statusButtons.push({ text: "Block", callback_data: `tsk_mv_${shortId}_blk`, style: "danger" });
  }
  if (task.status === "blocked") {
    statusButtons.push({ text: "Unblock", callback_data: `tsk_mv_${shortId}_rdy` });
  }
  if (task.status === "review") {
    statusButtons.push({ text: "Done", callback_data: `tsk_mv_${shortId}_don`, style: "success" });
    statusButtons.push({ text: "Rework", callback_data: `tsk_mv_${shortId}_inp` });
  }

  const buttons: TelegramInlineButtons = [];
  if (statusButtons.length > 0) buttons.push(statusButtons);
  buttons.push([
    { text: "Back to Board", callback_data: "tsk_brd" },
  ]);

  return { text: lines.join("\n"), buttons };
}

/**
 * Render the "my tasks" view for a specific agent.
 */
export function renderMyTasks(agentId: string): {
  text: string;
  buttons: TelegramInlineButtons;
} {
  const store = getBoardStore();
  const tasks = store.list({
    assigneeId: agentId,
    status: ["ready", "in_progress", "blocked", "review"],
    limit: 15,
  });

  const lines: string[] = [];
  lines.push(`<b>MY TASKS</b> (${agentId})`);
  lines.push("");

  if (tasks.length === 0) {
    lines.push("<i>No active tasks assigned to you.</i>");
  } else {
    const grouped = new Map<string, Task[]>();
    for (const task of tasks) {
      const list = grouped.get(task.status) ?? [];
      list.push(task);
      grouped.set(task.status, list);
    }

    for (const [status, statusTasks] of grouped) {
      lines.push(`<b>${STATUS_EMOJI[status as TaskStatus]} ${(status as string).toUpperCase()}</b>`);
      for (const task of statusTasks) {
        lines.push(`  ${formatTaskLine(task)}`);
      }
      lines.push("");
    }
  }

  const buttons: TelegramInlineButtons = [
    [
      { text: "Board", callback_data: "tsk_brd" },
      { text: "Refresh", callback_data: "tsk_my" },
    ],
  ];

  return { text: lines.join("\n"), buttons };
}

/**
 * Render a filtered task list (for /tasks <status> or callback navigation).
 */
export function renderTaskList(status: TaskStatus): {
  text: string;
  buttons: TelegramInlineButtons;
} {
  const store = getBoardStore();
  const tasks = store.list({ status, limit: 15 });

  const lines: string[] = [];
  const header = COLUMN_HEADERS[status] ?? status.toUpperCase();
  lines.push(`<b>${header}</b> (${tasks.length})`);
  lines.push("");

  if (tasks.length === 0) {
    lines.push("<i>No tasks in this column.</i>");
  } else {
    for (const task of tasks) {
      lines.push(formatTaskLine(task));
    }
  }

  const buttons: TelegramInlineButtons = [
    [{ text: "Back to Board", callback_data: "tsk_brd" }],
  ];

  return { text: lines.join("\n"), buttons };
}

/**
 * Status code mapping for compact callback_data (64 byte limit).
 */
export const STATUS_CODES: Record<string, TaskStatus> = {
  bkl: "backlog",
  rdy: "ready",
  inp: "in_progress",
  blk: "blocked",
  rev: "review",
  don: "done",
  arc: "archived",
};

/**
 * Parse a task board callback_data string.
 * Returns the action type and any parameters.
 *
 * Patterns:
 * - tsk_brd              -> { action: "board" }
 * - tsk_my               -> { action: "my_tasks" }
 * - tsk_ls_<status>      -> { action: "list", status }
 * - tsk_vw_<shortId>     -> { action: "view", shortId }
 * - tsk_mv_<shortId>_<s> -> { action: "move", shortId, statusCode }
 */
export function parseTaskCallback(data: string): {
  action: string;
  status?: TaskStatus;
  shortId?: string;
  statusCode?: string;
} | null {
  if (!data.startsWith("tsk_")) return null;

  const rest = data.slice(4);

  if (rest === "brd") return { action: "board" };
  if (rest === "my") return { action: "my_tasks" };

  if (rest.startsWith("ls_")) {
    const statusKey = rest.slice(3);
    return { action: "list", status: statusKey as TaskStatus };
  }

  if (rest.startsWith("vw_")) {
    return { action: "view", shortId: rest.slice(3) };
  }

  if (rest.startsWith("mv_")) {
    const parts = rest.slice(3).split("_");
    if (parts.length === 2) {
      const [shortId, statusCode] = parts;
      const targetStatus = STATUS_CODES[statusCode!];
      if (targetStatus) {
        return { action: "move", shortId, statusCode, status: targetStatus };
      }
    }
  }

  return null;
}

/**
 * Find a task by the last N characters of its ID.
 * Used for compact callback_data references.
 */
export function findTaskByShortId(shortId: string): Task | null {
  const store = getBoardStore();
  const all = store.list({ limit: 200 });
  return all.find((t) => t.id.endsWith(shortId)) ?? null;
}

/**
 * Move a task to a new status (triggered by inline keyboard tap).
 * Returns the updated task or null if not found.
 */
export function moveTask(
  shortId: string,
  targetStatus: TaskStatus,
  actorId: string,
  actorName: string,
): Task | null {
  const task = findTaskByShortId(shortId);
  if (!task) return null;

  const store = getBoardStore();
  return store.update(task.id, { status: targetStatus }, actorId, actorName);
}
