/**
 * Agent comms tool — lets agents send messages, list channels, read
 * conversations, and participate in the communication board.
 *
 * Agents can:
 *   - List available channels
 *   - Read recent messages from a channel
 *   - Send messages to channels
 *   - Create new channels (task-related or general)
 *   - Post system notifications
 *   - View channel members
 */

import { Type } from "@sinclair/typebox";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import {
  autoJoinChannels,
  postAgentSystemNotification,
  postTaskStatusUpdate,
  resolveAgentContext,
  sendAgentMessage,
} from "../../comms/agent-bridge.js";
import { CommsStore } from "../../comms/store.js";
import { AgentIdentityStore } from "../../tasks/agent-identity.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, ToolInputError, jsonResult, readStringParam } from "./common.js";

const COMMS_ACTIONS = [
  "list_channels",
  "read_messages",
  "send_message",
  "create_channel",
  "channel_info",
  "notify",
  "my_channels",
] as const;

const CHANNEL_KINDS = ["general", "task", "direct", "system"] as const;

const CommsToolSchema = Type.Object({
  action: stringEnum(COMMS_ACTIONS, {
    description:
      "Action to perform. " +
      "list_channels: see all available channels. " +
      "read_messages: read recent messages from a channel. " +
      "send_message: post a message to a channel. " +
      "create_channel: create a new channel. " +
      "channel_info: get details about a channel (members, stats). " +
      "notify: post a system notification. " +
      "my_channels: list channels you're a member of.",
  }),
  channelId: Type.Optional(Type.String({ description: "Channel ID (for read_messages, send_message, channel_info)." })),
  channelName: Type.Optional(Type.String({ description: "Channel name (for create_channel, or to find a channel by name)." })),
  kind: Type.Optional(Type.String({ description: "Channel kind: general, task, direct, system (for list_channels filter or create_channel)." })),
  text: Type.Optional(Type.String({ description: "Message text (for send_message, notify)." })),
  taskId: Type.Optional(Type.String({ description: "Task ID (for create_channel with kind=task, or task_ref messages)." })),
  taskTitle: Type.Optional(Type.String({ description: "Task title (for creating task channels)." })),
  description: Type.Optional(Type.String({ description: "Channel description (for create_channel)." })),
  limit: Type.Optional(Type.Number({ description: "Max results (default 20)." })),
});

type CommsToolOptions = {
  agentSessionKey?: string;
  config?: Record<string, unknown>;
};

let _commsStore: CommsStore | null = null;
let _identityStore: AgentIdentityStore | null = null;

function getCommsStore(): CommsStore {
  if (!_commsStore) {
    const stateDir = resolveStateDir(process.env);
    const dbPath = path.join(stateDir, "tasks", "comms.sqlite");
    _commsStore = new CommsStore(dbPath);
  }
  return _commsStore;
}

function getIdentityStore(): AgentIdentityStore {
  if (!_identityStore) {
    const stateDir = resolveStateDir(process.env);
    const dbPath = path.join(stateDir, "tasks", "identities.sqlite");
    _identityStore = new AgentIdentityStore(dbPath);
  }
  return _identityStore;
}

function resolveActorId(opts?: CommsToolOptions): string {
  if (opts?.agentSessionKey) {
    return resolveSessionAgentId({
      sessionKey: opts.agentSessionKey,
      config: opts.config as Record<string, unknown> | undefined,
    });
  }
  return "agent:main";
}

