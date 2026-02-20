/**
 * Agent autonomy loop.
 *
 * Each agent runs its own loop:
 *   tick() → observe() → decide() → act() → reflect()
 *
 * The loop is event-driven via setInterval; each tick is one full
 * observe-decide-act-reflect cycle. The agent pauses itself on
 * repeated errors or max cycle limits.
 */

import type { TaskStore } from "../tasks/store.js";
import type { AgentIdentityStore } from "../tasks/agent-identity.js";
import type { CommsStore } from "../comms/store.js";
import { sendAgentMessage, autoJoinChannels, postTaskStatusUpdate, postAgentSystemNotification } from "../comms/agent-bridge.js";
import { decide, planWork, pickNextTask } from "./work-planner.js";
import type {
  AgentPhase,
  AgentState,
  AutonomyConfig,
  Decision,
  DecisionContext,
  WorkCycleResult,
} from "./types.js";

export type AgentLoopDeps = {
  taskStore: TaskStore;
  identityStore: AgentIdentityStore;
  commsStore: CommsStore;
  /** Callback invoked after each work cycle completes. */
  onCycleComplete?: (result: WorkCycleResult) => void;
  /** Callback invoked on phase transitions. */
  onPhaseChange?: (agentId: string, from: AgentPhase, to: AgentPhase) => void;
  /** Optional executor: actually runs the work step (shell command, LLM call, etc). */
  workExecutor?: WorkExecutor;
};

/**
 * Pluggable work executor. The autonomy loop delegates actual
 * "doing" to this function, keeping the loop itself pure orchestration.
 */
export type WorkExecutor = (params: {
  agentId: string;
  taskId: string;
  stepDescription: string;
  stepIndex: number;
  totalSteps: number;
  /** Optional model override for this step (e.g. "anthropic/claude-haiku-3.5"). */
  model?: string;
}) => Promise<{ output: string; success: boolean }>;

/** Default executor that just acknowledges the step (no real work). */
const noopExecutor: WorkExecutor = async ({ stepDescription }) => ({
  output: `Acknowledged: ${stepDescription}`,
  success: true,
});

export class AgentLoop {
  readonly agentId: string;
  private state: AgentState;
  private deps: AgentLoopDeps;
  private config: Required<Pick<AutonomyConfig, "enabled" | "tickIntervalMs" | "maxConsecutiveErrors" | "maxCyclesPerSession" | "completionCooldownMs" | "activeAgents">> & Pick<AutonomyConfig, "lightModel" | "workModel">;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(agentId: string, deps: AgentLoopDeps, config: AutonomyConfig = {}) {
    this.agentId = agentId;
    this.deps = deps;
    this.config = {
      enabled: config.enabled ?? false,
      tickIntervalMs: config.tickIntervalMs ?? 3_600_000,
      maxConsecutiveErrors: config.maxConsecutiveErrors ?? 5,
      maxCyclesPerSession: config.maxCyclesPerSession ?? 100,
      completionCooldownMs: config.completionCooldownMs ?? 2_000,
      activeAgents: config.activeAgents ?? [],
      lightModel: config.lightModel,
      workModel: config.workModel,
    };
    this.state = this.initialState();
  }

  private initialState(): AgentState {
    return {
      agentId: this.agentId,
      phase: "idle",
      currentTaskId: null,
      currentTaskTitle: null,
      workPlan: [],
      currentStepIndex: 0,
      phaseChangedAt: Date.now(),
      cyclesCompleted: 0,
      errorCount: 0,
      lastError: null,
      sessionStartedAt: Date.now(),
    };
  }

  getState(): AgentState {
    return { ...this.state };
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.state.sessionStartedAt = Date.now();

    this.deps.identityStore.getOrCreate(this.agentId);
    autoJoinChannels(this.deps.commsStore, this.deps.identityStore, this.agentId);

    postAgentSystemNotification(
      this.deps.commsStore,
      this.deps.identityStore,
      this.agentId,
      "Autonomy loop started",
    );

    this.timer = setInterval(() => this.tick(), this.config.tickIntervalMs);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    postAgentSystemNotification(
      this.deps.commsStore,
      this.deps.identityStore,
      this.agentId,
      "Autonomy loop stopped",
      `Cycles: ${this.state.cyclesCompleted}, Errors: ${this.state.errorCount}`,
    );
  }

