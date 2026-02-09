import type { TUI } from "@mariozechner/pi-tui";
import type { SessionsPatchResult } from "../gateway/protocol/index.js";
import type { ChatLog } from "./components/chat-log.js";
import type { GatewayAgentsList, GatewayChatClient } from "./gateway-chat.js";
import type { TuiOptions, TuiStateAccess } from "./tui-types.js";
import {
  normalizeAgentId,
  normalizeMainKey,
  parseAgentSessionKey,
} from "../routing/session-key.js";
import { asString, extractTextFromMessage, isCommandMessage } from "./tui-formatters.js";

type SessionActionContext = {
  client: GatewayChatClient;
  chatLog: ChatLog;
  tui: TUI;
  opts: TuiOptions;
  state: TuiStateAccess;
  agentNames: Map<string, string>;
  initialSessionInput: string;
  initialSessionAgentId: string | null;
  resolveSessionKey: (raw?: string) => string;
  updateHeader: () => void;
  updateFooter: () => void;
  updateAutocompleteProvider: () => void;
  setActivityStatus: (text: string) => void;
  clearLocalRunIds?: () => void;
  /** Called after chatLog is cleared so the caller can re-add the splash. */
  onHistoryCleared?: () => void;
};

type SessionInfoDefaults = {
  model?: string | null;
  modelProvider?: string | null;
  contextTokens?: number | null;
};

type SessionInfoEntry = {
  thinkingLevel?: string;
  verboseLevel?: string;
  reasoningLevel?: string;
  model?: string;
  modelProvider?: string;
  modelOverride?: string;
  providerOverride?: string;
  contextTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  responseUsage?: "on" | "off" | "tokens" | "full";
  updatedAt?: number | null;
  displayName?: string;
};

