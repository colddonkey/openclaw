/**
 * Gateway WebSocket methods for the agent communication board.
 *
 * Methods:
 *   comms.channels.list   — List channels (optionally by kind)
 *   comms.channels.get    — Get channel detail with members and stats
 *   comms.channels.create — Create a new channel
 *   comms.messages.list   — List messages in a channel (with pagination)
 *   comms.messages.send   — Send a message to a channel
 *   comms.messages.edit   — Edit an existing message
 *   comms.members.add     — Add an agent/user to a channel
 *   comms.members.remove  — Remove an agent/user from a channel
 *   comms.mark-read       — Mark a channel as read for a member
 *
 * All methods are gated behind multiAgentOs.enabled.
 */

import { loadConfig } from "../../config/config.js";
import { isMultiAgentOsEnabled } from "../../tasks/feature-gate.js";
import { getSharedCommsStore } from "../../tasks/store-registry.js";
import type { CommsStore } from "../../comms/store.js";
import type { Channel, MessageFilter } from "../../comms/types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function getStore(): CommsStore | null {
  const cfg = loadConfig();
  if (!isMultiAgentOsEnabled(cfg)) return null;
  return getSharedCommsStore();
}

function requireStore(respond: RespondFn): CommsStore | null {
  const store = getStore();
  if (!store) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "multiAgentOs is not enabled"));
    return null;
  }
  return store;
}

export const commsHandlers: GatewayRequestHandlers = {
  "comms.channels.list": async ({ params, respond }) => {
    const store = requireStore(respond);
    if (!store) return;

    const kind = typeof params.kind === "string" ? (params.kind as Channel["kind"]) : undefined;
    const includeArchived = params.includeArchived === true;
    const channels = store.listChannels({ kind, includeArchived });

    const enriched = channels.map((ch) => {
      const stats = store.getChannelStats(ch.id);
      return { ...ch, ...stats };
    });

    respond(true, { channels: enriched });
  },

  "comms.channels.get": async ({ params, respond }) => {
    const store = requireStore(respond);
    if (!store) return;

    const id = typeof params.id === "string" ? params.id : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing params.id"));
      return;
    }

    const channel = store.getChannel(id);
    if (!channel) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `channel not found: ${id}`));
      return;
    }

    const members = store.getMembers(id);
    const stats = store.getChannelStats(id);
    const recentMessages = store.getRecentMessages(id, 20);

    respond(true, { channel, members, stats, recentMessages });
  },

  "comms.channels.create": async ({ params, respond, context }) => {
    const store = requireStore(respond);
    if (!store) return;

    const name = typeof params.name === "string" ? params.name.trim() : "";
    if (!name) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing params.name"));
      return;
    }

    const channel = store.createChannel({
      name,
      kind: typeof params.kind === "string" ? (params.kind as Channel["kind"]) : "general",
      description: typeof params.description === "string" ? params.description : "",
      taskId: typeof params.taskId === "string" ? params.taskId : undefined,
      participants: Array.isArray(params.participants) ? (params.participants as string[]) : undefined,
    });

    context.broadcast("comms.channel.created", { channel });
    respond(true, { channel });
  },

  "comms.messages.list": async ({ params, respond }) => {
    const store = requireStore(respond);
    if (!store) return;

    const channelId = typeof params.channelId === "string" ? params.channelId : "";
    if (!channelId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing params.channelId"));
      return;
    }

    const filter: MessageFilter = { channelId };
    if (typeof params.since === "number") filter.since = params.since;
    if (typeof params.before === "number") filter.before = params.before;
    if (typeof params.search === "string") filter.search = params.search;
    if (typeof params.limit === "number") filter.limit = params.limit;
    if (typeof params.offset === "number") filter.offset = params.offset;

    const messages = store.listMessages(filter);
    respond(true, { messages, count: messages.length });
  },

  "comms.messages.send": async ({ params, respond, context }) => {
    const store = requireStore(respond);
    if (!store) return;

    const channelId = typeof params.channelId === "string" ? params.channelId : "";
    const text = typeof params.text === "string" ? params.text.trim() : "";
    if (!channelId || !text) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing params.channelId or params.text"));
      return;
    }

    const channel = store.getChannel(channelId);
    if (!channel) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `channel not found: ${channelId}`));
      return;
    }

    const message = store.sendMessage({
      channelId,
      authorId: typeof params.authorId === "string" ? params.authorId : "web-user",
      authorName: typeof params.authorName === "string" ? params.authorName : "Operator",
      kind: typeof params.kind === "string" ? (params.kind as "text" | "task_ref" | "status" | "system") : "text",
      text,
      taskRef: typeof params.taskRef === "string" ? params.taskRef : undefined,
      metadata: typeof params.metadata === "object" && params.metadata ? (params.metadata as Record<string, unknown>) : undefined,
    });

    context.broadcast("comms.message", { channelId, message });
    respond(true, { message });
  },

  "comms.messages.edit": async ({ params, respond, context }) => {
    const store = requireStore(respond);
    if (!store) return;

    const id = typeof params.id === "string" ? params.id : "";
    const text = typeof params.text === "string" ? params.text.trim() : "";
    if (!id || !text) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing params.id or params.text"));
      return;
    }

    const message = store.editMessage(id, text);
    if (!message) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `message not found: ${id}`));
      return;
    }

    context.broadcast("comms.message.edited", { channelId: message.channelId, message });
    respond(true, { message });
  },

  "comms.members.add": async ({ params, respond, context }) => {
    const store = requireStore(respond);
    if (!store) return;

    const channelId = typeof params.channelId === "string" ? params.channelId : "";
    const memberId = typeof params.memberId === "string" ? params.memberId : "";
    const memberName = typeof params.memberName === "string" ? params.memberName : memberId;
    const role = typeof params.role === "string" ? (params.role as "owner" | "member" | "observer") : "member";

    if (!channelId || !memberId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing params.channelId or params.memberId"));
      return;
    }

    store.addMember(channelId, memberId, memberName, role);
    context.broadcast("comms.member.added", { channelId, memberId, memberName, role });
    respond(true, { channelId, memberId, memberName, role });
  },

  "comms.members.remove": async ({ params, respond, context }) => {
    const store = requireStore(respond);
    if (!store) return;

    const channelId = typeof params.channelId === "string" ? params.channelId : "";
    const memberId = typeof params.memberId === "string" ? params.memberId : "";

    if (!channelId || !memberId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing params.channelId or params.memberId"));
      return;
    }

    store.removeMember(channelId, memberId);
    context.broadcast("comms.member.removed", { channelId, memberId });
    respond(true, { channelId, memberId });
  },

  "comms.mark-read": async ({ params, respond }) => {
    const store = requireStore(respond);
    if (!store) return;

    const channelId = typeof params.channelId === "string" ? params.channelId : "";
    const memberId = typeof params.memberId === "string" ? params.memberId : "";
    if (!channelId || !memberId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing params.channelId or params.memberId"));
      return;
    }

    store.markRead(channelId, memberId);
    respond(true, {});
  },
};
