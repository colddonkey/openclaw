import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentIdentityStore } from "./agent-identity.js";

let store: AgentIdentityStore;
let dbPath: string;

beforeEach(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-identity-"));
  dbPath = path.join(tmpDir, "identities.sqlite");
  store = new AgentIdentityStore(dbPath);
});

afterEach(() => {
  store.close();
  try {
    fs.unlinkSync(dbPath);
  } catch {}
});

describe("AgentIdentityStore basics", () => {
  it("creates identity on first access", () => {
    const identity = store.getOrCreate("alpha");
    expect(identity.agentId).toBe("alpha");
    expect(identity.traits).toEqual([]);
    expect(identity.skills).toEqual([]);
    expect(identity.stats.tasksCompleted).toBe(0);
    expect(identity.selfReflection).toBe("");
    expect(identity.createdAt).toBeGreaterThan(0);
  });

  it("returns existing identity on subsequent access", () => {
    store.getOrCreate("alpha", { personality: "curious" });
    const second = store.getOrCreate("alpha");
    expect(second.seed.personality).toBe("curious");
  });

  it("returns null for unknown agent", () => {
    expect(store.get("nonexistent")).toBeNull();
  });

  it("lists all agents", () => {
    store.getOrCreate("alpha");
    store.getOrCreate("beta");
    store.getOrCreate("gamma");

    const all = store.listAll();
    expect(all).toHaveLength(3);
  });
});

describe("trait development", () => {
  it("creates a new trait on first reinforcement", () => {
    store.getOrCreate("alpha");
    const trait = store.reinforceTrait("alpha", {
      key: "detail-oriented",
      delta: 0.15,
      evidence: "task_001: thorough code review",
    });

    expect(trait.key).toBe("detail-oriented");
    expect(trait.strength).toBe(0.15);
    expect(trait.evidence).toEqual(["task_001: thorough code review"]);
  });

  it("strengthens trait on repeated reinforcement", () => {
    store.getOrCreate("alpha");
    store.reinforceTrait("alpha", {
      key: "systematic",
      delta: 0.1,
      evidence: "task_001",
    });
    const updated = store.reinforceTrait("alpha", {
      key: "systematic",
      delta: 0.1,
      evidence: "task_002",
    });

    expect(updated.strength).toBeCloseTo(0.2);
    expect(updated.evidence).toHaveLength(2);
  });

  it("caps trait strength at 1.0", () => {
    store.getOrCreate("alpha");
    for (let i = 0; i < 20; i++) {
      store.reinforceTrait("alpha", {
        key: "persistent",
        delta: 0.1,
        evidence: `task_${i}`,
      });
    }

    const traits = store.getTraits("alpha");
    const persistent = traits.find((t) => t.key === "persistent");
    expect(persistent!.strength).toBeLessThanOrEqual(1.0);
  });

  it("trims evidence to max limit", () => {
    store.getOrCreate("alpha");
    for (let i = 0; i < 30; i++) {
      store.reinforceTrait("alpha", {
        key: "verbose",
        delta: 0.01,
        evidence: `evidence_${i}`,
      });
    }

    const traits = store.getTraits("alpha");
    const verbose = traits.find((t) => t.key === "verbose");
    expect(verbose!.evidence.length).toBeLessThanOrEqual(20);
    expect(verbose!.evidence[verbose!.evidence.length - 1]).toBe("evidence_29");
  });

  it("creates identity automatically if it doesn't exist", () => {
    const trait = store.reinforceTrait("newbie", {
      key: "curious",
      delta: 0.1,
      evidence: "first interaction",
    });

    expect(trait.key).toBe("curious");
    expect(store.get("newbie")).not.toBeNull();
  });
});