export function createSessionActions(context: SessionActionContext) {
  const {
    client,
    chatLog,
    tui,
    opts,
    state,
    agentNames,
    initialSessionInput,
    initialSessionAgentId,
    resolveSessionKey,
    updateHeader,
    updateFooter,
    updateAutocompleteProvider,
    setActivityStatus,
    clearLocalRunIds,
    onHistoryCleared,
  } = context;
  let refreshSessionInfoPromise: Promise<void> = Promise.resolve();
  let lastSessionDefaults: SessionInfoDefaults | null = null;

  const applyAgentsResult = (result: GatewayAgentsList) => {
    state.agentDefaultId = normalizeAgentId(result.defaultId);
    state.sessionMainKey = normalizeMainKey(result.mainKey);
    state.sessionScope = result.scope ?? state.sessionScope;
    state.agents = result.agents.map((agent) => ({
      id: normalizeAgentId(agent.id),
      name: agent.name?.trim() || undefined,
    }));
    agentNames.clear();
    for (const agent of state.agents) {
      if (agent.name) {
        agentNames.set(agent.id, agent.name);
      }
    }
    if (!state.initialSessionApplied) {
      if (initialSessionAgentId) {
        if (state.agents.some((agent) => agent.id === initialSessionAgentId)) {
          state.currentAgentId = initialSessionAgentId;
        }
      } else if (!state.agents.some((agent) => agent.id === state.currentAgentId)) {
        state.currentAgentId =
          state.agents[0]?.id ?? normalizeAgentId(result.defaultId ?? state.currentAgentId);
      }
      const nextSessionKey = resolveSessionKey(initialSessionInput);
      if (nextSessionKey !== state.currentSessionKey) {
        state.currentSessionKey = nextSessionKey;
      }
      state.initialSessionApplied = true;
    } else if (!state.agents.some((agent) => agent.id === state.currentAgentId)) {
      state.currentAgentId =
        state.agents[0]?.id ?? normalizeAgentId(result.defaultId ?? state.currentAgentId);
    }
    updateHeader();
    updateFooter();
  };

  const refreshAgents = async () => {
    try {
      const result = await client.listAgents();
      applyAgentsResult(result);
    } catch (err) {
      chatLog.addSystem(`agents list failed: ${String(err)}`);
    }
  };

  const updateAgentFromSessionKey = (key: string) => {
    const parsed = parseAgentSessionKey(key);
    if (!parsed) {
      return;
    }
    const next = normalizeAgentId(parsed.agentId);
    if (next !== state.currentAgentId) {
      state.currentAgentId = next;
    }
  };

  const resolveModelSelection = (entry?: SessionInfoEntry) => {
    if (entry?.modelProvider || entry?.model) {
      return {
        modelProvider: entry.modelProvider ?? state.sessionInfo.modelProvider,
        model: entry.model ?? state.sessionInfo.model,
      };
    }
    const overrideModel = entry?.modelOverride?.trim();
    if (overrideModel) {
      const overrideProvider = entry?.providerOverride?.trim() || state.sessionInfo.modelProvider;
      return { modelProvider: overrideProvider, model: overrideModel };
    }
    return {
      modelProvider: state.sessionInfo.modelProvider,
      model: state.sessionInfo.model,
    };
  };

  const applySessionInfo = (params: {
    entry?: SessionInfoEntry | null;
    defaults?: SessionInfoDefaults | null;
    force?: boolean;
  }) => {
    const entry = params.entry ?? undefined;
    const defaults = params.defaults ?? lastSessionDefaults ?? undefined;
    const previousDefaults = lastSessionDefaults;
    const defaultsChanged = params.defaults
      ? previousDefaults?.model !== params.defaults.model ||
        previousDefaults?.modelProvider !== params.defaults.modelProvider ||
        previousDefaults?.contextTokens !== params.defaults.contextTokens
      : false;
    if (params.defaults) {
      lastSessionDefaults = params.defaults;
    }

    const entryUpdatedAt = entry?.updatedAt ?? null;
    const currentUpdatedAt = state.sessionInfo.updatedAt ?? null;
    const modelChanged =
      (entry?.modelProvider !== undefined &&
        entry.modelProvider !== state.sessionInfo.modelProvider) ||
      (entry?.model !== undefined && entry.model !== state.sessionInfo.model);
    if (
      !params.force &&
      entryUpdatedAt !== null &&
      currentUpdatedAt !== null &&
      entryUpdatedAt < currentUpdatedAt &&
      !defaultsChanged &&
      !modelChanged
    ) {
      return;
    }

    const next = { ...state.sessionInfo };
    if (entry?.thinkingLevel !== undefined) {
      next.thinkingLevel = entry.thinkingLevel;
    }
    if (entry?.verboseLevel !== undefined) {
      next.verboseLevel = entry.verboseLevel;
    }
    if (entry?.reasoningLevel !== undefined) {
      next.reasoningLevel = entry.reasoningLevel;
    }
    if (entry?.responseUsage !== undefined) {
      next.responseUsage = entry.responseUsage;
    }
    if (entry?.inputTokens !== undefined) {
      next.inputTokens = entry.inputTokens;
    }
    if (entry?.outputTokens !== undefined) {
      next.outputTokens = entry.outputTokens;
    }
    if (entry?.totalTokens !== undefined) {
      next.totalTokens = entry.totalTokens;
    }
    if (entry?.contextTokens !== undefined || defaults?.contextTokens !== undefined) {
      next.contextTokens =
        entry?.contextTokens ?? defaults?.contextTokens ?? state.sessionInfo.contextTokens;
    }
    if (entry?.displayName !== undefined) {
      next.displayName = entry.displayName;
    }
    if (entry?.updatedAt !== undefined) {
      next.updatedAt = entry.updatedAt;
    }

    const selection = resolveModelSelection(entry);
    if (selection.modelProvider !== undefined) {
      next.modelProvider = selection.modelProvider;
    }
    if (selection.model !== undefined) {
      next.model = selection.model;
    }

    state.sessionInfo = next;
    updateAutocompleteProvider();
    updateFooter();
    tui.requestRender();
  };

  const runRefreshSessionInfo = async () => {
    try {
      const resolveListAgentId = () => {
        if (state.currentSessionKey === "global" || state.currentSessionKey === "unknown") {
          return undefined;
        }
        const parsed = parseAgentSessionKey(state.currentSessionKey);
        return parsed?.agentId ? normalizeAgentId(parsed.agentId) : state.currentAgentId;
      };
      const listAgentId = resolveListAgentId();
      const result = await client.listSessions({
        includeGlobal: false,
        includeUnknown: false,
        agentId: listAgentId,
      });
      const normalizeMatchKey = (key: string) => parseAgentSessionKey(key)?.rest ?? key;
      const currentMatchKey = normalizeMatchKey(state.currentSessionKey);
      const entry = result.sessions.find((row) => {
        // Exact match
        if (row.key === state.currentSessionKey) {
          return true;
        }
        // Also match canonical keys like "agent:default:main" against "main"
        return normalizeMatchKey(row.key) === currentMatchKey;
      });
      if (entry?.key && entry.key !== state.currentSessionKey) {
        updateAgentFromSessionKey(entry.key);
        state.currentSessionKey = entry.key;
        updateHeader();
      }
      applySessionInfo({
        entry,
        defaults: result.defaults,
      });
    } catch (err) {
      chatLog.addSystem(`sessions list failed: ${String(err)}`);
    }
  };

  const refreshSessionInfo = async () => {
    refreshSessionInfoPromise = refreshSessionInfoPromise.then(
      runRefreshSessionInfo,
      runRefreshSessionInfo,
    );
    await refreshSessionInfoPromise;
  };

  const applySessionInfoFromPatch = (result?: SessionsPatchResult | null) => {
    if (!result?.entry) {
      return;
    }
    if (result.key && result.key !== state.currentSessionKey) {
      updateAgentFromSessionKey(result.key);
      state.currentSessionKey = result.key;
      updateHeader();
    }
    const resolved = result.resolved;
    const entry =
      resolved && (resolved.modelProvider || resolved.model)
        ? {
            ...result.entry,
            modelProvider: resolved.modelProvider ?? result.entry.modelProvider,
            model: resolved.model ?? result.entry.model,
          }
        : result.entry;
    applySessionInfo({ entry, force: true });
  };

  // Track whether we've done the very first history load (used for collapse).
  let firstHistoryLoad = true;
  // Cache the last loaded history so /history can expand it.
  let cachedHistoryRecord: {
    messages?: unknown[];
    sessionId?: string;
    thinkingLevel?: string;
    verboseLevel?: string;
  } | null = null;

  /** Render all messages from a history record into the chat log. */
  const renderHistoryMessages = (
    record: { messages?: unknown[] },
    showTools: boolean,
  ) => {
    for (const entry of record.messages ?? []) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const message = entry as Record<string, unknown>;
      if (isCommandMessage(message)) {
        const text = extractTextFromMessage(message);
        if (text) {
          chatLog.addSystem(text);
        }
        continue;
      }
      if (message.role === "user") {
        const text = extractTextFromMessage(message);
        if (text) {
          chatLog.addUser(text);
        }
        continue;
      }
      if (message.role === "assistant") {
        const text = extractTextFromMessage(message, {
          includeThinking: state.showThinking,
        });
        if (text) {
          chatLog.finalizeAssistant(text);
        }
        continue;
      }
      if (message.role === "toolResult") {
        if (!showTools) {
          continue;
        }
        const toolCallId = asString(message.toolCallId, "");
        const toolName = asString(message.toolName, "tool");
        const component = chatLog.startTool(toolCallId, toolName, {});
        component.setResult(
          {
            content: Array.isArray(message.content)
              ? (message.content as Record<string, unknown>[])
              : [],
            details:
              typeof message.details === "object" && message.details
                ? (message.details as Record<string, unknown>)
                : undefined,
          },
          { isError: Boolean(message.isError) },
        );
      }
    }
  };

  const loadHistory = async (opts_?: { expand?: boolean }) => {
    try {
      const history = await client.loadHistory({
        sessionKey: state.currentSessionKey,
        limit: opts.historyLimit ?? 200,
      });
      const record = history as {
        messages?: unknown[];
        sessionId?: string;
        thinkingLevel?: string;
        verboseLevel?: string;
      };
      cachedHistoryRecord = record;
      state.currentSessionId = typeof record.sessionId === "string" ? record.sessionId : null;
      state.sessionInfo.thinkingLevel = record.thinkingLevel ?? state.sessionInfo.thinkingLevel;
      state.sessionInfo.verboseLevel = record.verboseLevel ?? state.sessionInfo.verboseLevel;
      const showTools = (state.sessionInfo.verboseLevel ?? "off") !== "off";
      chatLog.clearAll();
      onHistoryCleared?.();

      const msgCount = (record.messages ?? []).length;
      const shouldCollapse = firstHistoryLoad && msgCount > 0 && !opts_?.expand;

      if (shouldCollapse) {
        // Show a compact summary instead of the full history.
        const userCount = (record.messages ?? []).filter(
          (m) => m && typeof m === "object" && (m as Record<string, unknown>).role === "user",
        ).length;
        const assistantCount = (record.messages ?? []).filter(
          (m) => m && typeof m === "object" && (m as Record<string, unknown>).role === "assistant",
        ).length;
        const parts = [`${msgCount} messages`];
        if (userCount > 0) parts.push(`${userCount} from you`);
        if (assistantCount > 0) parts.push(`${assistantCount} from assistant`);
        chatLog.addSystem(
          `Previous session (${parts.join(", ")}). Type /history to expand.`,
        );
      } else {
        chatLog.addSystem(`session ${state.currentSessionKey}`);
        renderHistoryMessages(record, showTools);
      }

      firstHistoryLoad = false;
      state.historyLoaded = true;
    } catch (err) {
      chatLog.addSystem(`history failed: ${String(err)}`);
    }
    await refreshSessionInfo();
    tui.requestRender();
  };

  /** Expand the cached history (called by /history command). */
  const expandHistory = () => {
    if (!cachedHistoryRecord) {
      chatLog.addSystem("No history to expand.");
      tui.requestRender();
      return;
    }
    const showTools = (state.sessionInfo.verboseLevel ?? "off") !== "off";
    chatLog.clearAll();
    onHistoryCleared?.();
    chatLog.addSystem(`session ${state.currentSessionKey}`);
    renderHistoryMessages(cachedHistoryRecord, showTools);
    tui.requestRender();
  };

  const setSession = async (rawKey: string) => {
    const nextKey = resolveSessionKey(rawKey);
    updateAgentFromSessionKey(nextKey);
    state.currentSessionKey = nextKey;
    state.activeChatRunId = null;
    state.currentSessionId = null;
    state.historyLoaded = false;
    clearLocalRunIds?.();
    updateHeader();
    updateFooter();
    await loadHistory();
  };

  const abortActive = async () => {
    if (!state.activeChatRunId) {
      chatLog.addSystem("no active run");
      tui.requestRender();
      return;
    }
    try {
      await client.abortChat({
        sessionKey: state.currentSessionKey,
        runId: state.activeChatRunId,
      });
      setActivityStatus("aborted");
    } catch (err) {
      chatLog.addSystem(`abort failed: ${String(err)}`);
      setActivityStatus("abort failed");
    }
    tui.requestRender();
  };

  return {
    applyAgentsResult,
    refreshAgents,
    refreshSessionInfo,
    applySessionInfoFromPatch,
    loadHistory,
    expandHistory,
    setSession,
    abortActive,
  };
}
