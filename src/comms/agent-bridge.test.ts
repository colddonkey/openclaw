import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CommsStore } from "./store.js";
import {
  autoJoinChannels,
  ensureAgentInChannel,
  postAgentSystemNotification,
  postTaskStatusUpdate,
  resolveAgentContext,
  sendAgentMessage,
} from "./agent-bridge.js";

let store: CommsStore;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "comms-bridge-test-"));
  store = new CommsStore(path.join(tmpDir, "comms.sqlite"));
});

afterEach(() => {
  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("agent-bridge", () => {
  describe("resolveAgentContext", () => {
    it("returns fallback context when no identity store", () => {
      const ctx = resolveAgentContext("agent-alpha", null);
      expect(ctx.displayName).toBe("agent-alpha");
      expect(ctx.topTraits).toEqual([]);
      expect(ctx.topSkills).toEqual([]);
      expect(ctx.avatarHint).toBe("A");
    });
  });

  describe("sendAgentMessage", () => {
    it("sends a message with identity metadata", () => {
      const general = store.getChannelByName("general")!;
      const msg = sendAgentMessage(store, null, {
        channelId: general.id,
        agentId: "agent-alpha",
        text: "Hello team!",
      });
      expect(msg.text).toBe("Hello team!");
      expect(msg.authorId).toBe("agent-alpha");
      expect(msg.metadata).toEqual({
        traits: [],
        skills: [],
        avatarHint: "A",
      });
    });

    it("sends a task_ref message", () => {
      const general = store.getChannelByName("general")!;
      const msg = sendAgentMessage(store, null, {
        channelId: general.id,
        agentId: "agent-beta",
        text: "Working on this",
        kind: "task_ref",
        taskRef: "task_123",
      });
      expect(msg.kind).toBe("task_ref");
      expect(msg.taskRef).toBe("task_123");
    });
  });

  describe("ensureAgentInChannel", () => {
    it("adds agent to channel", () => {
      const general = store.getChannelByName("general")!;
      ensureAgentInChannel(store, null, general.id, "agent-alpha");
      const members = store.getMembers(general.id);
      expect(members.find((m) => m.memberId === "agent-alpha")).toBeDefined();
    });

    it("is idempotent", () => {
      const general = store.getChannelByName("general")!;
      ensureAgentInChannel(store, null, general.id, "agent-alpha");
      ensureAgentInChannel(store, null, general.id, "agent-alpha");
      const members = store.getMembers(general.id);
      expect(members.filter((m) => m.memberId === "agent-alpha")).toHaveLength(1);
    });
  });

  describe("autoJoinChannels", () => {
    it("joins general channel", () => {
      autoJoinChannels(store, null, "agent-alpha");
      const general = store.getChannelByName("general")!;
      const members = store.getMembers(general.id);
      expect(members.find((m) => m.memberId === "agent-alpha")).toBeDefined();
    });

    it("creates and joins task channel", () => {
      autoJoinChannels(store, null, "agent-alpha", "task_abc", "Fix the bug");
      const taskCh = store.getChannelForTask("task_abc");
      expect(taskCh).not.toBeNull();
      const members = store.getMembers(taskCh!.id);
      expect(members.find((m) => m.memberId === "agent-alpha")).toBeDefined();
    });
  });

  describe("postAgentSystemNotification", () => {
    it("posts to system channel", () => {
      const msg = postAgentSystemNotification(
        store, null, "agent-alpha", "completed task", "Fix the login bug",
      );
      expect(msg.kind).toBe("system");
      expect(msg.text).toContain("agent-alpha");
      expect(msg.text).toContain("completed task");
      expect(msg.text).toContain("Fix the login bug");

      const system = store.getChannelByName("system")!;
      expect(msg.channelId).toBe(system.id);
    });
  });

  describe("postTaskStatusUpdate", () => {
    it("posts status update to task channel", () => {
      const msg = postTaskStatusUpdate(
        store, null, "agent-alpha",
        "task_abc", "Fix login", "in_progress", "review",
      );
      expect(msg.kind).toBe("status");
      expect(msg.text).toContain("in_progress");
      expect(msg.text).toContain("review");
      expect(msg.taskRef).toBe("task_abc");

      const taskCh = store.getChannelForTask("task_abc");
      expect(taskCh).not.toBeNull();
    });
  });
});
