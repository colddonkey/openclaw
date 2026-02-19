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
  private config: Required<AutonomyConfig>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(agentId: string, deps: AgentLoopDeps, config: AutonomyConfig = {}) {
    this.agentId = agentId;
    this.deps = deps;
    this.config = {
      enabled: config.enabled ?? false,
      tickIntervalMs: config.tickIntervalMs ?? 10_000,
      maxConsecutiveErrors: config.maxConsecutiveErrors ?? 5,
      maxCyclesPerSession: config.maxCyclesPerSession ?? 100,
      completionCooldownMs: config.completionCooldownMs ?? 2_000,
      activeAgents: config.activeAgents ?? [],
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
        this.handleRespondMessage(decision.channelId, decision.text, result);
        break;

      case "create_subtask":
        this.handleCreateSubtask(decision.parentId, decision.title, decision.description, result);
        break;

      case "block_task":
        this.handleBlockTask(decision.taskId, decision.reason, result);
        break;

      case "reflect":
        this.handleReflect(decision.reflection);
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

  private handleRespondMessage(channelId: string, text: string, result: WorkCycleResult): void {
    this.setPhase("communicating");
    sendAgentMessage(this.deps.commsStore, this.deps.identityStore, {
      channelId,
      agentId: this.agentId,
      text,
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

  private handleReflect(reflection: string): void {
    this.setPhase("reflecting");
    this.deps.identityStore.updateSelfReflection(this.agentId, reflection);
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
