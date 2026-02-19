/**
 * Scoring engine for task-agent matching.
 *
 * Produces a score (0.0-1.0) for each (task, agent) pair based on:
 *   - Skill match: how well the agent's skills match the task's labels/domain
 *   - Load balance: how busy the agent currently is (fewer tasks = higher score)
 *   - Recency: how recently the agent was active (more recent = higher score)
 *
 * The final score is a weighted combination of these three dimensions.
 */

import type { AgentIdentity } from "../tasks/agent-identity.js";
import type { Task } from "../tasks/types.js";
import type { AgentScorecard, SchedulerConfig } from "./types.js";

const DEFAULT_SKILL_WEIGHT = 0.5;
const DEFAULT_LOAD_WEIGHT = 0.3;
const DEFAULT_RECENCY_WEIGHT = 0.2;

/**
 * Score an agent for a specific task.
 */
export function scoreAgent(
  task: Task,
  agent: AgentIdentity,
  currentLoad: number,
  config?: SchedulerConfig,
): AgentScorecard {
  const skillWeight = config?.skillWeight ?? DEFAULT_SKILL_WEIGHT;
  const loadWeight = config?.loadWeight ?? DEFAULT_LOAD_WEIGHT;
  const recencyWeight = config?.recencyWeight ?? DEFAULT_RECENCY_WEIGHT;
  const maxConcurrent = config?.maxConcurrentPerAgent ?? 3;

  const { skillScore, matchingSkills } = computeSkillScore(task, agent);
  const loadScore = computeLoadScore(currentLoad, maxConcurrent);
  const recencyScore = computeRecencyScore(agent);

  const totalScore = (skillWeight * skillScore) +
                     (loadWeight * loadScore) +
                     (recencyWeight * recencyScore);

  return {
    agentId: agent.agentId,
    totalScore: clamp(totalScore),
    skillScore,
    loadScore,
    recencyScore,
    currentLoad,
    matchingSkills,
  };
}

/**
 * Score all agents for a task and return them sorted by score (descending).
 */
export function rankAgentsForTask(
  task: Task,
  agents: AgentIdentity[],
  loadMap: Map<string, number>,
  config?: SchedulerConfig,
): AgentScorecard[] {
  const maxConcurrent = config?.maxConcurrentPerAgent ?? 3;

  return agents
    .filter((agent) => {
      const load = loadMap.get(agent.agentId) ?? 0;
      return load < maxConcurrent;
    })
    .map((agent) => {
      const load = loadMap.get(agent.agentId) ?? 0;
      return scoreAgent(task, agent, load, config);
    })
    .sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * Skill matching: compare task labels against agent skills.
 * Uses both exact matches and fuzzy substring matching.
 */
function computeSkillScore(
  task: Task,
  agent: AgentIdentity,
): { skillScore: number; matchingSkills: string[] } {
  const taskDomains = task.labels.length > 0 ? task.labels : inferDomains(task.title);
  if (taskDomains.length === 0) {
    return { skillScore: 0.2, matchingSkills: [] };
  }

  const matchingSkills: string[] = [];
  let totalMatch = 0;

  for (const domain of taskDomains) {
    const domainLower = domain.toLowerCase();

    for (const skill of agent.skills) {
      const skillLower = skill.domain.toLowerCase();

      if (skillLower === domainLower) {
        totalMatch += skill.level;
        matchingSkills.push(skill.domain);
      } else if (skillLower.includes(domainLower) || domainLower.includes(skillLower)) {
        totalMatch += skill.level * 0.5;
        matchingSkills.push(skill.domain);
      }
    }
  }

  const maxPossible = taskDomains.length;
  const skillScore = maxPossible > 0 ? Math.min(totalMatch / maxPossible, 1.0) : 0;

  return { skillScore, matchingSkills: [...new Set(matchingSkills)] };
}

/**
 * Load balancing: agents with fewer active tasks score higher.
 */
function computeLoadScore(currentLoad: number, maxConcurrent: number): number {
  if (maxConcurrent <= 0) return 0;
  return clamp(1 - (currentLoad / maxConcurrent));
}

/**
 * Recency: agents who were active more recently score higher.
 * Decays over 24 hours.
 */
function computeRecencyScore(agent: AgentIdentity): number {
  const lastActive = agent.stats.lastActive;
  if (!lastActive) return 0.3;

  const hoursSinceActive = (Date.now() - lastActive) / (1000 * 60 * 60);
  if (hoursSinceActive < 1) return 1.0;
  if (hoursSinceActive < 4) return 0.8;
  if (hoursSinceActive < 12) return 0.5;
  if (hoursSinceActive < 24) return 0.3;
  return 0.1;
}

/**
 * Infer domains from a task title when no labels are present.
 * Extracts key technical terms.
 */
function inferDomains(title: string): string[] {
  const words = title.toLowerCase().split(/\s+/);
  const techTerms = [
    "api", "ui", "frontend", "backend", "database", "db", "auth",
    "test", "testing", "deploy", "ci", "cd", "docker", "kubernetes",
    "security", "performance", "bug", "fix", "refactor", "docs",
    "documentation", "migration", "integration", "webhook", "cron",
    "telegram", "discord", "slack", "email", "notification",
    "config", "infrastructure", "monitoring", "logging",
  ];
  return words.filter((w) => techTerms.includes(w));
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}
