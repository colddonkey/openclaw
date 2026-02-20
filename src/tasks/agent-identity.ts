/**
 * Emergent Agent Identity — grows from experience, not configuration.
 *
 * Each agent starts with minimal seed traits. As it works on tasks,
 * conversations, and interactions, its identity develops:
 *
 * - Skills emerge from task domains completed successfully
 * - Traits develop from behavioral patterns (detail-oriented, creative, etc.)
 * - Preferences form based on interaction history
 * - Stats accumulate from work completed
 *
 * The static IdentityConfig (name, avatar, theme) from openclaw.json
 * provides the agent's "given name" — this module provides the soul.
 */

import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { requireNodeSqlite } from "../memory/sqlite.js";
import { normalizeAgentId } from "../routing/session-key.js";

const log = createSubsystemLogger("agent-identity");

export type AgentTrait = {
  key: string;
  strength: number;
  evidence: string[];
  firstSeen: number;
  lastReinforced: number;
};

export type AgentSkill = {
  domain: string;
  level: number;
  taskCount: number;
  successCount: number;
  lastPracticed: number;
};

export type AgentStats = {
  tasksCompleted: number;
  tasksFailed: number;
  tasksCreated: number;
  commentsGiven: number;
  conversationsHad: number;
  messagesSent: number;
  reflections: number;
  totalWorkMinutes: number;
  lastActive: number;
};

export type AgentSeed = {
  personality?: string;
  focus?: string[];
  displayName?: string;
  avatarUrl?: string;
};

export type AgentIdentity = {
  agentId: string;
  seed: AgentSeed;
  traits: AgentTrait[];
  skills: AgentSkill[];
  stats: AgentStats;
  /** Free-form notes the agent writes about itself. */
  selfReflection: string;
  createdAt: number;
  updatedAt: number;
};

export type TraitReinforcement = {
  key: string;
  delta: number;
  evidence: string;
};

export type SkillUpdate = {
  domain: string;
  success: boolean;
  taskId?: string;
};

function ensureIdentitySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_identities (
      agent_id TEXT PRIMARY KEY,
      seed TEXT NOT NULL DEFAULT '{}',
      self_reflection TEXT NOT NULL DEFAULT '',
      stats TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_traits (
      agent_id TEXT NOT NULL,
      key TEXT NOT NULL,
      strength REAL NOT NULL DEFAULT 0.1,
      evidence TEXT NOT NULL DEFAULT '[]',
      first_seen INTEGER NOT NULL,
      last_reinforced INTEGER NOT NULL,
      PRIMARY KEY (agent_id, key)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_skills (
      agent_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      level REAL NOT NULL DEFAULT 0.1,
      task_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      last_practiced INTEGER NOT NULL,
      PRIMARY KEY (agent_id, domain)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_work_state (
      agent_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_traits_agent ON agent_traits(agent_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_skills_agent ON agent_skills(agent_id);`);
}

const DEFAULT_STATS: AgentStats = {
  tasksCompleted: 0,
  tasksFailed: 0,
  tasksCreated: 0,
  commentsGiven: 0,
  conversationsHad: 0,
  messagesSent: 0,
  reflections: 0,
  totalWorkMinutes: 0,
  lastActive: 0,
};

const MAX_TRAIT_STRENGTH = 1.0;
const MIN_TRAIT_STRENGTH = 0.0;
const TRAIT_DECAY_PER_DAY = 0.005;
const MAX_EVIDENCE_PER_TRAIT = 20;
const SKILL_LEVEL_INCREMENT = 0.05;
const SKILL_LEVEL_DECREMENT = 0.02;

export class AgentIdentityStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const sqlite = requireNodeSqlite();
    this.db = new sqlite.DatabaseSync(dbPath);
    ensureIdentitySchema(this.db);
    log.info(`agent identity store opened: ${dbPath}`);
  }

  /** Normalize agent IDs so "Bee", "BEE", "bee" all resolve to the same identity. */
  private norm(agentId: string): string {
    return normalizeAgentId(agentId);
  }

  close(): void {
    this.db.close();
  }

  // ── Identity CRUD ────────────────────────────────────────────────

  /**
   * Get or create an identity for the given agentId.
   * Agents spring into existence on first access — no pre-registration needed.
   */
  getOrCreate(agentId: string, seed?: AgentSeed): AgentIdentity {
    const id = this.norm(agentId);
    const existing = this.get(id);
    if (existing) return existing;

    const now = Date.now();
    this.db.prepare(`
      INSERT INTO agent_identities (agent_id, seed, self_reflection, stats, created_at, updated_at)
      VALUES (?, ?, '', ?, ?, ?)
    `).run(
      id,
      JSON.stringify(seed ?? {}),
      JSON.stringify(DEFAULT_STATS),
      now,
      now,
    );

    log.info(`new agent identity created: ${id}`);
    return this.get(id)!;
  }

  get(agentId: string): AgentIdentity | null {
    const id = this.norm(agentId);
    const row = this.db.prepare(`
      SELECT * FROM agent_identities WHERE agent_id = ?
    `).get(id) as Record<string, unknown> | undefined;

    if (!row) return null;

    const traits = this.getTraits(id);
    const skills = this.getSkills(id);

    return {
      agentId: row.agent_id as string,
      seed: JSON.parse((row.seed as string) || "{}"),
      traits,
      skills,
      stats: JSON.parse((row.stats as string) || "{}"),
      selfReflection: (row.self_reflection as string) || "",
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  listAll(): AgentIdentity[] {
    const rows = this.db.prepare(`
      SELECT agent_id FROM agent_identities ORDER BY updated_at DESC
    `).all() as Array<{ agent_id: string }>;

    return rows.map((r) => this.get(r.agent_id)).filter(Boolean) as AgentIdentity[];
  }

  // ── Trait development ────────────────────────────────────────────

  /**
   * Reinforce or create a trait. Traits emerge from repeated patterns.
   * Strength grows with each reinforcement, capped at 1.0.
   */
  reinforceTrait(agentId: string, reinforcement: TraitReinforcement): AgentTrait {
    const id = this.norm(agentId);
    this.getOrCreate(id);
    const now = Date.now();

    const existing = this.db.prepare(`
      SELECT * FROM agent_traits WHERE agent_id = ? AND key = ?
    `).get(id, reinforcement.key) as Record<string, unknown> | undefined;

    if (existing) {
      let evidence: string[] = JSON.parse((existing.evidence as string) || "[]");
      evidence.push(reinforcement.evidence);
      if (evidence.length > MAX_EVIDENCE_PER_TRAIT) {
        evidence = evidence.slice(-MAX_EVIDENCE_PER_TRAIT);
      }

      const newStrength = Math.min(
        MAX_TRAIT_STRENGTH,
        (existing.strength as number) + reinforcement.delta,
      );

      this.db.prepare(`
        UPDATE agent_traits
        SET strength = ?, evidence = ?, last_reinforced = ?
        WHERE agent_id = ? AND key = ?
      `).run(newStrength, JSON.stringify(evidence), now, id, reinforcement.key);

      return {
        key: reinforcement.key,
        strength: newStrength,
        evidence,
        firstSeen: existing.first_seen as number,
        lastReinforced: now,
      };
    }

    const strength = Math.max(MIN_TRAIT_STRENGTH, Math.min(MAX_TRAIT_STRENGTH, reinforcement.delta));

    this.db.prepare(`
      INSERT INTO agent_traits (agent_id, key, strength, evidence, first_seen, last_reinforced)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, reinforcement.key, strength, JSON.stringify([reinforcement.evidence]), now, now);

    log.info(`new trait emerged for ${id}: ${reinforcement.key} (${strength.toFixed(2)})`);

    return {
      key: reinforcement.key,
      strength,
      evidence: [reinforcement.evidence],
      firstSeen: now,
      lastReinforced: now,
    };
  }

  /**
   * Apply time-based decay to traits that haven't been reinforced recently.
   * Traits that aren't practiced fade slowly.
   */
  decayTraits(agentId: string): number {
    const id = this.norm(agentId);
    const now = Date.now();
    const traits = this.getTraits(id);
    let decayed = 0;

    for (const trait of traits) {
      const daysSinceReinforced = (now - trait.lastReinforced) / (1000 * 60 * 60 * 24);
      if (daysSinceReinforced < 1) continue;

      const decay = TRAIT_DECAY_PER_DAY * daysSinceReinforced;
      const newStrength = Math.max(MIN_TRAIT_STRENGTH, trait.strength - decay);

      if (newStrength < 0.01) {
        this.db.prepare(`DELETE FROM agent_traits WHERE agent_id = ? AND key = ?`)
          .run(id, trait.key);
        log.info(`trait faded for ${id}: ${trait.key}`);
      } else {
        this.db.prepare(`
          UPDATE agent_traits SET strength = ? WHERE agent_id = ? AND key = ?
        `).run(newStrength, id, trait.key);
      }
      decayed++;
    }

    return decayed;
  }

  getTraits(agentId: string): AgentTrait[] {
    const id = this.norm(agentId);
    const rows = this.db.prepare(`
      SELECT * FROM agent_traits WHERE agent_id = ? ORDER BY strength DESC
    `).all(id) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      key: r.key as string,
      strength: r.strength as number,
      evidence: JSON.parse((r.evidence as string) || "[]"),
      firstSeen: r.first_seen as number,
      lastReinforced: r.last_reinforced as number,
    }));
  }

  // ── Skill development ────────────────────────────────────────────

  /**
   * Record a skill update from task completion. Skills grow from
   * successful task completions in specific domains.
   */
  recordSkillUpdate(agentId: string, update: SkillUpdate): AgentSkill {
    const id = this.norm(agentId);
    this.getOrCreate(id);
    const now = Date.now();

    const existing = this.db.prepare(`
      SELECT * FROM agent_skills WHERE agent_id = ? AND domain = ?
    `).get(id, update.domain) as Record<string, unknown> | undefined;

    if (existing) {
      const taskCount = (existing.task_count as number) + 1;
      const successCount = (existing.success_count as number) + (update.success ? 1 : 0);
      const levelDelta = update.success ? SKILL_LEVEL_INCREMENT : -SKILL_LEVEL_DECREMENT;
      const newLevel = Math.max(0, Math.min(1, (existing.level as number) + levelDelta));

      this.db.prepare(`
        UPDATE agent_skills
        SET level = ?, task_count = ?, success_count = ?, last_practiced = ?
        WHERE agent_id = ? AND domain = ?
      `).run(newLevel, taskCount, successCount, now, id, update.domain);

      return {
        domain: update.domain,
        level: newLevel,
        taskCount,
        successCount,
        lastPracticed: now,
      };
    }

    const level = update.success ? SKILL_LEVEL_INCREMENT : 0;

    this.db.prepare(`
      INSERT INTO agent_skills (agent_id, domain, level, task_count, success_count, last_practiced)
      VALUES (?, ?, ?, 1, ?, ?)
    `).run(id, update.domain, level, update.success ? 1 : 0, now);

    log.info(`new skill for ${id}: ${update.domain}`);

    return {
      domain: update.domain,
      level,
      taskCount: 1,
      successCount: update.success ? 1 : 0,
      lastPracticed: now,
    };
  }

  getSkills(agentId: string): AgentSkill[] {
    const id = this.norm(agentId);
    const rows = this.db.prepare(`
      SELECT * FROM agent_skills WHERE agent_id = ? ORDER BY level DESC
    `).all(id) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      domain: r.domain as string,
      level: r.level as number,
      taskCount: r.task_count as number,
      successCount: r.success_count as number,
      lastPracticed: r.last_practiced as number,
    }));
  }

  // ── Stats ────────────────────────────────────────────────────────

  incrementStat(agentId: string, stat: keyof AgentStats, amount = 1): void {
    const id = this.norm(agentId);
    const identity = this.getOrCreate(id);
    const stats = { ...identity.stats };

    if (stat === "lastActive") {
      stats.lastActive = Date.now();
    } else {
      (stats[stat] as number) += amount;
    }
    stats.lastActive = Date.now();

    this.db.prepare(`
      UPDATE agent_identities SET stats = ?, updated_at = ? WHERE agent_id = ?
    `).run(JSON.stringify(stats), Date.now(), id);
  }

  // ── Self-reflection ──────────────────────────────────────────────

  updateSeed(agentId: string, patch: Partial<AgentSeed>): void {
    const id = this.norm(agentId);
    const identity = this.getOrCreate(id);
    const merged = { ...identity.seed, ...patch };
    this.db.prepare(`
      UPDATE agent_identities SET seed = ?, updated_at = ? WHERE agent_id = ?
    `).run(JSON.stringify(merged), Date.now(), id);
  }

  updateSelfReflection(agentId: string, reflection: string): void {
    const id = this.norm(agentId);
    this.getOrCreate(id);
    this.db.prepare(`
      UPDATE agent_identities SET self_reflection = ?, updated_at = ? WHERE agent_id = ?
    `).run(reflection, Date.now(), id);
  }

  // ── Identity summary (for prompts/display) ───────────────────────

  /**
   * Generate a natural language summary of this agent's identity.
   * Used for system prompts, Telegram board display, etc.
   */
  summarize(agentId: string): string {
    const id = this.norm(agentId);
    const identity = this.get(id);
    if (!identity) return `Agent ${id} (no identity yet)`;

    const parts: string[] = [];

    const strongTraits = identity.traits.filter((t) => t.strength >= 0.3);
    if (strongTraits.length > 0) {
      const traitWords = strongTraits.map((t) => t.key).join(", ");
      parts.push(`Traits: ${traitWords}`);
    }

    const topSkills = identity.skills.slice(0, 5);
    if (topSkills.length > 0) {
      const skillWords = topSkills
        .map((s) => `${s.domain} (${(s.level * 100).toFixed(0)}%)`)
        .join(", ");
      parts.push(`Skills: ${skillWords}`);
    }

    const s = identity.stats;
    if (s.tasksCompleted > 0) {
      const successRate = s.tasksCompleted / Math.max(1, s.tasksCompleted + s.tasksFailed);
      parts.push(
        `Experience: ${s.tasksCompleted} tasks completed (${(successRate * 100).toFixed(0)}% success)`,
      );
    }

    if (identity.selfReflection) {
      parts.push(`Self: ${identity.selfReflection.slice(0, 200)}`);
    }

    if (parts.length === 0) {
      return `Agent ${agentId} (newly created, developing identity)`;
    }

    return parts.join("\n");
  }

  // ── Work state persistence (survives gateway restarts) ──────────

  /**
   * Save the agent's in-flight work state (current task, work plan, step index).
   * Called by AgentLoop on phase changes and step completions.
   */
  saveWorkState(agentId: string, state: Record<string, unknown>): void {
    const id = this.norm(agentId);
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO agent_work_state (agent_id, state_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
    `).run(id, JSON.stringify(state), now);
  }

  /**
   * Load previously saved work state for an agent.
   * Returns null if no saved state exists.
   */
  loadWorkState(agentId: string): Record<string, unknown> | null {
    const id = this.norm(agentId);
    const row = this.db.prepare(`
      SELECT state_json FROM agent_work_state WHERE agent_id = ?
    `).get(id) as { state_json: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.state_json);
    } catch {
      return null;
    }
  }

  /** Clear saved work state (e.g. when work is complete or loop is stopped cleanly). */
  clearWorkState(agentId: string): void {
    const id = this.norm(agentId);
    this.db.prepare(`DELETE FROM agent_work_state WHERE agent_id = ?`).run(id);
  }

  /**
   * Find the best agent for a given domain based on skill levels.
   * Returns agents sorted by skill level descending.
   */
  findBestAgentForDomain(domain: string): Array<{ agentId: string; skill: AgentSkill }> {
    const rows = this.db.prepare(`
      SELECT agent_id, level, task_count, success_count, last_practiced
      FROM agent_skills WHERE domain = ? ORDER BY level DESC
    `).all(domain) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      agentId: r.agent_id as string,
      skill: {
        domain,
        level: r.level as number,
        taskCount: r.task_count as number,
        successCount: r.success_count as number,
        lastPracticed: r.last_practiced as number,
      },
    }));
  }
}