  /**
   * Run a single tick manually (useful for testing without timers).
   */
  async tick(): Promise<WorkCycleResult> {
    const start = Date.now();
    const result: WorkCycleResult = {
      agentId: this.agentId,
      phase: this.state.phase,
      decision: { type: "idle", reason: "tick start" },
      durationMs: 0,
      tasksCompleted: 0,
      messagesPosted: 0,
      subtasksCreated: 0,
      errors: [],
    };

    try {
      // Guard: max cycles
      if (this.state.cyclesCompleted >= this.config.maxCyclesPerSession) {
        this.setPhase("paused");
        result.decision = { type: "idle", reason: "Max cycles reached" };
        return this.finalizeCycleResult(result, start);
      }

      // 1. Observe
      const ctx = this.observe();

      // 2. Decide
      const decision = decide(ctx);
      result.decision = decision;

      // 3. Act
      await this.act(decision, result);

      // Success — reset error counter
      this.state.errorCount = 0;
      this.state.lastError = null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.state.errorCount++;
      this.state.lastError = msg;
      result.errors.push(msg);

      if (this.state.errorCount >= this.config.maxConsecutiveErrors) {
        this.setPhase("error");
        postAgentSystemNotification(
          this.deps.commsStore,
          this.deps.identityStore,
          this.agentId,
          "Paused due to errors",
          `${this.state.errorCount} consecutive errors. Last: ${msg}`,
        );
      }
    }

    this.state.cyclesCompleted++;
    return this.finalizeCycleResult(result, start);
  }

  // ── Observe ─────────────────────────────────────────────────────

