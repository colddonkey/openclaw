/**
 * Session handoff: AI-powered session summarization + archival on /new.
 *
 * When a user resets their session, this module:
 * 1. Reads the current transcript
 * 2. Calls the model to generate a comprehensive session summary
 * 3. Archives the transcript to a known location
 * 4. Stores the summary for injection into the next session
 */
import fs from "node:fs";
import path from "node:path";
import { completeSimple, type TextContent } from "@mariozechner/pi-ai";
import { loadConfig, type OpenClawConfig } from "../config/config.js";
import { resolveDefaultModelForAgent } from "../agents/model-selection.js";
import { resolveModel } from "../agents/pi-embedded-runner/model.js";
import { getApiKeyForModel, requireApiKey } from "../agents/model-auth.js";
import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import { resolveSessionTranscriptsDirForAgent } from "../config/sessions/paths.js";
import {
  readSessionMessages,
  resolveSessionTranscriptCandidates,
} from "./session-utils.fs.js";
import { defaultRuntime } from "../runtime.js";

const HANDOFF_SUMMARY_DIR = "session-handoffs";
const HANDOFF_TIMEOUT_MS = 120_000;
const MAX_TRANSCRIPT_CHARS = 150_000;

const HANDOFF_SUMMARY_PROMPT = `You are a session continuity assistant. Your job is to create a comprehensive handoff summary of the conversation that just ended, so the next session can pick up seamlessly.

Analyze the full conversation and produce a structured summary that includes:

1. **Session Overview**: What was the main focus of this session? (1-2 sentences)
2. **Key Decisions Made**: Important choices, preferences, or directions established
3. **Work Completed**: What was accomplished, including specific files changed, features built, configs set
4. **Open/Pending Tasks**: Anything started but not finished, or explicitly deferred
5. **Important Context**: Technical details, credentials set up, specific patterns/conventions discovered
6. **User Preferences**: Any preferences or working style notes expressed during the session
7. **State at End**: What was happening when the session ended? What was the user's last request or focus?

Be thorough and specific. Include file paths, command names, configuration values, and other concrete details.
Do NOT include sensitive information like API keys, passwords, or tokens - reference them as "configured" without values.
Keep the summary under 2000 words but be as detailed as needed within that limit.`;

export type HandoffResult = {
  summary: string;
  archivedTranscriptPath: string | null;
  summaryPath: string;
  messageCount: number;
  latencyMs: number;
};

/**
 * Extract text content from transcript messages for summarization.
 */
function extractTranscriptText(messages: unknown[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    const role = String(m.role ?? "unknown");
    const content = m.content;

    if (role === "system") {
      continue;
    }

    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const part of content) {
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          if (part.type === "text" || part.type === "output_text" || part.type === "input_text") {
            parts.push(part.text);
          }
        }
        // Indicate tool calls without dumping the full content
        if (part && typeof part === "object" && "type" in part) {
          if (part.type === "tool_call" || part.type === "toolCall") {
            const name =
              typeof (part as Record<string, unknown>).name === "string"
                ? (part as Record<string, unknown>).name
                : typeof (part as Record<string, unknown>).toolName === "string"
                  ? (part as Record<string, unknown>).toolName
                  : "unknown-tool";
            parts.push(`[tool call: ${name}]`);
          }
        }
      }
      text = parts.join("\n");
    }

    if (!text.trim()) {
      continue;
    }

    // Truncate very long individual messages (e.g. tool results)
    const trimmed = text.length > 5000 ? `${text.slice(0, 5000)}... [truncated]` : text;
    lines.push(`[${role}]: ${trimmed}`);
  }

  const joined = lines.join("\n\n");
  // Cap total transcript size for the model
  if (joined.length > MAX_TRANSCRIPT_CHARS) {
    const half = Math.floor(MAX_TRANSCRIPT_CHARS / 2);
    return (
      joined.slice(0, half) +
      "\n\n... [middle of conversation truncated for length] ...\n\n" +
      joined.slice(-half)
    );
  }
  return joined;
}

/**
 * Resolve the handoff summary directory for a given agent.
 * Lives alongside the sessions dir: ~/.openclaw/agents/{id}/session-handoffs/
 */
function resolveHandoffDir(agentId?: string): string {
  const sessionsDir = resolveSessionTranscriptsDirForAgent(agentId);
  // Go up one level from sessions/ to the agent dir, then into session-handoffs/
  return path.join(path.dirname(sessionsDir), HANDOFF_SUMMARY_DIR);
}

/**
 * List available handoff summaries for an agent, sorted by most recent first.
 */
export function listHandoffSummaries(agentId?: string): Array<{
  sessionId: string;
  path: string;
  createdAt: Date;
  sizeBytes: number;
}> {
  const dir = resolveHandoffDir(agentId);
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries: Array<{
    sessionId: string;
    path: string;
    createdAt: Date;
    sizeBytes: number;
  }> = [];

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".md")) {
      continue;
    }
    const fullPath = path.join(dir, file);
    try {
      const stat = fs.statSync(fullPath);
      entries.push({
        sessionId: file.replace(/\.md$/, ""),
        path: fullPath,
        createdAt: stat.birthtime,
        sizeBytes: stat.size,
      });
    } catch {
      // skip unreadable files
    }
  }

  return entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Read a specific handoff summary by session ID.
 */
