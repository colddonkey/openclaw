/**
 * Autonomy Service — manages the fleet of autonomous agent loops.
 *
 * Responsibilities:
 *  - Spawn AgentLoop instances for each registered/active agent
 *  - Start/stop/pause individual agents or the whole fleet
 *  - Collect and aggregate work cycle results
 *  - Enforce global limits (total concurrent tasks, error budgets)
 *  - Integrate with the feature gate and config system
 */

import type { TaskStore } from "../tasks/store.js";
import type { AgentIdentityStore } from "../tasks/agent-identity.js";
import type { CommsStore } from "../comms/store.js";
import { postAgentSystemNotification } from "../comms/agent-bridge.js";
import { AgentLoop, type AgentLoopDeps, type WorkExecutor } from "./agent-loop.js";
import type { AgentPhase, AutonomyConfig, WorkCycleResult } from "./types.js";
import type { OpenClawConfig } from "../config/types.js";
import { isMultiAgentOsEnabled } from "../tasks/feature-gate.js";

export type AutonomyServiceDeps = {
  taskStore: TaskStore;
  identityStore: AgentIdentityStore;
  commsStore: CommsStore;
  workExecutor?: WorkExecutor;
  /** Called after each agent cycle completes — use for WebSocket broadcasts. */
  onFleetCycle?: (result: WorkCycleResult, agentStatus: FleetAgentStatus) => void;
  /** Called on agent phase transitions — use for WebSocket broadcasts. */
  onFleetPhaseChange?: (agentId: string, from: AgentPhase, to: AgentPhase) => void;
};

export type FleetAgentStatus = {
  agentId: string;
  displayName?: string;
  phase: AgentPhase;
  running: boolean;
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  cyclesCompleted: number;
  errorCount: number;
  lastError: string | null;
  lastTickAt: number | null;
  phaseChangedAt: number;
  sessionStartedAt: number;
  tickIntervalMs: number;
  workPlanSteps: number;
  currentStepIndex: number;
};

export type FleetStatus = {
  running: boolean;
  agentCount: number;
  agents: FleetAgentStatus[];
  totalCyclesCompleted: number;
  totalTasksCompleted: number;
  totalErrors: number;
};

export class AutonomyService {
  private loops = new Map<string, AgentLoop>();
  private deps: AutonomyServiceDeps;
  private config: Required<Pick<AutonomyConfig, "enabled" | "tickIntervalMs" | "maxConsecutiveErrors" | "maxCyclesPerSession" | "completionCooldownMs" | "activeAgents">> & Pick<AutonomyConfig, "lightModel" | "workModel">;
  private running = false;
  private cycleLog: WorkCycleResult[] = [];
  private maxCycleLogSize = 500;

  constructor(deps: AutonomyServiceDeps, config: AutonomyConfig = {}) {
    this.deps = deps;
    this.config = {
      enabled: config.enabled ?? false,
      tickIntervalMs: config.tickIntervalMs ?? 30_000,
      maxConsecutiveErrors: config.maxConsecutiveErrors ?? 5,
      maxCyclesPerSession: config.maxCyclesPerSession ?? 100,
      completionCooldownMs: config.completionCooldownMs ?? 2_000,
      activeAgents: config.activeAgents ?? [],
      lightModel: config.lightModel,
      workModel: config.workModel,
    };
  }

  /**
   * Start the autonomy service. Spawns loops for all active agents.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    const agents = this.resolveActiveAgents();

    for (const agentId of agents) {
      this.spawnAgent(agentId);
    }

    postAgentSystemNotification(
      this.deps.commsStore,
      this.deps.identityStore,
      "system",
      "Autonomy service started",
      `Fleet size: ${agents.length} agents`,
    );
  }

  /**
   * Stop all agent loops and the service.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    for (const loop of this.loops.values()) {
      loop.stop();
    }

    postAgentSystemNotification(
      this.deps.commsStore,
      this.deps.identityStore,
      "system",
      "Autonomy service stopped",
    );
  }

  /**
   * Spawn a single agent loop. If the agent is already running, no-op.
   */
  spawnAgent(agentId: string): AgentLoop {
    const existing = this.loops.get(agentId);
    if (existing?.isRunning()) return existing;

    const loopDeps: AgentLoopDeps = {
      taskStore: this.deps.taskStore,
      identityStore: this.deps.identityStore,
      commsStore: this.deps.commsStore,
      workExecutor: this.deps.workExecutor,
      onCycleComplete: (result) => this.recordCycle(result),
      onPhaseChange: (id, from, to) => this.onAgentPhaseChange(id, from, to),
    };

    const loop = new AgentLoop(agentId, loopDeps, this.config);
    this.loops.set(agentId, loop);

    if (this.running) {
      loop.start();
    }

    return loop;
  }

  /**
   * Stop and remove a specific agent loop.
   */
  removeAgent(agentId: string): void {
    const loop = this.loops.get(agentId);
    if (loop) {
      loop.stop();
      this.loops.delete(agentId);
    }
  }

