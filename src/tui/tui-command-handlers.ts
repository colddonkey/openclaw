import type { Component, TUI } from "@mariozechner/pi-tui";
import { randomUUID } from "node:crypto";
import type { SessionsPatchResult } from "../gateway/protocol/index.js";
import type { ChatLog } from "./components/chat-log.js";
import type { GatewayChatClient } from "./gateway-chat.js";
import type {
  AgentSummary,
  GatewayStatusSummary,
  TuiOptions,
  TuiStateAccess,
} from "./tui-types.js";
import {
  formatThinkingLevels,
  normalizeUsageDisplay,
  resolveResponseUsageMode,
} from "../auto-reply/thinking.js";
import { formatRelativeTimestamp } from "../infra/format-time/format-relative.ts";
import { normalizeAgentId } from "../routing/session-key.js";
import { helpText, parseCommand } from "./commands.js";
import {
  applyThemePreset,
  currentThemeName,
  listThemePresets,
  THEME_PRESETS,
} from "./theme/theme.js";
import { saveTuiPrefs } from "./tui-config.js";
import {
  createFilterableSelectList,
  createSearchableSelectList,
  createSettingsList,
} from "./components/selectors.js";
import { formatStatusSummary } from "./tui-status-summary.js";

type CommandHandlerContext = {
  client: GatewayChatClient;
  chatLog: ChatLog;
  tui: TUI;
  opts: TuiOptions;
  state: TuiStateAccess;
  deliverDefault: boolean;
  openOverlay: (component: Component) => void;
  closeOverlay: () => void;
  refreshSessionInfo: () => Promise<void>;
  loadHistory: (opts?: { expand?: boolean }) => Promise<void>;
  expandHistory: () => void;
  setSession: (key: string) => Promise<void>;
  refreshAgents: () => Promise<void>;
  abortActive: () => Promise<void>;
  setActivityStatus: (text: string) => void;
  formatSessionKey: (key: string) => string;
  applySessionInfoFromPatch: (result: SessionsPatchResult) => void;
  noteLocalRunId: (runId: string) => void;
  forgetLocalRunId?: (runId: string) => void;
  rebuildSplash: () => void;
};