describe("skill development", () => {
  it("creates a new skill on first task", () => {
    store.getOrCreate("alpha");
    const skill = store.recordSkillUpdate("alpha", {
      domain: "typescript",
      success: true,
    });

    expect(skill.domain).toBe("typescript");
    expect(skill.level).toBeGreaterThan(0);
    expect(skill.taskCount).toBe(1);
    expect(skill.successCount).toBe(1);
  });

  it("increases skill level on success", () => {
    store.getOrCreate("alpha");
    store.recordSkillUpdate("alpha", { domain: "testing", success: true });
    const updated = store.recordSkillUpdate("alpha", { domain: "testing", success: true });

    expect(updated.level).toBeGreaterThan(0.05);
    expect(updated.taskCount).toBe(2);
    expect(updated.successCount).toBe(2);
  });

  it("decreases skill level on failure", () => {
    store.getOrCreate("alpha");
    store.recordSkillUpdate("alpha", { domain: "debugging", success: true });
    store.recordSkillUpdate("alpha", { domain: "debugging", success: true });
    const failed = store.recordSkillUpdate("alpha", { domain: "debugging", success: false });

    expect(failed.level).toBeLessThan(0.1);
    expect(failed.taskCount).toBe(3);
    expect(failed.successCount).toBe(2);
  });

  it("skill level never goes below 0", () => {
    store.getOrCreate("alpha");
    for (let i = 0; i < 10; i++) {
      store.recordSkillUpdate("alpha", { domain: "struggling", success: false });
    }

    const skills = store.getSkills("alpha");
    const struggling = skills.find((s) => s.domain === "struggling");
    expect(struggling!.level).toBeGreaterThanOrEqual(0);
  });
});

describe("stats tracking", () => {
  it("increments stats", () => {
    store.getOrCreate("alpha");
    store.incrementStat("alpha", "tasksCompleted");
    store.incrementStat("alpha", "tasksCompleted");
    store.incrementStat("alpha", "commentsGiven", 3);

    const identity = store.get("alpha")!;
    expect(identity.stats.tasksCompleted).toBe(2);
    expect(identity.stats.commentsGiven).toBe(3);
    expect(identity.stats.lastActive).toBeGreaterThan(0);
  });
});

describe("self-reflection", () => {
  it("stores agent self-reflection", () => {
    store.getOrCreate("alpha");
    store.updateSelfReflection(
      "alpha",
      "I seem to be good at finding edge cases in code. I enjoy thorough reviews.",
    );

    const identity = store.get("alpha")!;
    expect(identity.selfReflection).toContain("edge cases");
  });
});

describe("summarize", () => {
  it("summarizes a new agent", () => {
    store.getOrCreate("newbie");
    const summary = store.summarize("newbie");
    expect(summary).toContain("newly created");
  });

  it("summarizes an experienced agent", () => {
    store.getOrCreate("veteran");
    store.reinforceTrait("veteran", { key: "thorough", delta: 0.5, evidence: "review" });
    store.recordSkillUpdate("veteran", { domain: "typescript", success: true });
    store.recordSkillUpdate("veteran", { domain: "typescript", success: true });
    store.incrementStat("veteran", "tasksCompleted", 10);

    const summary = store.summarize("veteran");
    expect(summary).toContain("thorough");
    expect(summary).toContain("typescript");
    expect(summary).toContain("10 tasks completed");
  });

  it("returns unknown message for nonexistent agent", () => {
    expect(store.summarize("ghost")).toContain("no identity yet");
  });
});

describe("findBestAgentForDomain", () => {
  it("finds agents sorted by skill level", () => {
    store.getOrCreate("alpha");
    store.getOrCreate("beta");
    store.recordSkillUpdate("alpha", { domain: "typescript", success: true });
    store.recordSkillUpdate("alpha", { domain: "typescript", success: true });
    store.recordSkillUpdate("beta", { domain: "typescript", success: true });

    const best = store.findBestAgentForDomain("typescript");
    expect(best).toHaveLength(2);
    expect(best[0]!.agentId).toBe("alpha");
    expect(best[0]!.skill.level).toBeGreaterThan(best[1]!.skill.level);
  });

  it("returns empty for unknown domain", () => {
    expect(store.findBestAgentForDomain("quantum-computing")).toEqual([]);
  });
});