export function createCommsTool(opts?: CommsToolOptions): AnyAgentTool {
  return {
    name: "comms",
    label: "Comms",
    description:
      "Communicate with other agents and operators via the shared communication board. " +
      "Channels are organized by purpose: #general for broad discussion, task channels " +
      "for per-task coordination, direct channels for 1-on-1 conversations, and system " +
      "for notifications. Use this to coordinate work, share updates, ask questions, " +
      "and stay informed about what other agents are doing.",
    parameters: CommsToolSchema,
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      const action = readStringParam(params, "action", { required: true });
      const store = getCommsStore();
      const identities = getIdentityStore();
      const actorId = resolveActorId(opts);

      switch (action) {
        case "list_channels": {
          const kind = readStringParam(params, "kind");
          const channels = store.listChannels({
            kind: kind as "general" | "task" | "direct" | "system" | undefined,
          });

          return jsonResult({
            count: channels.length,
            channels: channels.map((ch) => {
              const stats = store.getChannelStats(ch.id);
              return {
                id: ch.id,
                name: ch.name,
                kind: ch.kind,
                description: ch.description,
                messageCount: stats.messageCount,
                memberCount: stats.memberCount,
                lastActivity: ch.lastMessageAt
                  ? new Date(ch.lastMessageAt).toISOString()
                  : null,
              };
            }),
          });
        }

        case "read_messages": {
          const channelId = resolveChannelId(store, params);
          if (!channelId) throw new ToolInputError("channel not found — provide channelId or channelName");

          autoJoinChannels(store, identities, actorId);

          const limit = typeof params.limit === "number" ? params.limit : 20;
          const messages = store.getRecentMessages(channelId, limit);

          store.markRead(channelId, actorId);

          return jsonResult({
            channelId,
            count: messages.length,
            messages: messages.map((m) => ({
              id: m.id,
              author: m.authorName,
              authorId: m.authorId,
              kind: m.kind,
              text: m.text,
              taskRef: m.taskRef,
              at: new Date(m.createdAt).toISOString(),
              edited: m.editedAt !== null,
            })),
          });
        }

        case "send_message": {
          const channelId = resolveChannelId(store, params);
          if (!channelId) throw new ToolInputError("channel not found — provide channelId or channelName");

          const text = readStringParam(params, "text", { required: true });
          const taskRef = readStringParam(params, "taskId");

          const msg = sendAgentMessage(store, identities, {
            channelId,
            agentId: actorId,
            text,
            kind: taskRef ? "task_ref" : "text",
            taskRef: taskRef ?? undefined,
          });

          identities.incrementStat(actorId, "conversationsHad");

          return jsonResult({
            sent: true,
            message: {
              id: msg.id,
              channelId: msg.channelId,
              text: msg.text,
            },
          });
        }

        case "create_channel": {
          const name = readStringParam(params, "channelName", { required: true });
          const kind = readStringParam(params, "kind") ?? "general";
          const taskId = readStringParam(params, "taskId");
          const taskTitle = readStringParam(params, "taskTitle");

          if (kind === "task" && taskId && taskTitle) {
            const ch = store.getOrCreateTaskChannel(taskId, taskTitle);
            autoJoinChannels(store, identities, actorId, taskId, taskTitle);
            return jsonResult({ created: true, channel: { id: ch.id, name: ch.name, kind: ch.kind } });
          }

          const ch = store.createChannel({
            name,
            kind: kind as "general" | "task" | "direct" | "system",
            description: readStringParam(params, "description") ?? "",
            taskId: taskId ?? undefined,
          });

          store.addMember(ch.id, actorId, resolveAgentContext(actorId, identities).displayName, "owner");

          return jsonResult({
            created: true,
            channel: { id: ch.id, name: ch.name, kind: ch.kind },
          });
        }

        case "channel_info": {
          const channelId = resolveChannelId(store, params);
          if (!channelId) throw new ToolInputError("channel not found — provide channelId or channelName");

          const ch = store.getChannel(channelId);
          if (!ch) throw new ToolInputError(`channel not found: ${channelId}`);

          const members = store.getMembers(channelId);
          const stats = store.getChannelStats(channelId);

          return jsonResult({
            channel: {
              id: ch.id,
              name: ch.name,
              kind: ch.kind,
              description: ch.description,
              taskId: ch.taskId,
              created: new Date(ch.createdAt).toISOString(),
            },
            members: members.map((m) => ({
              id: m.memberId,
              name: m.memberName,
              role: m.role,
            })),
            stats,
          });
        }

        case "notify": {
          const text = readStringParam(params, "text", { required: true });
          const msg = postAgentSystemNotification(store, identities, actorId, text);

          return jsonResult({
            notified: true,
            message: { id: msg.id, text: msg.text },
          });
        }

        case "my_channels": {
          autoJoinChannels(store, identities, actorId);

          const channels = store.getChannelsForMember(actorId);

          return jsonResult({
            agentId: actorId,
            count: channels.length,
            channels: channels.map((ch) => {
              const unread = store.getUnreadCount(ch.id, actorId);
              return {
                id: ch.id,
                name: ch.name,
                kind: ch.kind,
                unread,
                lastActivity: ch.lastMessageAt
                  ? new Date(ch.lastMessageAt).toISOString()
                  : null,
              };
            }),
          });
        }

        default:
          throw new ToolInputError(`unknown action: ${action}`);
      }
    },
  };
}

function resolveChannelId(store: CommsStore, params: Record<string, unknown>): string | null {
  const id = readStringParam(params, "channelId");
  if (id) return id;

  const name = readStringParam(params, "channelName");
  if (name) {
    const ch = store.getChannelByName(name);
    return ch?.id ?? null;
  }

  return null;
}
