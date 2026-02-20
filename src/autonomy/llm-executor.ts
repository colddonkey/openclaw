/**
 * LLM-powered WorkExecutor.
 *
 * Delegates task step execution to an AI agent via the gateway's
 * `agent` RPC method. The AI gets the full coding tool suite
 * (file editing, shell commands, etc.) and works on the step
 * description within a persistent session.
 *
 * Each agent gets its own session keyed by `autonomy:<agentId>`,
 * so conversation context persists across steps within a task.
 *
 * The system prompt is built dynamically per execution to include
 * the agent's identity (name, personality, traits, skills, focus).
 */

import type { AgentIdentityStore } from "../tasks/agent-identity.js";
import { getSharedIdentityStore } from "../tasks/store-registry.js";
import type { WorkExecutor } from "./agent-loop.js";
import { runAgentStep } from "../agents/tools/agent-step.js";

export type LlmExecutorConfig = {
  /** Extra system prompt injected into every agent step. */
  extraSystemPrompt?: string;
  /** Timeout per step in milliseconds. Default: 120000 (2 min). */
  stepTimeoutMs?: number;
  /** Channel hint for formatting. Default: "internal". */
  channel?: string;
  /** Optional identity store reference (falls back to shared singleton). */
  identityStore?: AgentIdentityStore;
};

const DEFAULT_STEP_TIMEOUT_MS = 120_000;

const BASE_SYSTEM_PROMPT = [
  "Focus on completing the specific step described below.",
  "Be thorough but concise. Complete the work and report what you did.",
  "If you encounter a blocker, describe it clearly.",
  "Do not ask clarifying questions — make reasonable assumptions and proceed.",
  "After completing work, post a brief summary to the task's comms channel.",
].join("\n");

/**
 * Build a dynamic system prompt that includes agent identity, personality,
 * focus areas, traits, and skills. Falls back to a generic prompt if
 * the identity store is unavailable.
 */
function buildIdentityPrompt(agentId: string, store?: AgentIdentityStore): string {
  try {
    const ids = store ?? getSharedIdentityStore();
    const identity = ids.get(agentId);
    if (!identity) return `You are ${agentId}, an autonomous agent.\n${BASE_SYSTEM_PROMPT}`;

    const parts: string[] = [];
    const name = identity.seed?.displayName || agentId;
    const personality = identity.seed?.personality;
    const focus = identity.seed?.focus;

    parts.push(`You are ${name}${personality ? `, ${personality}` : ", an autonomous agent"}.`);

    if (focus && focus.length > 0) {
      parts.push(`Your focus areas: ${focus.join(", ")}.`);
    }

    const strongTraits = identity.traits.filter(t => t.strength >= 0.3);
    if (strongTraits.length > 0) {
      const traitList = strongTraits.map(t => t.key).join(", ");
      parts.push(`Your defining traits: ${traitList}.`);
    }

    const topSkills = identity.skills.filter(s => s.level >= 0.1).slice(0, 5);
    if (topSkills.length > 0) {
      const skillList = topSkills.map(s => `${s.domain} (${(s.level * 100).toFixed(0)}%)`).join(", ");
      parts.push(`Your skills: ${skillList}.`);
    }

    if (identity.selfReflection) {
      parts.push(`Your self-reflection: ${identity.selfReflection.slice(0, 300)}`);
    }

    parts.push("");
    parts.push(BASE_SYSTEM_PROMPT);

    return parts.join("\n");
  } catch {
    return `You are ${agentId}, an autonomous agent.\n${BASE_SYSTEM_PROMPT}`;
  }
}

/**
 * Create a WorkExecutor that delegates to the AI agent pipeline.
 *
 * The executor:
 * 1. Builds a dynamic system prompt from agent identity + step context
 * 2. Calls `runAgentStep` (gateway RPC -> full agent pipeline with tools)
 * 3. Returns the AI's response as the step output
 */
export function createLlmExecutor(config: LlmExecutorConfig = {}): WorkExecutor {
  const stepTimeoutMs = config.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const identityStore = config.identityStore;

  return async ({ agentId, taskId, stepDescription, stepIndex, totalSteps, model }) => {
    const sessionKey = `autonomy:${agentId}`;
    const message = buildStepMessage(taskId, stepDescription, stepIndex, totalSteps);

    const dynamicPrompt = buildIdentityPrompt(agentId, identityStore);
    const systemPrompt = config.extraSystemPrompt
      ? `${dynamicPrompt}\n\n${config.extraSystemPrompt}`
      : dynamicPrompt;

    try {
      const reply = await runAgentStep({
        sessionKey,
        message,
        extraSystemPrompt: systemPrompt,
        timeoutMs: stepTimeoutMs,
        channel: config.channel ?? "internal",
        lane: "autonomy",
        sourceTool: "autonomy-executor",
        model,
      });

      if (!reply) {
        return {
          output: "Agent did not produce a response within the timeout",
          success: false,
        };
      }

      const success = !looksLikeFailure(reply);
      return { output: reply, success };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: `Executor error: ${msg}`, success: false };
    }
  };
}

function buildStepMessage(
  taskId: string,
  stepDescription: string,
  stepIndex: number,
  totalSteps: number,
): string {
  // Detect triage steps by prefix convention
  if (stepDescription.startsWith("TRIAGE:")) {
    return [
      "## Task Triage",
      "",
      `**Task ID:** ${taskId}`,
      `**Objective:** ${stepDescription.slice(7).trim()}`,
      "",
      "Produce a structured plan with:",
      "1. **Context**: What you know about this work area",
      "2. **Approach**: How to tackle it",
      "3. **Risks**: Potential issues or unknowns",
      "4. **Estimate**: Time/effort estimate",
      "",
      "If this task should be broken into smaller subtasks, list them under a `## Subtasks` heading:",
      "- Each subtask on its own bullet line",
      "- Keep subtasks small and actionable",
    ].join("\n");
  }

  return [
    `## Task Step ${stepIndex + 1}/${totalSteps}`,
    "",
    `**Task ID:** ${taskId}`,
    `**Step:** ${stepDescription}`,
    "",
    "Complete this step. When done, summarize what you did.",
  ].join("\n");
}

/**
 * Heuristic to detect failure responses from the AI.
 * This is intentionally conservative — most responses are considered successful.
 */
function looksLikeFailure(reply: string): boolean {
  const lower = reply.toLowerCase();
  const failurePatterns = [
    "i cannot",
    "i'm unable to",
    "i am unable to",
    "error:",
    "failed to",
    "permission denied",
    "access denied",
    "not found",
    "does not exist",
    "blocker:",
    "blocked by",
  ];
  return failurePatterns.some((p) => lower.includes(p));
}
