import { describe, expect, it, vi } from "vitest";
import {
  formatMessageForTelegram,
  forwardToTelegram,
  isTelegramForwardEnabled,
} from "./telegram-forward.js";
import type { Channel, Message } from "./types.js";
import type { OpenClawConfig } from "../config/types.js";

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: "ch_test",
    name: "general",
    kind: "general",
    description: "Test channel",
    taskId: null,
    participants: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastMessageAt: null,
    archived: false,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg_test",
    channelId: "ch_test",
    authorId: "agent-alpha",
    authorName: "Alpha",
    kind: "text",
    text: "Hello world",
    taskRef: null,
    metadata: {},
    createdAt: Date.now(),
    editedAt: null,
    ...overrides,
  };
}

describe("telegram-forward", () => {
  describe("formatMessageForTelegram", () => {
    it("formats a text message", () => {
      const ch = makeChannel();
      const msg = makeMessage();
      const result = formatMessageForTelegram(ch, msg);
      expect(result).toContain("# general");
      expect(result).toContain("<b>Alpha</b>");
      expect(result).toContain("Hello world");
    });

    it("formats a system message in italics", () => {
      const ch = makeChannel({ kind: "system", name: "system" });
      const msg = makeMessage({ kind: "system", authorId: "system", text: "Agent started task" });
      const result = formatMessageForTelegram(ch, msg);
      expect(result).toContain("<i>Agent started task</i>");
    });

    it("formats a status message with code", () => {
      const ch = makeChannel({ kind: "task", name: "task-abc" });
      const msg = makeMessage({ kind: "status", text: "in_progress -> review" });
      const result = formatMessageForTelegram(ch, msg);
      expect(result).toContain("<code>");
      expect(result).toContain("in_progress -&gt; review");
    });

    it("formats a task_ref message", () => {
      const ch = makeChannel();
      const msg = makeMessage({ kind: "task_ref", text: "Working on this", taskRef: "task_123" });
      const result = formatMessageForTelegram(ch, msg);
      expect(result).toContain("task_123");
    });

    it("escapes HTML in author names and text", () => {
      const ch = makeChannel();
      const msg = makeMessage({ authorName: "<script>xss</script>", text: "a < b" });
      const result = formatMessageForTelegram(ch, msg);
      expect(result).not.toContain("<script>");
      expect(result).toContain("&lt;script&gt;");
      expect(result).toContain("a &lt; b");
    });
  });

  describe("isTelegramForwardEnabled", () => {
    it("returns false when multiAgentOs is disabled", () => {
      const cfg: OpenClawConfig = {};
      expect(isTelegramForwardEnabled(cfg)).toBe(false);
    });

    it("returns false when comms.telegramForward is not set", () => {
      const cfg: OpenClawConfig = {
        multiAgentOs: { enabled: true },
      };
      expect(isTelegramForwardEnabled(cfg)).toBe(false);
    });

    it("returns true when comms.telegramForward is true", () => {
      const cfg: OpenClawConfig = {
        multiAgentOs: {
          enabled: true,
          comms: { enabled: true, telegramForward: true },
        },
      };
      expect(isTelegramForwardEnabled(cfg)).toBe(true);
    });
  });

  describe("forwardToTelegram", () => {
    it("forwards a regular message", async () => {
      const sender = vi.fn().mockResolvedValue(undefined);
      const config = { chatId: "123456", sender };

      const result = await forwardToTelegram(config, makeChannel(), makeMessage());
      expect(result).toBe(true);
      expect(sender).toHaveBeenCalledTimes(1);
      expect(sender).toHaveBeenCalledWith("123456", expect.stringContaining("Alpha"), { parseMode: "HTML" });
    });

    it("forwards system messages", async () => {
      const sender = vi.fn().mockResolvedValue(undefined);
      const config = { chatId: "123456", sender };

      const ch = makeChannel({ kind: "system", name: "system" });
      const msg = makeMessage({ kind: "system", authorId: "system", text: "Agent completed task" });

      const result = await forwardToTelegram(config, ch, msg);
      expect(result).toBe(true);
    });

    it("skips direct messages", async () => {
      const sender = vi.fn().mockResolvedValue(undefined);
      const config = { chatId: "123456", sender };

      const ch = makeChannel({ kind: "direct", name: "A & B" });
      const msg = makeMessage();

      const result = await forwardToTelegram(config, ch, msg);
      expect(result).toBe(false);
      expect(sender).not.toHaveBeenCalled();
    });
  });
});
