/**
 * Bridge between the agent identity system and the comms board.
 *
 * Enriches messages with agent persona data (avatar hints, traits, skills),
 * auto-joins agents to relevant channels, and posts identity-aware
 * system notifications when agents perform significant actions.
 */

import type { AgentIdentity, AgentIdentityStore } from "../tasks/agent-identity.js";
import type { CommsStore } from "./store.js";
import type { Message } from "./types.js";

export type AgentMessageContext = {
  agentId: string;
  identity: AgentIdentity | null;
  displayName: string;
  topTraits: string[];
  topSkills: string[];
  avatarHint: string;
};

/**
 * Build display context for an agent, including identity-derived name,
 * top traits/skills, and an avatar hint character.
 */
export function resolveAgentContext(
  agentId: string,
  identityStore: AgentIdentityStore | null,
): AgentMessageContext {
  if (!identityStore) {
    return {
      agentId,
      identity: null,
      displayName: agentId,
      topTraits: [],
      topSkills: [],
      avatarHint: agentId[0]?.toUpperCase() ?? "?",
    };
  }

  const identity = identityStore.get(agentId);
  if (!identity) {
    return {
      agentId,
      identity: null,
      displayName: agentId,
      topTraits: [],
      topSkills: [],
      avatarHint: agentId[0]?.toUpperCase() ?? "?",
    };
  }

  const topTraits = identity.traits
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3)
    .map((t) => t.key);

  const topSkills = identity.skills
    .sort((a, b) => b.level - a.level)
    .slice(0, 3)
    .map((s) => s.domain);

  const displayName = agentId;

  return {
    agentId,
    identity,
    displayName,
    topTraits,
    topSkills,
    avatarHint: displayName[0]?.toUpperCase() ?? "?",
  };
}

/**
 * Send a message to a channel on behalf of an agent, enriching
 * the metadata with identity information.
 */
export function sendAgentMessage(
  store: CommsStore,
  identityStore: AgentIdentityStore | null,
  opts: {
    channelId: string;
    agentId: string;
    text: string;
    kind?: "text" | "task_ref" | "status" | "system";
    taskRef?: string;
  },
): Message {
  const ctx = resolveAgentContext(opts.agentId, identityStore);

  return store.sendMessage({
    channelId: opts.channelId,
    authorId: opts.agentId,
    authorName: ctx.displayName,
    kind: opts.kind ?? "text",
    text: opts.text,
    taskRef: opts.taskRef,
    metadata: {
      traits: ctx.topTraits,
      skills: ctx.topSkills,
      avatarHint: ctx.avatarHint,
    },
  });
}

/**
 * Ensure an agent is a member of a channel. Idempotent.
 */
export function ensureAgentInChannel(
  store: CommsStore,
  identityStore: AgentIdentityStore | null,
  channelId: string,
  agentId: string,
): void {
  const existing = store.getMember(channelId, agentId);
  if (existing) return;

  const ctx = resolveAgentContext(agentId, identityStore);
  store.addMember(channelId, agentId, ctx.displayName, "member");
}

/**
 * Auto-join an agent to the general channel and optionally a task channel.
 */
export function autoJoinChannels(
  store: CommsStore,
  identityStore: AgentIdentityStore | null,
  agentId: string,
  taskId?: string,
  taskTitle?: string,
): void {
  const general = store.getChannelByName("general");
  if (general) {
    ensureAgentInChannel(store, identityStore, general.id, agentId);
  }

  if (taskId && taskTitle) {
    const taskChannel = store.getOrCreateTaskChannel(taskId, taskTitle);
    ensureAgentInChannel(store, identityStore, taskChannel.id, agentId);
  }
}

/**
 * Post a system notification to the system channel about an agent action.
 */
export function postAgentSystemNotification(
  store: CommsStore,
  identityStore: AgentIdentityStore | null,
  agentId: string,
  action: string,
  detail?: string,
): Message {
  const system = store.getChannelByName("system");
  if (!system) {
    throw new Error("system channel not found");
  }

  const ctx = resolveAgentContext(agentId, identityStore);
  const text = detail
    ? `${ctx.displayName} ${action}: ${detail}`
    : `${ctx.displayName} ${action}`;

  return store.sendMessage({
    channelId: system.id,
    authorId: "system",
    authorName: "System",
    kind: "system",
    text,
    metadata: { agentId, action, traits: ctx.topTraits },
  });
}

/**
 * Post a task status update to the relevant task channel (creating it if needed).
 */
export function postTaskStatusUpdate(
  store: CommsStore,
  identityStore: AgentIdentityStore | null,
  agentId: string,
  taskId: string,
  taskTitle: string,
  oldStatus: string,
  newStatus: string,
): Message {
  const channel = store.getOrCreateTaskChannel(taskId, taskTitle);
  ensureAgentInChannel(store, identityStore, channel.id, agentId);

  const ctx = resolveAgentContext(agentId, identityStore);
  return store.sendMessage({
    channelId: channel.id,
    authorId: agentId,
    authorName: ctx.displayName,
    kind: "status",
    text: `Status changed: ${oldStatus} -> ${newStatus}`,
    taskRef: taskId,
    metadata: {
      oldStatus,
      newStatus,
      traits: ctx.topTraits,
    },
  });
}
