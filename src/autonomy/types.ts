/**
 * Types for the agent autonomy system.
 *
 * Agents operate in a continuous loop:
 *   1. Observe: check assigned tasks, comms, system state
 *   2. Decide: pick what to work on, what to say, what to create
 *   3. Act: execute work, send messages, update tasks
 *   4. Reflect: update identity, log progress, generate follow-up tasks
 */

import type { AgentIdentity } from "../tasks/agent-identity.js";
import type { Task } from "../tasks/types.js";
import type { Channel, Message } from "../comms/types.js";

// ── Agent State Machine ─────────────────────────────────────────────

export type AgentPhase =
  | "idle"          // No assigned tasks, waiting for work
  | "planning"      // Analyzing task, breaking into steps
  | "working"       // Actively executing on a task
  | "reporting"     // Sharing progress/results
  | "reflecting"    // Updating identity, generating follow-ups
  | "communicating" // Responding to messages, coordinating
  | "paused"        // Manually paused by operator
  | "error";        // Encountered an unrecoverable error

export type AgentState = {
  agentId: string;
  phase: AgentPhase;
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  /** Steps planned for the current task. */
  workPlan: WorkStep[];
  /** Index of the current step being executed. */
  currentStepIndex: number;
  /** Timestamp of last phase transition. */
  phaseChangedAt: number;
  /** Number of work cycles completed in this session. */
  cyclesCompleted: number;
  /** Consecutive errors (resets on success). */
  errorCount: number;
  /** Last error message. */
  lastError: string | null;
  /** Timestamp of session start. */
  sessionStartedAt: number;
  /** Timestamp of last completed tick. */
  lastTickAt: number | null;
};

// ── Work Planning ───────────────────────────────────────────────────

export type WorkStep = {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "done" | "skipped" | "failed";
  output: string | null;
  startedAt: number | null;
  completedAt: number | null;
};

export type WorkPlan = {
  taskId: string;
  taskTitle: string;
  steps: WorkStep[];
  estimatedMinutes: number;
  reasoning: string;
};

// ── Decision Context ────────────────────────────────────────────────

export type DecisionContext = {
  agent: AgentIdentity;
  state: AgentState;
  assignedTasks: Task[];
  /** Tasks in triage status assigned to this agent (need planning). */
  triageTasks: Task[];
  unreadMessages: Array<{ channel: Channel; messages: Message[] }>;
  recentSystemEvents: string[];
  currentLoad: number;
  maxConcurrent: number;
};

export type Decision =
  | { type: "pick_task"; taskId: string; reason: string }
  | { type: "triage_task"; taskId: string; reason: string }
  | { type: "continue_work"; stepIndex: number }
  | { type: "complete_task"; taskId: string; summary: string }
  | { type: "complete_triage"; taskId: string; plan: string; subtasks: Array<{ title: string; description: string }> }
  | { type: "report_progress"; channelId: string; text: string }
  | { type: "respond_message"; channelId: string; messageId: string; text: string }
  | { type: "create_subtask"; parentId: string; title: string; description: string }
  | { type: "ask_for_help"; channelId: string; text: string }
  | { type: "block_task"; taskId: string; reason: string }
  | { type: "idle"; reason: string }
  | { type: "reflect"; reflection: string };

// ── Work Cycle Result ───────────────────────────────────────────────

export type WorkCycleResult = {
  agentId: string;
  phase: AgentPhase;
  decision: Decision;
  durationMs: number;
  tasksCompleted: number;
  messagesPosted: number;
  subtasksCreated: number;
  errors: string[];
};

// ── Autonomy Config ─────────────────────────────────────────────────

export type AutonomyConfig = {
  /** Enable the autonomy loop. Default: false (must be explicitly enabled). */
  enabled?: boolean;
  /** How often each agent's loop ticks, in milliseconds. Default: 3600000 (1 hour). */
  tickIntervalMs?: number;
  /** Max consecutive errors before an agent is paused. Default: 5. */
  maxConsecutiveErrors?: number;
  /** Max work cycles per session before forced pause. Default: 100. */
  maxCyclesPerSession?: number;
  /** Cooldown between task completions in ms. Default: 2000. */
  completionCooldownMs?: number;
  /** Agent IDs to activate. Empty = all registered agents. */
  activeAgents?: string[];
  /** Model for lightweight actions (chat, reflection, triage summaries). */
  lightModel?: string;
  /** Model for heavy work (task execution, code changes). */
  workModel?: string;
};
