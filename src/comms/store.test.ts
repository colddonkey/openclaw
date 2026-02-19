import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CommsStore } from "./store.js";

let store: CommsStore;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "comms-test-"));
  store = new CommsStore(path.join(tmpDir, "comms.sqlite"));
});

afterEach(() => {
  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("CommsStore", () => {
  describe("default channels", () => {
    it("creates general and system channels on init", () => {
      const channels = store.listChannels();
      const names = channels.map((c) => c.name);
      expect(names).toContain("general");
      expect(names).toContain("system");
    });

    it("general channel has correct kind", () => {
      const general = store.getChannelByName("general");
      expect(general).not.toBeNull();
      expect(general!.kind).toBe("general");
    });

    it("system channel has correct kind", () => {
      const system = store.getChannelByName("system");
      expect(system).not.toBeNull();
      expect(system!.kind).toBe("system");
    });
  });

  describe("channels", () => {
    it("creates a custom channel", () => {
      const ch = store.createChannel({
        name: "dev-chat",
        kind: "general",
        description: "Developer discussion",
      });
      expect(ch.name).toBe("dev-chat");
      expect(ch.kind).toBe("general");
      expect(ch.description).toBe("Developer discussion");
      expect(ch.archived).toBe(false);
    });

    it("creates a task channel", () => {
      const ch = store.getOrCreateTaskChannel("task_abc123", "Fix the bug");
      expect(ch.kind).toBe("task");
      expect(ch.taskId).toBe("task_abc123");
      expect(ch.description).toContain("Fix the bug");
    });

    it("returns existing task channel on re-create", () => {
      const ch1 = store.getOrCreateTaskChannel("task_abc", "A task");
      const ch2 = store.getOrCreateTaskChannel("task_abc", "A task");
      expect(ch1.id).toBe(ch2.id);
    });

    it("creates direct channels between two participants", () => {
      const ch = store.getOrCreateDirectChannel("agent-1", "agent-2", "Alpha", "Beta");
      expect(ch.kind).toBe("direct");
      expect(ch.participants).toEqual(["agent-1", "agent-2"]);
    });

    it("returns existing direct channel on re-create", () => {
      const ch1 = store.getOrCreateDirectChannel("a", "b", "A", "B");
      const ch2 = store.getOrCreateDirectChannel("b", "a", "B", "A");
      expect(ch1.id).toBe(ch2.id);
    });

    it("archives a channel", () => {
      const ch = store.createChannel({ name: "temp", kind: "general" });
      store.archiveChannel(ch.id);
      const active = store.listChannels();
      expect(active.find((c) => c.id === ch.id)).toBeUndefined();

      const all = store.listChannels({ includeArchived: true });
      const archived = all.find((c) => c.id === ch.id);
      expect(archived).toBeDefined();
      expect(archived!.archived).toBe(true);
    });

    it("lists channels by kind", () => {
      store.createChannel({ name: "task-ch", kind: "task", taskId: "t1" });
      const taskChannels = store.listChannels({ kind: "task" });
      expect(taskChannels.every((c) => c.kind === "task")).toBe(true);
    });
  });

  describe("messages", () => {
    let channelId: string;

    beforeEach(() => {
      const general = store.getChannelByName("general");
      channelId = general!.id;
    });

    it("sends and retrieves a message", () => {
      const msg = store.sendMessage({
        channelId,
        authorId: "agent-1",
        authorName: "Alpha",
        text: "Hello world",
      });
      expect(msg.text).toBe("Hello world");
      expect(msg.authorName).toBe("Alpha");
      expect(msg.kind).toBe("text");

      const fetched = store.getMessage(msg.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.text).toBe("Hello world");
    });

    it("updates channel lastMessageAt on send", () => {
      const before = store.getChannel(channelId);
      store.sendMessage({
        channelId,
        authorId: "agent-1",
        authorName: "Alpha",
        text: "ping",
      });
      const after = store.getChannel(channelId);
      expect(after!.lastMessageAt).toBeGreaterThanOrEqual(before!.createdAt);
    });

    it("edits a message", () => {
      const msg = store.sendMessage({
        channelId,
        authorId: "agent-1",
        authorName: "Alpha",
        text: "typo",
      });
      const edited = store.editMessage(msg.id, "fixed");
      expect(edited!.text).toBe("fixed");
      expect(edited!.editedAt).not.toBeNull();
    });

    it("lists messages with filter", () => {
      store.sendMessage({ channelId, authorId: "a", authorName: "A", text: "msg 1" });
      store.sendMessage({ channelId, authorId: "b", authorName: "B", text: "msg 2" });
      store.sendMessage({ channelId, authorId: "a", authorName: "A", text: "msg 3" });

      const fromA = store.listMessages({ channelId, authorId: "a" });
      expect(fromA).toHaveLength(2);
    });

    it("supports search filter", () => {
      store.sendMessage({ channelId, authorId: "a", authorName: "A", text: "deploy the app" });
      store.sendMessage({ channelId, authorId: "b", authorName: "B", text: "review the PR" });

      const results = store.listMessages({ channelId, search: "deploy" });
      expect(results).toHaveLength(1);
      expect(results[0].text).toContain("deploy");
    });

    it("gets recent messages in chronological order", () => {
      store.sendMessage({ channelId, authorId: "a", authorName: "A", text: "first" });
      store.sendMessage({ channelId, authorId: "b", authorName: "B", text: "second" });
      store.sendMessage({ channelId, authorId: "a", authorName: "A", text: "third" });

      const recent = store.getRecentMessages(channelId, 2);
      expect(recent).toHaveLength(2);
      expect(recent[0].text).toBe("second");
      expect(recent[1].text).toBe("third");
    });

    it("sends task_ref message", () => {
      const msg = store.sendMessage({
        channelId,
        authorId: "agent-1",
        authorName: "Alpha",
        kind: "task_ref",
        text: "Working on this task",
        taskRef: "task_abc123",
      });
      expect(msg.kind).toBe("task_ref");
      expect(msg.taskRef).toBe("task_abc123");
    });
  });

  describe("members", () => {
    let channelId: string;

    beforeEach(() => {
      const ch = store.createChannel({ name: "team", kind: "general" });
      channelId = ch.id;
    });

    it("adds and lists members", () => {
      store.addMember(channelId, "agent-1", "Alpha", "owner");
      store.addMember(channelId, "agent-2", "Beta", "member");

      const members = store.getMembers(channelId);
      expect(members).toHaveLength(2);
      expect(members[0].role).toBe("owner");
      expect(members[1].role).toBe("member");
    });

    it("removes a member", () => {
      store.addMember(channelId, "agent-1", "Alpha");
      store.removeMember(channelId, "agent-1");
      const members = store.getMembers(channelId);
      expect(members).toHaveLength(0);
    });

    it("tracks read position", () => {
      store.addMember(channelId, "agent-1", "Alpha");
      store.sendMessage({ channelId, authorId: "agent-2", authorName: "Beta", text: "hello" });
      store.sendMessage({ channelId, authorId: "agent-2", authorName: "Beta", text: "world" });

      const unread = store.getUnreadCount(channelId, "agent-1");
      expect(unread).toBe(2);

      store.markRead(channelId, "agent-1");
      const unreadAfter = store.getUnreadCount(channelId, "agent-1");
      expect(unreadAfter).toBe(0);
    });

    it("gets channels for a member", () => {
      const ch2 = store.createChannel({ name: "other", kind: "general" });
      store.addMember(channelId, "agent-1", "Alpha");
      store.addMember(ch2.id, "agent-1", "Alpha");

      const channels = store.getChannelsForMember("agent-1");
      expect(channels).toHaveLength(2);
    });
  });

  describe("stats", () => {
    it("returns channel stats", () => {
      const ch = store.createChannel({ name: "stats-test", kind: "general" });
      store.addMember(ch.id, "a", "A");
      store.addMember(ch.id, "b", "B");
      store.sendMessage({ channelId: ch.id, authorId: "a", authorName: "A", text: "hi" });
      store.sendMessage({ channelId: ch.id, authorId: "b", authorName: "B", text: "hey" });

      const stats = store.getChannelStats(ch.id);
      expect(stats.messageCount).toBe(2);
      expect(stats.memberCount).toBe(2);
      expect(stats.lastMessageAt).not.toBeNull();
    });
  });
});