export function readHandoffSummary(sessionId: string, agentId?: string): string | null {
  const dir = resolveHandoffDir(agentId);
  const summaryPath = path.join(dir, `${sessionId}.md`);
  if (!fs.existsSync(summaryPath)) {
    return null;
  }
  try {
    return fs.readFileSync(summaryPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Read the most recent handoff summary for an agent.
 */
export function readLatestHandoffSummary(agentId?: string): {
  summary: string;
  sessionId: string;
} | null {
  const summaries = listHandoffSummaries(agentId);
  if (summaries.length === 0) {
    return null;
  }
  const latest = summaries[0];
  const summary = readHandoffSummary(latest.sessionId, agentId);
  if (!summary) {
    return null;
  }
  return { summary, sessionId: latest.sessionId };
}

/**
 * Perform a full session handoff: summarize, archive, store.
 */
export async function performSessionHandoff(params: {
  sessionKey: string;
  sessionId: string;
  storePath: string;
  sessionFile?: string;
  cfg?: OpenClawConfig;
}): Promise<HandoffResult> {
  const startTime = Date.now();
  const cfg = params.cfg ?? loadConfig();
  const agentId = resolveAgentIdFromSessionKey(params.sessionKey);

  // 1. Read transcript messages
  const messages = readSessionMessages(params.sessionId, params.storePath, params.sessionFile);
  if (messages.length === 0) {
    return {
      summary: "Empty session - no messages to summarize.",
      archivedTranscriptPath: null,
      summaryPath: "",
      messageCount: 0,
      latencyMs: Date.now() - startTime,
    };
  }

  // 2. Build a text representation of the conversation
  const transcriptText = extractTranscriptText(messages);

  // 3. Resolve model and API key for summarization (with fallback chain)
  const modelRef = resolveDefaultModelForAgent({ cfg, agentId });
  const fallbackRefs = [
    modelRef,
    { provider: "anthropic", model: "claude-sonnet-4-5" },
    { provider: "anthropic", model: "claude-haiku-4-5" },
    { provider: "google", model: "gemini-2.0-flash" },
    { provider: "openai", model: "gpt-4o-mini" },
  ];

  let resolvedModel: import("@mariozechner/pi-ai").Model<import("@mariozechner/pi-ai").Api> | undefined;
  let apiKey: string | undefined;
  let usedRef: { provider: string; model: string } | undefined;

  for (const ref of fallbackRefs) {
    try {
      const resolved = resolveModel(ref.provider, ref.model, undefined, cfg);
      if (!resolved.model) {
        continue;
      }
      const auth = await getApiKeyForModel({ model: resolved.model, cfg });
      const key = auth.apiKey?.trim();
      if (!key) {
        continue;
      }
      resolvedModel = resolved.model;
      apiKey = key;
      usedRef = ref;
      break;
    } catch {
      // Try next fallback
    }
  }

  if (!resolvedModel || !apiKey || !usedRef) {
    throw new Error(
      `No working model found for session handoff. Tried: ${fallbackRefs.map((r) => `${r.provider}/${r.model}`).join(", ")}`,
    );
  }

  // 4. Call model for summary
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HANDOFF_TIMEOUT_MS);
  let summary: string;

  try {
    const res = await completeSimple(
      resolvedModel,
      {
        messages: [
          {
            role: "user",
            content:
              HANDOFF_SUMMARY_PROMPT +
              "\n\n<conversation_transcript>\n" +
              transcriptText +
              "\n</conversation_transcript>",
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey,
        maxTokens: 4096,
        temperature: 0.2,
        signal: controller.signal,
      },
    );

    const isTextContent = (block: unknown): block is TextContent =>
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      (block as Record<string, unknown>).type === "text";

    summary = res.content
      .filter(isTextContent)
      .map((block) => block.text.trim())
      .filter(Boolean)
      .join("\n\n")
      .trim();

    if (!summary) {
      throw new Error("Model returned empty summary");
    }
  } finally {
    clearTimeout(timeout);
  }

  // 5. Archive the transcript file
  let archivedTranscriptPath: string | null = null;
  const candidates = resolveSessionTranscriptCandidates(
    params.sessionId,
    params.storePath,
    params.sessionFile,
  );
  const transcriptPath = candidates.find((p) => fs.existsSync(p));

  if (transcriptPath) {
    try {
      const handoffDir = resolveHandoffDir(agentId);
      fs.mkdirSync(handoffDir, { recursive: true });

      // Copy (not move) the transcript so the session reset can still find it
      const archiveName = `${params.sessionId}.transcript.jsonl`;
      archivedTranscriptPath = path.join(handoffDir, archiveName);
      fs.copyFileSync(transcriptPath, archivedTranscriptPath);
    } catch (err) {
      defaultRuntime.error(`Failed to archive transcript: ${String(err)}`);
      archivedTranscriptPath = null;
    }
  }

  // 6. Store the summary
  const handoffDir = resolveHandoffDir(agentId);
  fs.mkdirSync(handoffDir, { recursive: true });

  const now = new Date();
  const summaryPath = path.join(handoffDir, `${params.sessionId}.md`);
  const summaryHeader =
    `# Session Handoff Summary\n\n` +
    `- **Session ID**: ${params.sessionId}\n` +
    `- **Session Key**: ${params.sessionKey}\n` +
    `- **Created**: ${now.toISOString()}\n` +
    `- **Messages**: ${messages.length}\n` +
    `- **Model**: ${usedRef.provider}/${usedRef.model}\n\n` +
    `---\n\n`;

  fs.writeFileSync(summaryPath, summaryHeader + summary, "utf-8");

  return {
    summary,
    archivedTranscriptPath,
    summaryPath,
    messageCount: messages.length,
    latencyMs: Date.now() - startTime,
  };
}
