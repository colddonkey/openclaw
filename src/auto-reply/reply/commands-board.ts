/**
 * /board and /tasks command handlers for the Telegram kanban board.
 *
 * Gated behind multiAgentOs.enabled and multiAgentOs.telegram.enabled.
 */

import { loadConfig } from "../../config/config.js";
import { isMultiAgentOsEnabled } from "../../tasks/feature-gate.js";
import { isMultiAgentOsFeatureEnabled } from "../../tasks/feature-gate.js";
import {
  renderBoardMessage,
  renderMyTasks,
  renderTaskList,
} from "../../telegram/tasks-board.js";
import type { TaskStatus } from "../../tasks/types.js";
import type { CommandHandler, CommandHandlerResult } from "./commands-types.js";

function resolveKanbanUrl(): string | undefined {
  // Try to get Tailscale hostname via CLI for a stable HTTPS URL
  try {
    const { execSync } = require("node:child_process");
    const result = execSync("tailscale status --json", { timeout: 3000, encoding: "utf8" });
    const status = JSON.parse(result);
    const dnsName = status?.Self?.DNSName as string | undefined;
    if (dnsName) {
      // DNSName includes trailing dot, strip it
      const hostname = dnsName.replace(/\.$/, "");
      return `https://${hostname}/kanban`;
    }
  } catch {
    // Tailscale not available, fall through
  }
  const cfg = loadConfig();
  const port = cfg.gateway?.port ?? 18789;
  return `http://localhost:${port}/kanban`;
}

const VALID_STATUSES = new Set<string>([
  "triage",
  "backlog",
  "ready",
  "in_progress",
  "blocked",
  "review",
  "done",
  "archived",
]);

export const handleBoardCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) return null;
  if (params.command.commandBodyNormalized !== "/board") return null;
  if (!isMultiAgentOsEnabled(params.cfg)) return null;
  if (!isMultiAgentOsFeatureEnabled(params.cfg, "telegram")) return null;

  const isTelegram = params.command.surface === "telegram";
  if (!isTelegram) {
    return {
      shouldContinue: false,
      reply: { text: "The kanban board is currently only available on Telegram." },
    };
  }

  try {
    const { text, buttons } = renderBoardMessage();
    const miniAppUrl = resolveKanbanUrl();
    const miniAppButtons = miniAppUrl
      ? [[{ text: "Open Task Board", web_app: { url: miniAppUrl } }], ...buttons]
      : buttons;
    return {
      shouldContinue: false,
      reply: {
        text,
        channelData: {
          telegram: { buttons: miniAppButtons, parseMode: "HTML" },
        },
      },
    };
  } catch (err) {
    return {
      shouldContinue: false,
      reply: { text: `Failed to render board: ${err instanceof Error ? err.message : String(err)}` },
    };
  }
};

export const handleTasksCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) return null;

  const body = params.command.commandBodyNormalized;
  if (!body.startsWith("/tasks")) return null;
  if (!isMultiAgentOsEnabled(params.cfg)) return null;
  if (!isMultiAgentOsFeatureEnabled(params.cfg, "telegram")) return null;

  const isTelegram = params.command.surface === "telegram";

  const arg = body.replace(/^\/tasks\s*/, "").trim().toLowerCase();

  // /tasks my — show tasks assigned to current agent/user
  if (arg === "my" || arg === "mine") {
    const agentId = params.agentId ?? "unknown";
    try {
      const { text, buttons } = renderMyTasks(agentId);
      const result: CommandHandlerResult = {
        shouldContinue: false,
        reply: isTelegram
          ? { text, channelData: { telegram: { buttons, parseMode: "HTML" } } }
          : { text: text.replace(/<[^>]+>/g, "") },
      };
      return result;
    } catch (err) {
      return {
        shouldContinue: false,
        reply: { text: `Failed to load tasks: ${err instanceof Error ? err.message : String(err)}` },
      };
    }
  }

  // /tasks <status> — filter by status
  if (arg && VALID_STATUSES.has(arg)) {
    try {
      const { text, buttons } = renderTaskList(arg as TaskStatus);
      const result: CommandHandlerResult = {
        shouldContinue: false,
        reply: isTelegram
          ? { text, channelData: { telegram: { buttons, parseMode: "HTML" } } }
          : { text: text.replace(/<[^>]+>/g, "") },
      };
      return result;
    } catch (err) {
      return {
        shouldContinue: false,
        reply: { text: `Failed to load tasks: ${err instanceof Error ? err.message : String(err)}` },
      };
    }
  }

  // /tasks (no arg) — show the full board
  if (!arg) {
    try {
      const { text, buttons } = renderBoardMessage();
      const result: CommandHandlerResult = {
        shouldContinue: false,
        reply: isTelegram
          ? { text, channelData: { telegram: { buttons, parseMode: "HTML" } } }
          : { text: text.replace(/<[^>]+>/g, "") },
      };
      return result;
    } catch (err) {
      return {
        shouldContinue: false,
        reply: { text: `Failed to render board: ${err instanceof Error ? err.message : String(err)}` },
      };
    }
  }

  // Unknown arg — show help
  const statuses = [...VALID_STATUSES].join(", ");
  return {
    shouldContinue: false,
    reply: {
      text: `Unknown status "${arg}". Valid statuses: ${statuses}\n\nUsage: /tasks [status|my]`,
    },
  };
};
