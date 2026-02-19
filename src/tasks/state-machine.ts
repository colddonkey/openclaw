/**
 * Task state machine — defines valid transitions and auto-transition rules.
 *
 * Manual transitions: explicit user/agent actions.
 * Auto transitions: triggered by dependency resolution (blocker completed).
 */

import type { TaskStatus } from "./types.js";

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  backlog: ["ready", "in_progress", "archived"],
  ready: ["in_progress", "backlog", "blocked", "archived"],
  in_progress: ["review", "done", "blocked", "ready", "archived"],
  blocked: ["ready", "in_progress", "backlog", "archived"],
  review: ["done", "in_progress", "blocked", "archived"],
  done: ["archived", "ready", "in_progress"],
  archived: ["backlog", "ready"],
};

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidTransitions(from: TaskStatus): TaskStatus[] {
  return VALID_TRANSITIONS[from] ?? [];
}

/**
 * Priority weights for sorting. Lower number = higher priority.
 */
export const PRIORITY_WEIGHT: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

/**
 * Status sort weights for board column ordering.
 */
export const STATUS_WEIGHT: Record<TaskStatus, number> = {
  in_progress: 0,
  blocked: 1,
  review: 2,
  ready: 3,
  backlog: 4,
  done: 5,
  archived: 6,
};

/**
 * Determine if a task's status should auto-transition based on its
 * blocker resolution state.
 *
 * - If a blocked task has all blockers done/archived -> move to ready
 * - If a ready/in_progress task gains a new unresolved blocker -> move to blocked
 */
export function resolveAutoTransition(
  currentStatus: TaskStatus,
  hasUnresolvedBlockers: boolean,
): TaskStatus | null {
  if (currentStatus === "blocked" && !hasUnresolvedBlockers) {
    return "ready";
  }
  if (
    (currentStatus === "ready" || currentStatus === "in_progress") &&
    hasUnresolvedBlockers
  ) {
    return "blocked";
  }
  return null;
}

/**
 * Statuses that count as "resolved" for dependency purposes.
 */
export function isResolvedStatus(status: TaskStatus): boolean {
  return status === "done" || status === "archived";
}

/**
 * Statuses that count as "active" (shows up on the board).
 */
export function isActiveStatus(status: TaskStatus): boolean {
  return (
    status === "ready" ||
    status === "in_progress" ||
    status === "blocked" ||
    status === "review"
  );
}
