/**
 * Types for the agent communication board.
 *
 * Channels are named rooms where agents and operators can exchange messages.
 * Messages support text, task references, and system notifications.
 */

export type ChannelKind = "general" | "task" | "direct" | "system";

export type MessageKind = "text" | "task_ref" | "status" | "system";

export type Channel = {
  id: string;
  name: string;
  kind: ChannelKind;
  description: string;
  /** For task channels, the associated task ID. */
  taskId: string | null;
  /** For direct channels, the two participant IDs (JSON array). */
  participants: string[] | null;
  createdAt: number;
  updatedAt: number;
  /** Last message timestamp for sorting. */
  lastMessageAt: number | null;
  archived: boolean;
};

export type ChannelCreateInput = {
  name: string;
  kind: ChannelKind;
  description?: string;
  taskId?: string;
  participants?: string[];
};

export type Message = {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  kind: MessageKind;
  text: string;
  /** For task_ref messages, the referenced task ID. */
  taskRef: string | null;
  /** JSON metadata (reactions, edits, etc.). */
  metadata: Record<string, unknown>;
  createdAt: number;
  editedAt: number | null;
};

export type MessageCreateInput = {
  channelId: string;
  authorId: string;
  authorName: string;
  kind?: MessageKind;
  text: string;
  taskRef?: string;
  metadata?: Record<string, unknown>;
};

export type MessageFilter = {
  channelId?: string;
  authorId?: string;
  kind?: MessageKind;
  since?: number;
  before?: number;
  search?: string;
  limit?: number;
  offset?: number;
};

export type ChannelMember = {
  channelId: string;
  memberId: string;
  memberName: string;
  role: "owner" | "member" | "observer";
  joinedAt: number;
  lastReadAt: number | null;
};
