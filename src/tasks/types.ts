/**
 * Task Store types — the data model for OpenClaw's multi-agent task system.
 *
 * Tasks are small, atomic units of work that agents create, pick up, and
 * complete. They support dependency tracking with automatic state transitions
 * (blocked -> ready when all blockers resolve).
 */

export type TaskStatus =
  | "triage"
  | "backlog"
  | "ready"
  | "in_progress"
  | "blocked"
  | "review"
  | "done"
  | "archived";

export type TaskPriority = "critical" | "high" | "medium" | "low" | "none";

/**
 * Task complexity type. Determines the planning gate:
 *   - quick_fix: skip triage, go straight to ready
 *   - task: standard single-agent work unit
 *   - story: multi-step effort, may spawn subtasks during triage
 *   - epic: large cross-cutting effort, always requires triage planning
 */
export type TaskType = "quick_fix" | "task" | "story" | "epic";

export type TaskDependencyType = "blocked_by" | "blocks" | "parent" | "child" | "related";

export type TaskDependency = {
  taskId: string;
  type: TaskDependencyType;
};

export type TaskComment = {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: number;
};

export type TaskEvent = {
  id: string;
  taskId: string;
  type: "status_change" | "assignment" | "comment" | "dependency_added" | "dependency_removed" | "created" | "updated";
  actorId: string;
  actorName: string;
  oldValue?: string;
  newValue?: string;
  detail?: string;
  createdAt: number;
};

export type Task = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Complexity type governing the planning gate. Default: "task". */
  type: TaskType;
  assigneeId: string | null;
  assigneeName: string | null;
  creatorId: string;
  creatorName: string;
  labels: string[];
  /** Session key linked to this task's execution context. */
  sessionKey: string | null;
  /** Parent task ID for subtask hierarchies. */
  parentId: string | null;
  /** Source that generated this task (e.g. "conversation", "agent", "cron", "manual"). */
  source: string;
  /** Free-form metadata (serialized JSON). */
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  /** When the task entered in_progress. */
  startedAt: number | null;
  /** When the task was completed (done/archived). */
  completedAt: number | null;
  /** Estimated effort in minutes (optional, set by creator or agent). */
  estimateMinutes: number | null;
  /** Plan produced during triage (populated by the planning agent). */
  triagePlan: string | null;
  /** When triage was completed (agent moved task out of triage). */
  triagedAt: number | null;
};

export type TaskCreateInput = {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  type?: TaskType;
  assigneeId?: string;
  assigneeName?: string;
  creatorId: string;
  creatorName: string;
  labels?: string[];
  sessionKey?: string;
  parentId?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  estimateMinutes?: number;
  /** Task IDs that block this task. */
  blockedBy?: string[];
};

export type TaskUpdateInput = {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  type?: TaskType;
  assigneeId?: string | null;
  assigneeName?: string | null;
  labels?: string[];
  sessionKey?: string | null;
  metadata?: Record<string, unknown>;
  estimateMinutes?: number | null;
  triagePlan?: string | null;
};

export type TaskFilter = {
  status?: TaskStatus | TaskStatus[];
  type?: TaskType | TaskType[];
  assigneeId?: string;
  creatorId?: string;
  labels?: string[];
  parentId?: string | null;
  priority?: TaskPriority | TaskPriority[];
  source?: string;
  search?: string;
  limit?: number;
  offset?: number;
  orderBy?: "created_at" | "updated_at" | "priority" | "status";
  orderDir?: "asc" | "desc";
};

export type TaskStoreConfig = {
  enabled?: boolean;
  store?: {
    path?: string;
  };
};