  /**
   * Get the loop for a specific agent.
   */
  getLoop(agentId: string): AgentLoop | undefined {
    return this.loops.get(agentId);
  }

  /**
   * Get fleet-wide status.
   */
  getStatus(): FleetStatus {
    let totalCycles = 0;
    let totalTasks = 0;
    let totalErrors = 0;

    const agents: FleetAgentStatus[] = [...this.loops.entries()].map(([id, loop]) => {
      const state = loop.getState();
      totalCycles += state.cyclesCompleted;
      totalErrors += state.errorCount;
      const completed = this.cycleLog
        .filter((c) => c.agentId === id)
        .reduce((sum, c) => sum + c.tasksCompleted, 0);
      totalTasks += completed;

      const identity = this.deps.identityStore.get(id);
      return {
        agentId: id,
        displayName: identity?.seed?.displayName,
        phase: state.phase,
        running: loop.isRunning(),
        currentTaskId: state.currentTaskId,
        currentTaskTitle: state.currentTaskTitle,
        cyclesCompleted: state.cyclesCompleted,
        errorCount: state.errorCount,
        lastError: state.lastError,
        lastTickAt: state.lastTickAt,
        phaseChangedAt: state.phaseChangedAt,
        sessionStartedAt: state.sessionStartedAt,
        tickIntervalMs: loop.getTickIntervalMs(),
        workPlanSteps: state.workPlan.length,
        currentStepIndex: state.currentStepIndex,
      };
    });

    return {
      running: this.running,
      agentCount: this.loops.size,
      agents,
      totalCyclesCompleted: totalCycles,
      totalTasksCompleted: totalTasks,
      totalErrors,
    };
  }

  /**
   * Get recent cycle log entries.
   */
  getRecentCycles(limit = 20): WorkCycleResult[] {
    return this.cycleLog.slice(-limit);
  }

  /**
   * Manually trigger a single tick for a specific agent (testing/debugging).
   */
  async tickAgent(agentId: string): Promise<WorkCycleResult | null> {
    const loop = this.loops.get(agentId);
    if (!loop) return null;
    return loop.tick();
  }

  // ── Internal ────────────────────────────────────────────────────

  private resolveActiveAgents(): string[] {
    if (this.config.activeAgents.length > 0) {
      return this.config.activeAgents;
    }
    const registered = this.deps.identityStore.listAll().map((a) => a.agentId);
    if (registered.length > 0) {
      return registered;
    }
    // Auto-create a default agent if none exist
    this.deps.identityStore.getOrCreate("agent-alpha");
    return ["agent-alpha"];
  }

  private recordCycle(result: WorkCycleResult): void {
    this.cycleLog.push(result);
    if (this.cycleLog.length > this.maxCycleLogSize) {
      this.cycleLog = this.cycleLog.slice(-this.maxCycleLogSize);
    }

    if (this.deps.onFleetCycle) {
      const loop = this.loops.get(result.agentId);
      if (loop) {
        const state = loop.getState();
        const identity = this.deps.identityStore.get(result.agentId);
        const agentStatus: FleetAgentStatus = {
          agentId: result.agentId,
          displayName: identity?.seed?.displayName,
          phase: state.phase,
          running: loop.isRunning(),
          currentTaskId: state.currentTaskId,
          currentTaskTitle: state.currentTaskTitle,
          cyclesCompleted: state.cyclesCompleted,
          errorCount: state.errorCount,
          lastError: state.lastError,
          lastTickAt: state.lastTickAt,
          phaseChangedAt: state.phaseChangedAt,
          sessionStartedAt: state.sessionStartedAt,
          tickIntervalMs: loop.getTickIntervalMs(),
          workPlanSteps: state.workPlan.length,
          currentStepIndex: state.currentStepIndex,
        };
        this.deps.onFleetCycle(result, agentStatus);
      }
    }
  }

  private onAgentPhaseChange(agentId: string, from: AgentPhase, to: AgentPhase): void {
    if (to === "error") {
      postAgentSystemNotification(
        this.deps.commsStore,
        this.deps.identityStore,
        agentId,
        `Phase: ${from} → ${to}`,
        "Agent paused due to repeated errors",
      );
    }
    this.deps.onFleetPhaseChange?.(agentId, from, to);
  }
}

/**
 * Factory: create an AutonomyService from OpenClaw config.
 * Returns null if the feature is disabled.
 */
export function createAutonomyServiceFromConfig(
  config: OpenClawConfig,
  deps: AutonomyServiceDeps,
): AutonomyService | null {
  if (!isMultiAgentOsEnabled(config)) return null;

  const osConfig = config.multiAgentOs;
  const autonomyCfg: AutonomyConfig = (osConfig as Record<string, unknown>)?.autonomy as AutonomyConfig ?? {};

  if (autonomyCfg.enabled !== true) return null;

  return new AutonomyService(deps, autonomyCfg);
}
