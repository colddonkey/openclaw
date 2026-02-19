/**
 * Types for the agent task scheduler.
 *
 * The scheduler automatically assigns unassigned tasks to agents
 * based on skill matching, workload balance, and availability.
 */

export type SchedulerConfig = {
  /** Enable the auto-scheduler. Default: true (when multiAgentOs is enabled). */
  enabled?: boolean;
  /** Interval between scheduling runs in milliseconds. Default: 30000 (30s). */
  intervalMs?: number;
  /** Max concurrent in-progress tasks per agent. Default: 3. */
  maxConcurrentPerAgent?: number;
  /** Minimum score threshold for assignment (0.0-1.0). Default: 0.1. */
  minScoreThreshold?: number;
  /** Weight for skill match scoring (0.0-1.0). Default: 0.5. */
  skillWeight?: number;
  /** Weight for load balancing scoring (0.0-1.0). Default: 0.3. */
  loadWeight?: number;
  /** Weight for recency scoring (0.0-1.0). Default: 0.2. */
  recencyWeight?: number;
};

export type AgentScorecard = {
  agentId: string;
  /** Overall score for this task (0.0-1.0). */
  totalScore: number;
  /** Skill match score (0.0-1.0). */
  skillScore: number;
  /** Load balance score (0.0-1.0) — higher = less loaded. */
  loadScore: number;
  /** Recency score (0.0-1.0) — higher = more recently active. */
  recencyScore: number;
  /** Current number of in-progress tasks. */
  currentLoad: number;
  /** Matching skills for this task. */
  matchingSkills: string[];
};

export type SchedulerDecision = {
  taskId: string;
  taskTitle: string;
  assignedTo: string;
  scorecard: AgentScorecard;
  reason: string;
};

export type SchedulerRunResult = {
  runAt: number;
  assignments: SchedulerDecision[];
  skippedTasks: number;
  evaluatedAgents: number;
  durationMs: number;
};
