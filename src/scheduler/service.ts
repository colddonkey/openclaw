/**
 * Agent task scheduler service.
 *
 * Runs periodically and:
 *   1. Finds unassigned tasks in "ready" state
 *   2. Scores available agents for each task
 *   3. Assigns the best-fit agent to each task
 *   4. Posts notifications to the comms board
 *   5. Logs scheduling decisions
 *
 * The scheduler respects agent load limits and minimum score thresholds.
 */

import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { loadConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { AgentIdentityStore } from "../tasks/agent-identity.js";
import { isMultiAgentOsEnabled } from "../tasks/feature-gate.js";
import { TaskStore } from "../tasks/store.js";
import type { Task, TaskStatus } from "../tasks/types.js";
import { CommsStore } from "../comms/store.js";
import {
  autoJoinChannels,
  postAgentSystemNotification,
} from "../comms/agent-bridge.js";
import { rankAgentsForTask } from "./scoring.js";
import type { SchedulerConfig, SchedulerDecision, SchedulerRunResult } from "./types.js";

const log = createSubsystemLogger("scheduler");

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MIN_SCORE = 0.1;

export class SchedulerService {
  private taskStore: TaskStore;
  private identityStore: AgentIdentityStore;
  private commsStore: CommsStore;
  private config: SchedulerConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastRun: SchedulerRunResult | null = null;

  constructor(opts: {
    taskStore: TaskStore;
    identityStore: AgentIdentityStore;
    commsStore: CommsStore;
    config?: SchedulerConfig;
  }) {
    this.taskStore = opts.taskStore;
    this.identityStore = opts.identityStore;
    this.commsStore = opts.commsStore;
    this.config = opts.config ?? {};
  }

  /** Start the periodic scheduling loop. */
  start(): void {
    if (this.timer) return;

    const intervalMs = this.config.intervalMs ?? DEFAULT_INTERVAL_MS;
    log.info(`scheduler started (interval: ${intervalMs}ms)`);

    this.timer = setInterval(() => {
      void this.runOnce();
    }, intervalMs);

    void this.runOnce();
  }

  /** Stop the scheduling loop. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info("scheduler stopped");
    }
  }

  /** Get the result of the last scheduling run. */
  getLastRun(): SchedulerRunResult | null {
    return this.lastRun;
  }

  /** Run a single scheduling pass. */
  async runOnce(): Promise<SchedulerRunResult> {
    if (this.running) {
      return this.lastRun ?? {
        runAt: Date.now(),
        assignments: [],
        skippedTasks: 0,
        evaluatedAgents: 0,
        durationMs: 0,
      };
    }

    this.running = true;
    const startTime = Date.now();

    try {
      const result = this.schedule();
      this.lastRun = result;
      return result;
    } catch (err) {
      log.error(`scheduler error: ${err}`);
      return {
        runAt: startTime,
        assignments: [],
        skippedTasks: 0,
        evaluatedAgents: 0,
        durationMs: Date.now() - startTime,
      };
    } finally {
      this.running = false;
    }
  }

  private schedule(): SchedulerRunResult {
    const startTime = Date.now();
    const minScore = this.config.minScoreThreshold ?? DEFAULT_MIN_SCORE;
    const maxConcurrent = this.config.maxConcurrentPerAgent ?? DEFAULT_MAX_CONCURRENT;

    const unassigned = this.taskStore.list({
      status: "ready" as TaskStatus,
      limit: 50,
    }).filter((t) => !t.assigneeId);

    if (unassigned.length === 0) {
      return {
        runAt: startTime,
        assignments: [],
        skippedTasks: 0,
        evaluatedAgents: 0,
        durationMs: Date.now() - startTime,
      };
    }

    const agents = this.identityStore.listAll();
    if (agents.length === 0) {
      return {
        runAt: startTime,
        assignments: [],
        skippedTasks: unassigned.length,
        evaluatedAgents: 0,
        durationMs: Date.now() - startTime,
      };
    }

    const loadMap = this.buildLoadMap(agents.map((a) => a.agentId));
    const assignments: SchedulerDecision[] = [];
    let skippedTasks = 0;

    for (const task of unassigned) {
      const ranked = rankAgentsForTask(task, agents, loadMap, this.config);

      if (ranked.length === 0 || ranked[0].totalScore < minScore) {
        skippedTasks++;
        continue;
      }

      const best = ranked[0];

      if ((loadMap.get(best.agentId) ?? 0) >= maxConcurrent) {
        skippedTasks++;
        continue;
      }

      const actorName = best.agentId.replace(/^agent:/, "").replace(/-/g, " ");
      this.taskStore.update(
        task.id,
        {
          assigneeId: best.agentId,
          assigneeName: actorName,
        },
        "scheduler",
        "Scheduler",
      );

      loadMap.set(best.agentId, (loadMap.get(best.agentId) ?? 0) + 1);

      const reason = best.matchingSkills.length > 0
        ? `Skill match: ${best.matchingSkills.join(", ")} (score: ${(best.totalScore * 100).toFixed(0)}%)`
        : `Best available agent (score: ${(best.totalScore * 100).toFixed(0)}%)`;

      assignments.push({
        taskId: task.id,
        taskTitle: task.title,
        assignedTo: best.agentId,
        scorecard: best,
        reason,
      });

      this.notifyAssignment(task, best.agentId, actorName, reason);

      log.info(
        `assigned: ${task.title.slice(0, 40)} -> ${best.agentId} (score: ${(best.totalScore * 100).toFixed(0)}%, skills: ${best.matchingSkills.join(",") || "none"})`,
      );
    }

    const result: SchedulerRunResult = {
      runAt: startTime,
      assignments,
      skippedTasks,
      evaluatedAgents: agents.length,
      durationMs: Date.now() - startTime,
    };

    if (assignments.length > 0) {
      log.info(
        `scheduler run: ${assignments.length} assigned, ${skippedTasks} skipped, ${agents.length} agents evaluated (${result.durationMs}ms)`,
      );
    }

    return result;
  }

  private buildLoadMap(agentIds: string[]): Map<string, number> {
    const loadMap = new Map<string, number>();
    for (const agentId of agentIds) {
      const activeTasks = this.taskStore.list({
        assigneeId: agentId,
        status: ["in_progress", "review"] as TaskStatus[],
      });
      loadMap.set(agentId, activeTasks.length);
    }
    return loadMap;
  }

  private notifyAssignment(task: Task, agentId: string, agentName: string, reason: string): void {
    try {
      autoJoinChannels(this.commsStore, this.identityStore, agentId, task.id, task.title);

      postAgentSystemNotification(
        this.commsStore,
        this.identityStore,
        "scheduler",
        `assigned "${task.title}" to ${agentName}`,
        reason,
      );
    } catch {
      // Non-critical: notification failures shouldn't break scheduling
    }
  }
}

/**
 * Create a scheduler service from the current config.
 * Returns null if multiAgentOs is not enabled or scheduler is disabled.
 */
export function createSchedulerFromConfig(): SchedulerService | null {
  const cfg = loadConfig();
  if (!isMultiAgentOsEnabled(cfg)) return null;

  const schedConfig = cfg.multiAgentOs?.scheduler;
  if (schedConfig?.enabled === false) return null;

  const stateDir = resolveStateDir(process.env);
  const basePath = cfg.multiAgentOs?.dbPath
    ? path.dirname(cfg.multiAgentOs.dbPath)
    : path.join(stateDir, "tasks");

  const taskStore = new TaskStore(path.join(basePath, "tasks.sqlite"));
  const identityStore = new AgentIdentityStore(path.join(basePath, "identities.sqlite"));
  const commsStore = new CommsStore(path.join(basePath, "comms.sqlite"));

  return new SchedulerService({
    taskStore,
    identityStore,
    commsStore,
    config: schedConfig,
  });
}