  private observe(): DecisionContext {
    const identity = this.deps.identityStore.getOrCreate(this.agentId);

    const assignedTasks = this.deps.taskStore.list({
      assigneeId: this.agentId,
      status: ["ready", "in_progress", "review"],
    });

    const triageTasks = this.deps.taskStore.list({
      assigneeId: this.agentId,
      status: ["triage"],
    });

    const channels = this.deps.commsStore.getChannelsForMember(this.agentId);
    const unreadMessages = channels
      .map((ch) => {
        const unread = this.deps.commsStore.getUnreadCount(ch.id, this.agentId);
        if (unread === 0) return null;
        const messages = this.deps.commsStore.getRecentMessages(ch.id, unread);
        return { channel: ch, messages };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const maxConcurrent = 3;

    return {
      agent: identity,
      state: this.state,
      assignedTasks,
      triageTasks,
      unreadMessages,
      recentSystemEvents: [],
      currentLoad: assignedTasks.filter((t) => t.status === "in_progress").length,
      maxConcurrent,
    };
  }

  // ── Act ─────────────────────────────────────────────────────────

  private async act(decision: Decision, result: WorkCycleResult): Promise<void> {
    switch (decision.type) {
      case "pick_task":
        await this.handlePickTask(decision.taskId, decision.reason, result);
        break;

      case "triage_task":
        await this.handleTriageTask(decision.taskId, decision.reason, result);
        break;

      case "complete_triage":
        await this.handleCompleteTriage(decision.taskId, decision.plan, decision.subtasks, result);
        break;

      case "continue_work":
        await this.handleContinueWork(decision.stepIndex, result);
        break;

      case "complete_task":
        await this.handleCompleteTask(decision.taskId, decision.summary, result);
        break;

      case "report_progress":
        this.handleReport(decision.channelId, decision.text, result);
        break;

      case "respond_message":
        await this.handleRespondMessage(decision.channelId, decision.text, result);
        break;

      case "create_subtask":
        this.handleCreateSubtask(decision.parentId, decision.title, decision.description, result);
        break;

      case "block_task":
        this.handleBlockTask(decision.taskId, decision.reason, result);
        break;

      case "reflect":
        await this.handleReflect(decision.reflection);
        break;

      case "ask_for_help":
        this.handleReport(decision.channelId, decision.text, result);
        break;

      case "idle":
        this.setPhase("idle");
        break;
    }
  }

  // ── Action handlers ─────────────────────────────────────────────

  private async handleTriageTask(taskId: string, reason: string, result: WorkCycleResult): Promise<void> {
    const task = this.deps.taskStore.get(taskId);
    if (!task || task.status !== "triage") return;

    this.state.currentTaskId = taskId;
    this.state.currentTaskTitle = task.title;
    this.setPhase("planning");

    autoJoinChannels(this.deps.commsStore, this.deps.identityStore, this.agentId, taskId, task.title);

    const taskChannel = this.deps.commsStore.getChannelForTask(taskId);
    if (taskChannel) {
      sendAgentMessage(this.deps.commsStore, this.deps.identityStore, {
        channelId: taskChannel.id,
        agentId: this.agentId,
        text: `Triaging ${task.type}: "${task.title}"\n${reason}`,
        kind: "status",
      });
      result.messagesPosted++;
    }

    const executor = this.deps.workExecutor;
    if (executor) {
      const { output, success } = await executor({
        agentId: this.agentId,
        taskId,
        stepDescription: `TRIAGE: Analyze "${task.title}" (${task.type}). Review the description, understand scope, identify risks, and produce a plan. If this is a story or epic, list subtasks to create.`,
        stepIndex: 0,
        totalSteps: 1,
        model: this.config.lightModel,
      });

      if (success && output) {
        const subtasks = extractSubtasksFromTriageOutput(output);
        // The planner completed; now transition the task
        await this.handleCompleteTriage(taskId, output, subtasks, result);
      } else {
        if (taskChannel) {
          sendAgentMessage(this.deps.commsStore, this.deps.identityStore, {
            channelId: taskChannel.id,
            agentId: this.agentId,
            text: `Triage incomplete: ${output?.slice(0, 200) ?? "no output"}`,
            kind: "status",
          });
          result.messagesPosted++;
        }
      }
    } else {
      // No executor: auto-promote quick triage
      this.deps.taskStore.update(taskId, {
        status: "ready",
        triagePlan: `Auto-triaged (no executor): ${task.title}`,
      }, this.agentId, this.agentId);
      this.state.currentTaskId = null;
      this.state.currentTaskTitle = null;
      this.setPhase("idle");
    }
  }

  private async handleCompleteTriage(
    taskId: string,
    plan: string,
    subtasks: Array<{ title: string; description: string }>,
    result: WorkCycleResult,
  ): Promise<void> {
    const task = this.deps.taskStore.get(taskId);
    if (!task) return;

    // Save the plan and move task to ready
    this.deps.taskStore.update(taskId, {
      status: "ready",
      triagePlan: plan,
    }, this.agentId, this.agentId);

    postTaskStatusUpdate(
      this.deps.commsStore,
      this.deps.identityStore,
      this.agentId,
      taskId,
      task.title,
      "triage",
      "ready",
    );

    // Create subtasks for stories/epics
    for (const sub of subtasks) {
      this.deps.taskStore.create({
        title: sub.title,
        description: sub.description,
        parentId: taskId,
        creatorId: this.agentId,
        creatorName: this.agentId,
        labels: task.labels,
        priority: task.priority,
        type: "task",
        source: "triage",
      });
      result.subtasksCreated++;
    }

    // Update identity — triage is a planning skill
    this.deps.identityStore.recordSkillUpdate(this.agentId, {
      domain: "planning",
      success: true,
      taskId,
    });

    const taskChannel = this.deps.commsStore.getChannelForTask(taskId);
    if (taskChannel) {
      const subNote = subtasks.length > 0
        ? `\nCreated ${subtasks.length} subtask(s)`
        : "";
      sendAgentMessage(this.deps.commsStore, this.deps.identityStore, {
        channelId: taskChannel.id,
        agentId: this.agentId,
        text: `Triage complete for "${task.title}" — moved to ready${subNote}`,
        kind: "status",
      });
      result.messagesPosted++;
    }

    this.state.currentTaskId = null;
    this.state.currentTaskTitle = null;
    this.state.workPlan = [];
    this.setPhase("idle");
  }

  private async handlePickTask(taskId: string, reason: string, result: WorkCycleResult): Promise<void> {
    const task = this.deps.taskStore.get(taskId);
    if (!task) return;

    // Move to in_progress if still ready
    if (task.status === "ready") {
      this.deps.taskStore.update(taskId, { status: "in_progress" }, this.agentId, this.agentId);
      postTaskStatusUpdate(
        this.deps.commsStore,
        this.deps.identityStore,
        this.agentId,
        taskId,
        task.title,
        "ready",
        "in_progress",
      );
    }

    // Create work plan
    const plan = planWork(task);
    this.state.currentTaskId = taskId;
    this.state.currentTaskTitle = task.title;
    this.state.workPlan = plan.steps;
    this.state.currentStepIndex = 0;
    this.setPhase("planning");

    autoJoinChannels(
      this.deps.commsStore,
      this.deps.identityStore,
      this.agentId,
      taskId,
      task.title,
    );

    const taskChannel = this.deps.commsStore.getChannelForTask(taskId);
    if (taskChannel) {
      sendAgentMessage(this.deps.commsStore, this.deps.identityStore, {
        channelId: taskChannel.id,
        agentId: this.agentId,
        text: `Picked up task. ${reason}\nPlan: ${plan.steps.length} steps (est. ${plan.estimatedMinutes}min)`,
        kind: "status",
      });
      result.messagesPosted++;
    }
  }

  private async handleContinueWork(stepIndex: number, result: WorkCycleResult): Promise<void> {
    this.setPhase("working");
    const step = this.state.workPlan[stepIndex];
    if (!step) return;

    step.status = "in_progress";
    step.startedAt = Date.now();
    this.state.currentStepIndex = stepIndex;

    const executor = this.deps.workExecutor ?? noopExecutor;

    const { output, success } = await executor({
      agentId: this.agentId,
      taskId: this.state.currentTaskId!,
      stepDescription: step.description,
      stepIndex,
      totalSteps: this.state.workPlan.length,
      model: this.config.workModel,
    });

    step.output = output;
    step.completedAt = Date.now();
    step.status = success ? "done" : "failed";

    if (!success) {
      result.errors.push(`Step ${stepIndex} failed: ${output}`);
    }

    // Report progress
    if (this.state.currentTaskId) {
      const taskChannel = this.deps.commsStore.getChannelForTask(this.state.currentTaskId);
      if (taskChannel) {
        const total = this.state.workPlan.length;
        const done = this.state.workPlan.filter((s) => s.status === "done").length;
        sendAgentMessage(this.deps.commsStore, this.deps.identityStore, {
          channelId: taskChannel.id,
          agentId: this.agentId,
          text: `Step ${stepIndex + 1}/${total}: ${step.description} → ${step.status}\n${done}/${total} complete`,
          kind: "status",
        });
        result.messagesPosted++;
      }
    }
  }

  private async handleCompleteTask(taskId: string, summary: string, result: WorkCycleResult): Promise<void> {
    const task = this.deps.taskStore.get(taskId);
    if (!task) return;

    this.deps.taskStore.update(taskId, { status: "done" }, this.agentId, this.agentId);

    postTaskStatusUpdate(
      this.deps.commsStore,
      this.deps.identityStore,
      this.agentId,
      taskId,
      task.title,
      task.status,
      "done",
    );

    // Update agent identity
    for (const label of task.labels) {
      this.deps.identityStore.recordSkillUpdate(this.agentId, {
        domain: label,
        success: true,
        taskId,
      });
    }
    this.deps.identityStore.incrementStat(this.agentId, "tasksCompleted");

    this.deps.identityStore.reinforceTrait(this.agentId, {
      key: "productive",
      delta: 0.05,
      evidence: `Completed: ${task.title}`,
    });

    // Reset state
    this.state.currentTaskId = null;
    this.state.currentTaskTitle = null;
    this.state.workPlan = [];
    this.state.currentStepIndex = 0;
    this.setPhase("idle");

    result.tasksCompleted++;

    // Cooldown
    if (this.config.completionCooldownMs > 0) {
      await sleep(this.config.completionCooldownMs);
    }
  }

  private handleReport(channelId: string, text: string, result: WorkCycleResult): void {
    this.setPhase("reporting");
    sendAgentMessage(this.deps.commsStore, this.deps.identityStore, {
      channelId,
      agentId: this.agentId,
      text,
    });
    result.messagesPosted++;
  }

  private async handleRespondMessage(channelId: string, messageContext: string, result: WorkCycleResult): Promise<void> {
    this.setPhase("communicating");
    const executor = this.deps.workExecutor;
    let responseText = messageContext;

    if (executor) {
      const identity = this.deps.identityStore.getOrCreate(this.agentId);
      const personality = identity.seed?.personality || "a helpful and friendly AI agent";
      const prompt = [
        `You are ${identity.seed?.displayName || this.agentId}, ${personality}.`,
        "Respond naturally and conversationally to the following channel messages.",
        "Keep your reply concise (1-3 sentences). Be helpful and on-topic.",
        "",
        "Recent messages:",
        messageContext,
        "",
        "Your reply:",
      ].join("\n");

      try {
        const { output, success } = await executor({
          agentId: this.agentId,
          taskId: `comms:${channelId}`,
          stepDescription: prompt,
          stepIndex: 0,
          totalSteps: 1,
          model: this.config.lightModel,
        });
        if (success && output) responseText = output;
      } catch {}
    }

    sendAgentMessage(this.deps.commsStore, this.deps.identityStore, {
      channelId,
      agentId: this.agentId,
      text: responseText,
    });
    this.deps.commsStore.markRead(channelId, this.agentId);
    result.messagesPosted++;
  }

  private handleCreateSubtask(parentId: string, title: string, description: string, result: WorkCycleResult): void {
    const parentTask = this.deps.taskStore.get(parentId);
    if (!parentTask) return;

    this.deps.taskStore.create({
      title,
      description,
      parentId,
      creatorId: this.agentId,
      creatorName: this.agentId,
      labels: parentTask.labels,
      priority: parentTask.priority,
      source: "agent",
    });

    result.subtasksCreated++;
  }

  private handleBlockTask(taskId: string, reason: string, result: WorkCycleResult): void {
    this.deps.taskStore.update(
      taskId,
      { status: "blocked" },
      this.agentId,
      this.agentId,
    );
    this.deps.taskStore.addComment(taskId, this.agentId, this.agentId, `Blocked: ${reason}`);

    postTaskStatusUpdate(
      this.deps.commsStore,
      this.deps.identityStore,
      this.agentId,
      taskId,
      this.state.currentTaskTitle ?? taskId,
      "in_progress",
      "blocked",
    );

    this.state.currentTaskId = null;
    this.state.currentTaskTitle = null;
    this.state.workPlan = [];
    this.setPhase("idle");

    result.messagesPosted++;
  }

  private async handleReflect(baseReflection: string): Promise<void> {
    this.setPhase("reflecting");
    let reflection = baseReflection;

    const executor = this.deps.workExecutor;
    if (executor) {
      const identity = this.deps.identityStore.getOrCreate(this.agentId);
      const personality = identity.seed?.personality || "an autonomous agent";
      const traits = identity.traits.slice(0, 5).map(t => `${t.key} (${(t.strength * 100).toFixed(0)}%)`).join(", ");
      const skills = identity.skills.slice(0, 5).map(s => `${s.domain} (${(s.level * 100).toFixed(0)}%)`).join(", ");

      const prompt = [
        `You are ${identity.seed?.displayName || this.agentId}, ${personality}.`,
        "Take a moment for self-reflection. Think about:",
        "- What you've accomplished recently",
        "- What you could improve at",
        "- Any patterns you've noticed in your work",
        "- How you want to grow or what skills to develop",
        "",
        `Current context: ${baseReflection}`,
        traits ? `Your traits: ${traits}` : "No strong traits yet.",
        skills ? `Your skills: ${skills}` : "No skills developed yet.",
        "",
        "Write 2-4 sentences of genuine introspection. Be specific, not generic.",
      ].join("\n");

      try {
        const { output, success } = await executor({
          agentId: this.agentId,
          taskId: `reflection:${this.agentId}`,
          stepDescription: prompt,
          stepIndex: 0,
          totalSteps: 1,
          model: this.config.lightModel,
        });
        if (success && output) reflection = output;
      } catch {}
    }

    this.deps.identityStore.updateSelfReflection(this.agentId, reflection);
    this.deps.identityStore.incrementStat(this.agentId, "reflections");
    this.deps.identityStore.decayTraits(this.agentId);
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private setPhase(phase: AgentPhase): void {
    const old = this.state.phase;
    if (old === phase) return;
    this.state.phase = phase;
    this.state.phaseChangedAt = Date.now();
    this.deps.onPhaseChange?.(this.agentId, old, phase);
  }

  private finalizeCycleResult(result: WorkCycleResult, start: number): WorkCycleResult {
    result.durationMs = Date.now() - start;
    result.phase = this.state.phase;
    this.deps.onCycleComplete?.(result);
    return result;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract subtask titles from an LLM triage output.
 * Looks for numbered/bulleted items under "subtask" or "task" headings.
 */
function extractSubtasksFromTriageOutput(output: string): Array<{ title: string; description: string }> {
  const subtasks: Array<{ title: string; description: string }> = [];
  const lines = output.split("\n");

  let inSubtaskSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^#+\s*(sub\s*)?tasks?/i.test(trimmed) || /^(sub\s*)?tasks?:/i.test(trimmed)) {
      inSubtaskSection = true;
      continue;
    }

    if (inSubtaskSection && /^#+\s/.test(trimmed) && !/^#+\s*(sub\s*)?tasks?/i.test(trimmed)) {
      inSubtaskSection = false;
      continue;
    }

    if (inSubtaskSection) {
      const match = trimmed.match(/^[-*\d.)]+\s+(.+)/);
      if (match) {
        const title = match[1].replace(/^\*\*(.+)\*\*$/, "$1").trim();
        if (title.length > 3) {
          subtasks.push({ title, description: "" });
        }
      }
    }
  }

  return subtasks;
}
