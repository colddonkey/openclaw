import { describe, expect, it } from "vitest";
import {
  extractTasksFromText,
  fingerprint,
  toTaskCreateInputs,
  type ExtractionContext,
} from "./auto-generate.js";

describe("extractTasksFromText", () => {
  describe("explicit patterns", () => {
    it("extracts TODO: prefixed items", () => {
      const { tasks } = extractTasksFromText("TODO: fix the authentication flow");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.title).toBe("Fix the authentication flow");
      expect(tasks[0]!.confidence).toBe("explicit");
    });

    it("extracts FIXME: prefixed items", () => {
      const { tasks } = extractTasksFromText("FIXME: memory leak in the worker pool");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.title).toBe("Memory leak in the worker pool");
      expect(tasks[0]!.confidence).toBe("explicit");
    });

    it("extracts HACK: prefixed items", () => {
      const { tasks } = extractTasksFromText("HACK: workaround for the race condition");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.confidence).toBe("explicit");
    });

    it("extracts 'Action item:' prefix", () => {
      const { tasks } = extractTasksFromText("Action item: set up monitoring dashboard");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.title).toBe("Set up monitoring dashboard");
      expect(tasks[0]!.confidence).toBe("explicit");
    });

    it("extracts 'Task:' prefix", () => {
      const { tasks } = extractTasksFromText("Task: migrate database schema to v3");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.confidence).toBe("explicit");
    });

    it("handles bullet-prefixed TODOs", () => {
      const { tasks } = extractTasksFromText("- TODO: update the configuration");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.title).toBe("Update the configuration");
    });

    it("handles asterisk-prefixed TODOs", () => {
      const { tasks } = extractTasksFromText("* FIXME: broken pagination logic");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.confidence).toBe("explicit");
    });
  });

  describe("next steps block", () => {
    it("extracts items from a 'Next steps:' block", () => {
      const text = `
Here's what we did.

Next steps:
- Add error handling for edge cases
- Write unit tests for the store module
- Deploy to staging environment
`;
      const { tasks } = extractTasksFromText(text);
      expect(tasks).toHaveLength(3);
      expect(tasks[0]!.confidence).toBe("explicit");
      expect(tasks[1]!.confidence).toBe("explicit");
      expect(tasks[2]!.confidence).toBe("explicit");
    });

    it("extracts items from 'Remaining work:' block", () => {
      const text = `
Remaining work:
1. Implement the retry logic with backoff
2. Add rate limiting to the API endpoint
`;
      const { tasks } = extractTasksFromText(text);
      expect(tasks).toHaveLength(2);
    });

    it("stops next-steps extraction at non-list line", () => {
      const text = `
Next steps:
- Fix the broken tests first
This is just a regular sentence.
- This should not be extracted as next-step
`;
      const { tasks } = extractTasksFromText(text);
      const nextStepTasks = tasks.filter((t) => t.confidence === "explicit");
      expect(nextStepTasks).toHaveLength(1);
      expect(nextStepTasks[0]!.title).toBe("Fix the broken tests first");
    });
  });

  describe("implicit patterns", () => {
    it("extracts 'I need to' commitments", () => {
      const { tasks } = extractTasksFromText("I need to refactor the database connection pool");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.confidence).toBe("implicit");
      expect(tasks[0]!.title).toContain("Refactor");
    });

    it("extracts 'We need to' commitments", () => {
      const { tasks } = extractTasksFromText("We need to update the API documentation");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.confidence).toBe("implicit");
    });

    it("extracts 'remember to' commitments", () => {
      const { tasks } = extractTasksFromText("Remember to run the migration script first");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.confidence).toBe("implicit");
    });

    it("extracts 'don't forget to' commitments", () => {
      const { tasks } = extractTasksFromText("Don't forget to update the changelog entry");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.confidence).toBe("implicit");
    });

    it("extracts 'we should' suggestions", () => {
      const { tasks } = extractTasksFromText("We should add caching to the search endpoint");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.confidence).toBe("implicit");
    });

    it("extracts 'let's' proposals", () => {
      const { tasks } = extractTasksFromText("Let's implement proper error handling here");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.confidence).toBe("implicit");
    });

    it("extracts 'I'll' commitments", () => {
      const { tasks } = extractTasksFromText("I'll look into the memory leak tomorrow");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.confidence).toBe("implicit");
    });

    it("extracts 'can you' requests", () => {
      const { tasks } = extractTasksFromText("Can you fix the login page styling");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.confidence).toBe("implicit");
    });

    it("extracts 'please' requests", () => {
      const { tasks } = extractTasksFromText("Please implement the webhook handler for Stripe");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.confidence).toBe("implicit");
    });

    it("extracts 'make sure to' commitments", () => {
      const { tasks } = extractTasksFromText("Make sure to validate all input parameters");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.confidence).toBe("implicit");
    });
  });

  describe("priority inference", () => {
    it("marks urgent items as critical", () => {
      const { tasks } = extractTasksFromText("TODO: urgent fix for the authentication bypass");
      expect(tasks[0]!.priority).toBe("critical");
    });

    it("marks important items as high", () => {
      const { tasks } = extractTasksFromText("TODO: important regression in the payment flow");
      expect(tasks[0]!.priority).toBe("high");
    });

    it("marks trivial items as low", () => {
      const { tasks } = extractTasksFromText("TODO: minor typo in the about page content");
      expect(tasks[0]!.priority).toBe("low");
    });

    it("defaults to medium priority", () => {
      const { tasks } = extractTasksFromText("TODO: add pagination to the user list");
      expect(tasks[0]!.priority).toBe("medium");
    });
  });

  describe("label inference", () => {
    it("detects testing labels", () => {
      const { tasks } = extractTasksFromText("TODO: add test coverage for the auth module");
      expect(tasks[0]!.labels).toContain("testing");
    });

    it("detects bug labels", () => {
      const { tasks } = extractTasksFromText("FIXME: fix broken pagination in search results");
      expect(tasks[0]!.labels).toContain("bug");
    });

    it("detects refactor labels", () => {
      const { tasks } = extractTasksFromText("TODO: refactor the database connection handler");
      expect(tasks[0]!.labels).toContain("refactor");
    });

    it("detects docs labels", () => {
      const { tasks } = extractTasksFromText("TODO: update documentation for the new API");
      expect(tasks[0]!.labels).toContain("docs");
    });

    it("always includes auto-generated label", () => {
      const { tasks } = extractTasksFromText("TODO: some random task that needs doing");
      expect(tasks[0]!.labels).toContain("auto-generated");
    });
  });

  describe("deduplication", () => {
    it("deduplicates identical tasks within the same text", () => {
      const text = `
TODO: fix the broken tests
Some other text
TODO: fix the broken tests
`;
      const { tasks } = extractTasksFromText(text);
      expect(tasks).toHaveLength(1);
    });

    it("deduplicates against existing fingerprints", () => {
      const existing = new Set(["fix the broken tests"]);
      const { tasks } = extractTasksFromText("TODO: fix the broken tests", existing);
      expect(tasks).toHaveLength(0);
    });

    it("returns fingerprints for dedup tracking", () => {
      const { fingerprints } = extractTasksFromText("TODO: implement the retry logic");
      expect(fingerprints).toHaveLength(1);
      expect(fingerprints[0]).toBe(fingerprint("Implement the retry logic"));
    });
  });

  describe("quality gates", () => {
    it("rejects titles that are too short", () => {
      const { tasks } = extractTasksFromText("TODO: fix");
      expect(tasks).toHaveLength(0);
    });

    it("rejects noise words", () => {
      const { tasks } = extractTasksFromText("ok");
      expect(tasks).toHaveLength(0);
    });

    it("rejects empty content", () => {
      const { tasks } = extractTasksFromText("");
      expect(tasks).toHaveLength(0);
    });

    it("truncates very long titles", () => {
      const long = "TODO: " + "a".repeat(200) + " very long task title";
      const { tasks } = extractTasksFromText(long);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.title.length).toBeLessThanOrEqual(120);
      expect(tasks[0]!.title).toMatch(/\.\.\.$/);
    });
  });

  describe("multi-task extraction", () => {
    it("extracts multiple tasks from a single message", () => {
      const text = `
Here's what I found:
TODO: fix the broken pagination
FIXME: memory leak in the worker pool
I need to update the API documentation too
`;
      const { tasks } = extractTasksFromText(text);
      expect(tasks.length).toBeGreaterThanOrEqual(3);
    });

    it("mixes explicit and implicit tasks", () => {
      const text = `
TODO: add error handling
We should also add logging
`;
      const { tasks } = extractTasksFromText(text);
      const explicit = tasks.filter((t) => t.confidence === "explicit");
      const implicit = tasks.filter((t) => t.confidence === "implicit");
      expect(explicit.length).toBeGreaterThanOrEqual(1);
      expect(implicit.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("fingerprint", () => {
  it("normalizes case", () => {
    expect(fingerprint("Fix The Bug")).toBe(fingerprint("fix the bug"));
  });

  it("collapses whitespace", () => {
    expect(fingerprint("fix  the   bug")).toBe(fingerprint("fix the bug"));
  });

  it("strips punctuation", () => {
    expect(fingerprint("fix the bug!")).toBe(fingerprint("fix the bug"));
  });
});

describe("toTaskCreateInputs", () => {
  it("converts extracted tasks to create inputs", () => {
    const { tasks } = extractTasksFromText("TODO: fix the login page styling");
    const ctx: ExtractionContext = {
      senderId: "user-123",
      senderName: "Peter",
      channelId: "telegram",
      sessionKey: "sess-abc",
      conversationId: "chat-456",
    };

    const inputs = toTaskCreateInputs(tasks, ctx);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.title).toBe("Fix the login page styling");
    expect(inputs[0]!.status).toBe("ready"); // explicit -> ready
    expect(inputs[0]!.creatorId).toBe("user-123");
    expect(inputs[0]!.source).toBe("conversation");
    expect(inputs[0]!.sessionKey).toBe("sess-abc");
  });

  it("uses backlog status for implicit tasks", () => {
    const { tasks } = extractTasksFromText("I need to refactor the database connection pool");
    const ctx: ExtractionContext = {
      senderId: "user-123",
      senderName: "Peter",
    };

    const inputs = toTaskCreateInputs(tasks, ctx);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.status).toBe("backlog");
  });
});
