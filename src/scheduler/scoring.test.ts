import { describe, expect, it } from "vitest";
import { rankAgentsForTask, scoreAgent } from "./scoring.js";
import type { AgentIdentity, AgentSkill, AgentStats } from "../tasks/agent-identity.js";
import type { Task, TaskStatus, TaskPriority } from "../tasks/types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task_test",
    title: "Fix the login bug",
    description: "",
    status: "ready" as TaskStatus,
    priority: "medium" as TaskPriority,
    assigneeId: null,
    assigneeName: null,
    creatorId: "system",
    creatorName: "System",
    labels: [],
    sessionKey: null,
    parentId: null,
    source: "manual",
    metadata: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: null,
    completedAt: null,
    estimateMinutes: null,
    ...overrides,
  };
}

const DEFAULT_STATS: AgentStats = {
  tasksCompleted: 5,
  tasksFailed: 0,
  tasksCreated: 3,
  commentsGiven: 10,
  conversationsHad: 8,
  totalWorkMinutes: 120,
  lastActive: Date.now() - 1000 * 60 * 30, // 30 min ago
};

function makeAgent(id: string, skills: AgentSkill[] = [], overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    agentId: id,
    seed: {},
    traits: [],
    skills,
    stats: { ...DEFAULT_STATS },
    selfReflection: "",
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeSkill(domain: string, level: number): AgentSkill {
  return {
    domain,
    level,
    taskCount: Math.floor(level * 20),
    successCount: Math.floor(level * 18),
    lastPracticed: Date.now() - 3600000,
  };
}

describe("scoring", () => {
  describe("scoreAgent", () => {
    it("gives higher skill score when labels match skills", () => {
      const task = makeTask({ labels: ["auth", "security"] });
      const agent = makeAgent("a", [makeSkill("auth", 0.8), makeSkill("security", 0.6)]);

      const score = scoreAgent(task, agent, 0);
      expect(score.skillScore).toBeGreaterThan(0.5);
      expect(score.matchingSkills).toContain("auth");
      expect(score.matchingSkills).toContain("security");
    });

    it("gives low skill score when no labels match", () => {
      const task = makeTask({ labels: ["frontend", "ui"] });
      const agent = makeAgent("a", [makeSkill("database", 0.9)]);

      const score = scoreAgent(task, agent, 0);
      expect(score.skillScore).toBeLessThan(0.3);
    });

    it("gives higher load score when agent has fewer tasks", () => {
      const task = makeTask();
      const agent = makeAgent("a");

      const idle = scoreAgent(task, agent, 0);
      const busy = scoreAgent(task, agent, 2);

      expect(idle.loadScore).toBeGreaterThan(busy.loadScore);
    });

    it("gives maximum load score when agent has zero tasks", () => {
      const task = makeTask();
      const agent = makeAgent("a");

      const score = scoreAgent(task, agent, 0);
      expect(score.loadScore).toBe(1.0);
    });

    it("gives zero load score when agent is at max capacity", () => {
      const task = makeTask();
      const agent = makeAgent("a");

      const score = scoreAgent(task, agent, 3, { maxConcurrentPerAgent: 3 });
      expect(score.loadScore).toBe(0);
    });

    it("gives higher recency score for recently active agents", () => {
      const task = makeTask();

      const recentAgent = makeAgent("a", [], {
        stats: { ...DEFAULT_STATS, lastActive: Date.now() - 1000 * 60 * 10 }, // 10 min ago
      });
      const staleAgent = makeAgent("b", [], {
        stats: { ...DEFAULT_STATS, lastActive: Date.now() - 1000 * 60 * 60 * 48 }, // 48h ago
      });

      const recent = scoreAgent(task, recentAgent, 0);
      const stale = scoreAgent(task, staleAgent, 0);

      expect(recent.recencyScore).toBeGreaterThan(stale.recencyScore);
    });

    it("total score combines all dimensions", () => {
      const task = makeTask({ labels: ["api"] });
      const agent = makeAgent("a", [makeSkill("api", 0.9)]);

      const score = scoreAgent(task, agent, 0);
      expect(score.totalScore).toBeGreaterThan(0);
      expect(score.totalScore).toBeLessThanOrEqual(1);
    });

    it("infers domains from title when no labels", () => {
      const task = makeTask({ title: "Fix the api auth bug", labels: [] });
      const agent = makeAgent("a", [makeSkill("api", 0.7), makeSkill("auth", 0.6)]);

      const score = scoreAgent(task, agent, 0);
      expect(score.matchingSkills.length).toBeGreaterThan(0);
    });
  });

  describe("rankAgentsForTask", () => {
    it("returns agents sorted by score", () => {
      const task = makeTask({ labels: ["database"] });
      const agents = [
        makeAgent("a", [makeSkill("frontend", 0.8)]),
        makeAgent("b", [makeSkill("database", 0.9)]),
        makeAgent("c", [makeSkill("database", 0.4)]),
      ];
      const loadMap = new Map([["a", 0], ["b", 0], ["c", 0]]);

      const ranked = rankAgentsForTask(task, agents, loadMap);
      expect(ranked[0].agentId).toBe("b");
      expect(ranked[1].agentId).toBe("c");
    });

    it("excludes agents at max capacity", () => {
      const task = makeTask();
      const agents = [
        makeAgent("a"),
        makeAgent("b"),
      ];
      const loadMap = new Map([["a", 3], ["b", 1]]);

      const ranked = rankAgentsForTask(task, agents, loadMap, { maxConcurrentPerAgent: 3 });
      expect(ranked.length).toBe(1);
      expect(ranked[0].agentId).toBe("b");
    });

    it("returns empty when all agents at capacity", () => {
      const task = makeTask();
      const agents = [makeAgent("a"), makeAgent("b")];
      const loadMap = new Map([["a", 3], ["b", 3]]);

      const ranked = rankAgentsForTask(task, agents, loadMap, { maxConcurrentPerAgent: 3 });
      expect(ranked).toHaveLength(0);
    });

    it("considers load when skills are equal", () => {
      const task = makeTask({ labels: ["api"] });
      const agents = [
        makeAgent("a", [makeSkill("api", 0.5)]),
        makeAgent("b", [makeSkill("api", 0.5)]),
      ];
      const loadMap = new Map([["a", 2], ["b", 0]]);

      const ranked = rankAgentsForTask(task, agents, loadMap);
      expect(ranked[0].agentId).toBe("b");
    });
  });
});
