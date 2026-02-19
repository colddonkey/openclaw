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
 */

import type { WorkExecutor } from "./agent-loop.js";
import { runAgentStep } from "../agents/tools/agent-step.js";

export type LlmExecutorConfig = {
  /** Extra system prompt injected into every agent step. */
  extraSystemPrompt?: string;
  /** Timeout per step in milliseconds. Default: 120000 (2 min). */
  stepTimeoutMs?: number;
  /** Channel hint for formatting. Default: "internal". */
  channel?: string;
};

const DEFAULT_STEP_TIMEOUT_MS = 120_000;

const DEFAULT_SYSTEM_PROMPT = [
  "You are an autonomous agent working on a task step.",
  "Focus on completing the specific step described below.",
  "Be thorough but concise. Complete the work and report what you did.",
  "If you encounter a blocker, describe it clearly.",
  "Do not ask clarifying questions — make reasonable assumptions and proceed.",
].join("\n");

/**
 * Create a WorkExecutor that delegates to the AI agent pipeline.
 *
 * The executor:
 * 1. Builds a prompt from the step description and task context
 * 2. Calls `runAgentStep` (gateway RPC → full agent pipeline with tools)
 * 3. Returns the AI's response as the step output
 */
export function createLlmExecutor(config: LlmExecutorConfig = {}): WorkExecutor {
  const systemPrompt = config.extraSystemPrompt
    ? `${DEFAULT_SYSTEM_PROMPT}\n\n${config.extraSystemPrompt}`
    : DEFAULT_SYSTEM_PROMPT;
  const stepTimeoutMs = config.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;

  return async ({ agentId, taskId, stepDescription, stepIndex, totalSteps }) => {
    const sessionKey = `autonomy:${agentId}`;
    const message = buildStepMessage(taskId, stepDescription, stepIndex, totalSteps);

    try {
      const reply = await runAgentStep({
        sessionKey,
        message,
        extraSystemPrompt: systemPrompt,
        timeoutMs: stepTimeoutMs,
        channel: config.channel ?? "internal",
        lane: "autonomy",
        sourceTool: "autonomy-executor",
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
