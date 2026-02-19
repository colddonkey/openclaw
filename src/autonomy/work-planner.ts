/**
 * Work planner for autonomous agents.
 *
 * Given an agent's context (identity, assigned tasks, messages),
 * produces a Decision about what to do next. This is the agent's
 * "brain" — the decision-making core.
 *
 * Priority order:
 *   1. Respond to direct messages / mentions
 *   2. Continue in-progress work (resume current step)
 *   3. Pick highest-priority assigned task
 *   4. Generate reflection if idle for too long
 *   5. Go idle
 */

import type { Task } from "../tasks/types.js";
import type {
  AgentState,
  Decision,
  DecisionContext,
  WorkPlan,
  WorkStep,
} from "./types.js";

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

/**
 * Main decision function. Returns what the agent should do next.
 */
export function decide(ctx: DecisionContext): Decision {
  const { state, assignedTasks, unreadMessages } = ctx;

  if (state.phase === "paused") {
    return { type: "idle", reason: "Agent is paused" };
  }

  if (state.errorCount >= (ctx.maxConcurrent || 5)) {
    return { type: "idle", reason: "Too many consecutive errors — pausing" };
  }

  // 1. Check for unread messages that need a response
  const urgentMessage = findUrgentMessage(ctx);
  if (urgentMessage) {
    return urgentMessage;
  }

  // 2. If currently working on a task (planning or working phase), continue
  if (state.currentTaskId && (state.phase === "working" || state.phase === "planning")) {
    const currentTask = assignedTasks.find((t) => t.id === state.currentTaskId);
    if (currentTask) {
      return continueWork(state, currentTask);
    }
    // Task was unassigned or completed elsewhere
    return { type: "idle", reason: "Current task no longer assigned" };
  }

  // 3. Pick highest-priority assigned task
  const nextTask = pickNextTask(assignedTasks, state);
  if (nextTask) {
    return {
      type: "pick_task",
      taskId: nextTask.id,
      reason: buildPickReason(nextTask, ctx),
    };
  }

  // 4. If idle for a while, reflect
  const idleTime = Date.now() - state.phaseChangedAt;
  if (state.phase === "idle" && idleTime > 60_000 && state.cyclesCompleted > 0) {
    return {
      type: "reflect",
      reflection: generateIdleReflection(ctx),
    };
  }

  // 5. Nothing to do
  return { type: "idle", reason: "No assigned tasks" };
}

/**
 * Break a task into executable work steps.
 */
export function planWork(task: Task): WorkPlan {
  const steps: WorkStep[] = [];
  const now = Date.now();

  // Parse description for numbered steps, bullet points, or generate generic steps
  const descSteps = extractStepsFromDescription(task.description);

  if (descSteps.length > 0) {
    for (const [i, desc] of descSteps.entries()) {
      steps.push({
        id: `step_${i}`,
        description: desc,
        status: "pending",
        output: null,
        startedAt: null,
        completedAt: null,
      });
    }
  } else {
    // Generic 3-step plan
    steps.push(
      { id: "step_0", description: `Analyze: understand "${task.title}"`, status: "pending", output: null, startedAt: null, completedAt: null },
      { id: "step_1", description: `Execute: implement the changes for "${task.title}"`, status: "pending", output: null, startedAt: null, completedAt: null },
      { id: "step_2", description: `Verify: check that "${task.title}" is complete`, status: "pending", output: null, startedAt: null, completedAt: null },
    );
  }

  const estimatedMinutes = task.estimateMinutes ?? steps.length * 5;

  return {
    taskId: task.id,
    taskTitle: task.title,
    steps,
    estimatedMinutes,
    reasoning: `Planned ${steps.length} steps for "${task.title}" (est. ${estimatedMinutes}min)`,
  };
}

/**
 * Select the highest-priority task from the agent's queue.
 */
export function pickNextTask(tasks: Task[], state: AgentState): Task | null {
  const candidates = tasks
    .filter((t) => t.status === "ready" || t.status === "in_progress")
    .filter((t) => t.id !== state.currentTaskId)
    .sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 99;
      const pb = PRIORITY_ORDER[b.priority] ?? 99;
      if (pa !== pb) return pa - pb;
      return a.createdAt - b.createdAt; // oldest first at same priority
    });

  return candidates[0] ?? null;
}

// ── Internal helpers ────────────────────────────────────────────────

function findUrgentMessage(ctx: DecisionContext): Decision | null {
  for (const { channel, messages } of ctx.unreadMessages) {
    if (channel.kind === "direct") {
      const last = messages[messages.length - 1];
      if (last) {
        return {
          type: "respond_message",
          channelId: channel.id,
          messageId: last.id,
          text: `Acknowledged: "${last.text.slice(0, 100)}"`,
        };
      }
    }
  }
  return null;
}

function continueWork(state: AgentState, task: Task): Decision {
  const pendingStep = state.workPlan.findIndex(
    (s) => s.status === "pending" || s.status === "in_progress",
  );

  if (pendingStep === -1) {
    return {
      type: "complete_task",
      taskId: task.id,
      summary: `All ${state.workPlan.length} steps completed for "${task.title}"`,
    };
  }

  return {
    type: "continue_work",
    stepIndex: pendingStep,
  };
}

function buildPickReason(task: Task, ctx: DecisionContext): string {
  const skills = ctx.agent.skills
    .filter((s) => task.labels.some((l) => s.domain.toLowerCase().includes(l.toLowerCase())))
    .map((s) => s.domain);

  if (skills.length > 0) {
    return `Matches my skills: ${skills.join(", ")} (priority: ${task.priority})`;
  }
  return `Highest priority available task (${task.priority})`;
}

function generateIdleReflection(ctx: DecisionContext): string {
  const { agent, state } = ctx;
  const parts: string[] = [];

  parts.push(`Completed ${state.cyclesCompleted} work cycles this session.`);

  if (agent.stats.tasksCompleted > 0) {
    parts.push(`Total tasks completed: ${agent.stats.tasksCompleted}.`);
  }

  const topSkills = agent.skills
    .sort((a, b) => b.level - a.level)
    .slice(0, 3)
    .map((s) => `${s.domain} (${Math.round(s.level * 100)}%)`);

  if (topSkills.length > 0) {
    parts.push(`Strongest skills: ${topSkills.join(", ")}.`);
  }

  parts.push("Waiting for new task assignments.");

  return parts.join(" ");
}

function extractStepsFromDescription(description: string): string[] {
  if (!description || description.trim().length < 10) return [];

  const lines = description.split("\n").map((l) => l.trim()).filter(Boolean);
  const steps: string[] = [];

  for (const line of lines) {
    // Match numbered steps: "1. do something" or "1) do something"
    const numbered = line.match(/^\d+[.)]\s+(.+)/);
    if (numbered) {
      steps.push(numbered[1]);
      continue;
    }
    // Match bullet steps: "- do something" or "* do something"
    const bullet = line.match(/^[-*]\s+(.+)/);
    if (bullet) {
      steps.push(bullet[1]);
      continue;
    }
  }

  return steps;
}