export function createCommandHandlers(context: CommandHandlerContext) {
  const {
    client,
    chatLog,
    tui,
    opts,
    state,
    deliverDefault,
    openOverlay,
    closeOverlay,
    refreshSessionInfo,
    loadHistory,
    expandHistory,
    setSession,
    refreshAgents,
    abortActive,
    setActivityStatus,
    formatSessionKey,
    applySessionInfoFromPatch,
    noteLocalRunId,
    forgetLocalRunId,
    rebuildSplash,
  } = context;

  const setAgent = async (id: string) => {
    state.currentAgentId = normalizeAgentId(id);
    await setSession("");
  };

  const openModelSelector = async () => {
    try {
      const models = await client.listModels();
      if (models.length === 0) {
        chatLog.addSystem("no models available");
        tui.requestRender();
        return;
      }
      const items = models.map((model) => ({
        value: `${model.provider}/${model.id}`,
        label: `${model.provider}/${model.id}`,
        description: model.name && model.name !== model.id ? model.name : "",
      }));
      const selector = createSearchableSelectList(items, 9);
      selector.onSelect = (item) => {
        void (async () => {
          try {
            const result = await client.patchSession({
              key: state.currentSessionKey,
              model: item.value,
            });
            chatLog.addSystem(`model set to ${item.value}`);
            applySessionInfoFromPatch(result);
            await refreshSessionInfo();
          } catch (err) {
            chatLog.addSystem(`model set failed: ${String(err)}`);
          }
          closeOverlay();
          tui.requestRender();
        })();
      };
      selector.onCancel = () => {
        closeOverlay();
        tui.requestRender();
      };
      openOverlay(selector);
      tui.requestRender();
    } catch (err) {
      chatLog.addSystem(`model list failed: ${String(err)}`);
      tui.requestRender();
    }
  };

  const openAgentSelector = async () => {
    await refreshAgents();
    if (state.agents.length === 0) {
      chatLog.addSystem("no agents found");
      tui.requestRender();
      return;
    }
    const items = state.agents.map((agent: AgentSummary) => ({
      value: agent.id,
      label: agent.name ? `${agent.id} (${agent.name})` : agent.id,
      description: agent.id === state.agentDefaultId ? "default" : "",
    }));
    const selector = createSearchableSelectList(items, 9);
    selector.onSelect = (item) => {
      void (async () => {
        closeOverlay();
        await setAgent(item.value);
        tui.requestRender();
      })();
    };
    selector.onCancel = () => {
      closeOverlay();
      tui.requestRender();
    };
    openOverlay(selector);
    tui.requestRender();
  };

  const openSessionSelector = async () => {
    try {
      const result = await client.listSessions({
        includeGlobal: false,
        includeUnknown: false,
        includeDerivedTitles: true,
        includeLastMessage: true,
        agentId: state.currentAgentId,
      });
      const items = result.sessions.map((session) => {
        const title = session.derivedTitle ?? session.displayName;
        const formattedKey = formatSessionKey(session.key);
        // Avoid redundant "title (key)" when title matches key
        const label = title && title !== formattedKey ? `${title} (${formattedKey})` : formattedKey;
        // Build description: time + message preview
        const timePart = session.updatedAt
          ? formatRelativeTimestamp(session.updatedAt, { dateFallback: true, fallback: "" })
          : "";
        const preview = session.lastMessagePreview?.replace(/\s+/g, " ").trim();
        const description =
          timePart && preview ? `${timePart} · ${preview}` : (preview ?? timePart);
        return {
          value: session.key,
          label,
          description,
          searchText: [
            session.displayName,
            session.label,
            session.subject,
            session.sessionId,
            session.key,
            session.lastMessagePreview,
          ]
            .filter(Boolean)
            .join(" "),
        };
      });
      const selector = createFilterableSelectList(items, 9);
      selector.onSelect = (item) => {
        void (async () => {
          closeOverlay();
          await setSession(item.value);
          tui.requestRender();
        })();
      };
      selector.onCancel = () => {
        closeOverlay();
        tui.requestRender();
      };
      openOverlay(selector);
      tui.requestRender();
    } catch (err) {
      chatLog.addSystem(`sessions list failed: ${String(err)}`);
      tui.requestRender();
    }
  };

  const openSettings = () => {
    const items = [
      {
        id: "tools",
        label: "Tool output",
        currentValue: state.toolsExpanded ? "expanded" : "collapsed",
        values: ["collapsed", "expanded"],
      },
      {
        id: "thinking",
        label: "Show thinking",
        currentValue: state.showThinking ? "on" : "off",
        values: ["off", "on"],
      },
      {
        id: "timestamps",
        label: "Timestamps",
        currentValue: state.showTimestamps ? "on" : "off",
        values: ["off", "on"],
      },
      {
        id: "compact",
        label: "Compact mode",
        currentValue: state.compactMode ? "on" : "off",
        values: ["off", "on"],
      },
    ];
    const settings = createSettingsList(
      items,
      (id, value) => {
        if (id === "tools") {
          state.toolsExpanded = value === "expanded";
          chatLog.setToolsExpanded(state.toolsExpanded);
        }
        if (id === "thinking") {
          state.showThinking = value === "on";
          void loadHistory();
        }
        if (id === "timestamps") {
          state.showTimestamps = value === "on";
        }
        if (id === "compact") {
          state.compactMode = value === "on";
          void loadHistory();
        }
        tui.requestRender();
      },
      () => {
        closeOverlay();
        tui.requestRender();
      },
    );
    openOverlay(settings);
    tui.requestRender();
  };

  const handleCommand = async (raw: string) => {
    const { name, args } = parseCommand(raw);
    if (!name) {
      return;
    }
    switch (name) {
      case "help":
        chatLog.addSystem(
          helpText({
            provider: state.sessionInfo.modelProvider,
            model: state.sessionInfo.model,
          }),
        );
        break;
      case "status":
        try {
          const status = await client.getStatus();
          if (typeof status === "string") {
            chatLog.addSystem(status);
            break;
          }
          if (status && typeof status === "object") {
            const lines = formatStatusSummary(status as GatewayStatusSummary);
            for (const line of lines) {
              chatLog.addSystem(line);
            }
            break;
          }
          chatLog.addSystem("status: unknown response");
        } catch (err) {
          chatLog.addSystem(`status failed: ${String(err)}`);
        }
        break;
      case "agent":
        if (!args) {
          await openAgentSelector();
        } else {
          await setAgent(args);
        }
        break;
      case "agents":
        await openAgentSelector();
        break;
      case "session":
        if (!args) {
          await openSessionSelector();
        } else {
          await setSession(args);
        }
        break;
      case "sessions":
        await openSessionSelector();
        break;
      case "model":
        if (!args) {
          await openModelSelector();
        } else {
          try {
            const result = await client.patchSession({
              key: state.currentSessionKey,
              model: args,
            });
            chatLog.addSystem(`model set to ${args}`);
            applySessionInfoFromPatch(result);
            await refreshSessionInfo();
          } catch (err) {
            chatLog.addSystem(`model set failed: ${String(err)}`);
          }
        }
        break;
      case "models":
        await openModelSelector();
        break;
      case "think":
        if (!args) {
          const levels = formatThinkingLevels(
            state.sessionInfo.modelProvider,
            state.sessionInfo.model,
            "|",
          );
          chatLog.addSystem(`usage: /think <${levels}>`);
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            thinkingLevel: args,
          });
          chatLog.addSystem(`thinking set to ${args}`);
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`think failed: ${String(err)}`);
        }
        break;
      case "verbose":
        if (!args) {
          chatLog.addSystem("usage: /verbose <on|off>");
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            verboseLevel: args,
          });
          chatLog.addSystem(`verbose set to ${args}`);
          applySessionInfoFromPatch(result);
          await loadHistory();
        } catch (err) {
          chatLog.addSystem(`verbose failed: ${String(err)}`);
        }
        break;
      case "reasoning":
        if (!args) {
          chatLog.addSystem("usage: /reasoning <on|off>");
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            reasoningLevel: args,
          });
          chatLog.addSystem(`reasoning set to ${args}`);
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`reasoning failed: ${String(err)}`);
        }
        break;
      case "usage": {
        const normalized = args ? normalizeUsageDisplay(args) : undefined;
        if (args && !normalized) {
          chatLog.addSystem("usage: /usage <off|tokens|full>");
          break;
        }
        const currentRaw = state.sessionInfo.responseUsage;
        const current = resolveResponseUsageMode(currentRaw);
        const next =
          normalized ?? (current === "off" ? "tokens" : current === "tokens" ? "full" : "off");
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            responseUsage: next === "off" ? null : next,
          });
          chatLog.addSystem(`usage footer: ${next}`);
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`usage failed: ${String(err)}`);
        }
        break;
      }
      case "elevated":
        if (!args) {
          chatLog.addSystem("usage: /elevated <on|off|ask|full>");
          break;
        }
        if (!["on", "off", "ask", "full"].includes(args)) {
          chatLog.addSystem("usage: /elevated <on|off|ask|full>");
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            elevatedLevel: args,
          });
          chatLog.addSystem(`elevated set to ${args}`);
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`elevated failed: ${String(err)}`);
        }
        break;
      case "activation":
        if (!args) {
          chatLog.addSystem("usage: /activation <mention|always>");
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            groupActivation: args === "always" ? "always" : "mention",
          });
          chatLog.addSystem(`activation set to ${args}`);
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`activation failed: ${String(err)}`);
        }
        break;
      case "new":
      case "reset":
        try {
          // Clear token counts immediately to avoid stale display (#1523)
          state.sessionInfo.inputTokens = null;
          state.sessionInfo.outputTokens = null;
          state.sessionInfo.totalTokens = null;
          tui.requestRender();

          // Try handoff (AI summary + archive) first, fall back to plain reset
          const skipHandoff = args.toLowerCase() === "quick";
          let handoffDone = false;

          if (!skipHandoff) {
            try {
              chatLog.addSystem("summarizing session for handoff...");
              tui.requestRender();
              const result = await client.handoffSession(state.currentSessionKey);
              if (result?.ok && result.handoff) {
                const h = result.handoff;
                chatLog.addSystem(
                  `session handed off (${h.messageCount} messages summarized in ${Math.round(h.latencyMs / 1000)}s)`,
                );
                chatLog.addSystem(`summary saved to: ${h.summaryPath}`);
                if (h.archivedTranscriptPath) {
                  chatLog.addSystem(`transcript archived to: ${h.archivedTranscriptPath}`);
                }
                // Store the summary for automatic injection into the first message
                state.pendingHandoffContext = h.summary;
                chatLog.addSystem(
                  "previous session context will be automatically injected with your next message",
                );
                handoffDone = true;
              }
            } catch {
              // Handoff failed (model error, no API key, etc.) - fall back to plain reset
              chatLog.addSystem("handoff summary skipped (model unavailable), resetting...");
            }
          }

          if (!handoffDone) {
            await client.resetSession(state.currentSessionKey);
            chatLog.addSystem(`session ${state.currentSessionKey} reset`);
          }

          await loadHistory();
        } catch (err) {
          chatLog.addSystem(`reset failed: ${String(err)}`);
        }
        break;
      case "abort":
        await abortActive();
        break;
      case "timestamps": {
        const val = args.toLowerCase();
        if (val === "on" || val === "off") {
          state.showTimestamps = val === "on";
        } else {
          state.showTimestamps = !state.showTimestamps;
        }
        chatLog.addSystem(`timestamps ${state.showTimestamps ? "on" : "off"}`);
        break;
      }
      case "compact": {
        const val = args.toLowerCase();
        if (val === "on" || val === "off") {
          state.compactMode = val === "on";
        } else {
          state.compactMode = !state.compactMode;
        }
        chatLog.addSystem(`compact mode ${state.compactMode ? "on" : "off"}`);
        // Reload history to re-render messages with/without extra spacing.
        void loadHistory();
        break;
      }
      case "banner": {
        const DEFAULT_BANNER = "ANT";
        if (!args || args.toLowerCase() === "reset") {
          state.bannerText = DEFAULT_BANNER;
          chatLog.addSystem("banner reset to ANT");
        } else {
          // Each word becomes a separate figlet line (max 3 words).
          const words = args.split(/\s+/).filter(Boolean).slice(0, 3);
          state.bannerText = words.join("\n");
          chatLog.addSystem(`banner set to: ${words.join(" ")}`);
        }
        rebuildSplash();
        break;
      }
      case "context": {
        const sub = args.toLowerCase().trim();
        try {
          const { listHandoffSummaries, readHandoffSummary, readLatestHandoffSummary } =
            await import("../gateway/session-handoff.js");

          if (sub === "list" || sub === "ls") {
            const summaries = listHandoffSummaries();
            if (summaries.length === 0) {
              chatLog.addSystem("no session handoff summaries found");
            } else {
              const lines = summaries.slice(0, 10).map((s, i) => {
                const date = s.createdAt.toLocaleDateString();
                const time = s.createdAt.toLocaleTimeString();
                const size = Math.round(s.sizeBytes / 1024);
                return `  ${i + 1}. ${s.sessionId.slice(0, 8)}... (${date} ${time}, ${size}K)`;
              });
              chatLog.addSystem(
                `Session handoff summaries (${summaries.length} total):\n${lines.join("\n")}\n\nUse /context latest to load most recent`,
              );
            }
          } else if (sub === "latest" || sub === "last" || !sub) {
            const latest = readLatestHandoffSummary();
            if (!latest) {
              chatLog.addSystem(
                "no handoff summaries available. Run /new to create one when resetting a session.",
              );
            } else {
              // Send the summary to the agent as a user message for context injection
              chatLog.addSystem(`loading context from session ${latest.sessionId.slice(0, 8)}...`);
              tui.requestRender();
              await sendMessage(
                `[Previous Session Context]\nHere is a summary of our previous session. Use this to understand what we were working on and pick up where we left off:\n\n${latest.summary}`,
              );
            }
          } else {
            // Try to load a specific session by partial ID
            const summaries = listHandoffSummaries();
            const match = summaries.find((s) => s.sessionId.startsWith(sub));
            if (match) {
              const summary = readHandoffSummary(match.sessionId);
              if (summary) {
                chatLog.addSystem(`loading context from session ${match.sessionId.slice(0, 8)}...`);
                tui.requestRender();
                await sendMessage(
                  `[Previous Session Context]\nHere is a summary of a previous session. Use this to understand what was discussed:\n\n${summary}`,
                );
              } else {
                chatLog.addSystem(`could not read summary for ${sub}`);
              }
            } else {
              chatLog.addSystem(
                `no matching session found for "${sub}". Use /context list to see available summaries.`,
              );
            }
          }
        } catch (err) {
          chatLog.addSystem(`context command failed: ${String(err)}`);
        }
        break;
      }
      case "history":
        expandHistory();
        break;
      case "theme": {
        if (!args) {
          // No argument – list available themes.
          const presets = listThemePresets();
          const lines = presets.map((name) => {
            const p = THEME_PRESETS[name];
            const marker = name === currentThemeName() ? " (active)" : "";
            return `  ${name}${marker} – ${p?.label ?? name}`;
          });
          chatLog.addSystem(`Available themes:\n${lines.join("\n")}\n\nUsage: /theme <name>`);
        } else {
          const requested = args.toLowerCase();
          if (applyThemePreset(requested)) {
            chatLog.addSystem(`Theme switched to "${requested}".`);
            saveTuiPrefs({ theme: requested });
            // Force full repaint with the new colors.
            void loadHistory();
          } else {
            chatLog.addSystem(
              `Unknown theme "${args}". Available: ${listThemePresets().join(", ")}`,
            );
          }
        }
        break;
      }
      case "settings":
        openSettings();
        break;
      case "exit":
      case "quit":
        client.stop();
        tui.stop();
        process.exit(0);
        break;
      default:
        await sendMessage(raw);
        break;
    }
    tui.requestRender();
  };

  const sendMessage = async (text: string) => {
    try {
      chatLog.addUser(text);
      tui.requestRender();

      // Inject pending handoff context into the first message after a session reset
      let messageToSend = text;
      if (state.pendingHandoffContext) {
        messageToSend =
          `[Previous Session Context]\n` +
          `The following is a summary of our previous conversation session. Use it to understand what we were working on and seamlessly continue:\n\n` +
          `${state.pendingHandoffContext}\n\n` +
          `---\n\n` +
          `[Current Message]\n${text}`;
        state.pendingHandoffContext = null;
      }

      const runId = randomUUID();
      noteLocalRunId(runId);
      state.activeChatRunId = runId;
      setActivityStatus("sending");
      await client.sendChat({
        sessionKey: state.currentSessionKey,
        message: messageToSend,
        thinking: opts.thinking,
        deliver: deliverDefault,
        timeoutMs: opts.timeoutMs,
        runId,
      });
      setActivityStatus("waiting");
    } catch (err) {
      if (state.activeChatRunId) {
        forgetLocalRunId?.(state.activeChatRunId);
      }
      state.activeChatRunId = null;
      chatLog.addSystem(`send failed: ${String(err)}`);
      setActivityStatus("error");
    }
    tui.requestRender();
  };

  return {
    handleCommand,
    sendMessage,
    openModelSelector,
    openAgentSelector,
    openSessionSelector,
    openSettings,
    setAgent,
  };
}
