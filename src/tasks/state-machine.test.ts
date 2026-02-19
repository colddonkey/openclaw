import { describe, expect, it } from "vitest";
import {
  getValidTransitions,
  isActiveStatus,
  isResolvedStatus,
  isValidTransition,
  resolveAutoTransition,
} from "./state-machine.js";

describe("isValidTransition", () => {
  it("allows identity (no-op) transitions", () => {
    expect(isValidTransition("ready", "ready")).toBe(true);
    expect(isValidTransition("done", "done")).toBe(true);
  });

  it("allows forward flow: backlog -> ready -> in_progress -> done", () => {
    expect(isValidTransition("backlog", "ready")).toBe(true);
    expect(isValidTransition("ready", "in_progress")).toBe(true);
    expect(isValidTransition("in_progress", "done")).toBe(true);
  });

  it("allows review flow", () => {
    expect(isValidTransition("in_progress", "review")).toBe(true);
    expect(isValidTransition("review", "done")).toBe(true);
  });

  it("allows blocking and unblocking", () => {
    expect(isValidTransition("ready", "blocked")).toBe(true);
    expect(isValidTransition("in_progress", "blocked")).toBe(true);
    expect(isValidTransition("blocked", "ready")).toBe(true);
  });

  it("allows archiving from any active state", () => {
    expect(isValidTransition("backlog", "archived")).toBe(true);
    expect(isValidTransition("ready", "archived")).toBe(true);
    expect(isValidTransition("in_progress", "archived")).toBe(true);
    expect(isValidTransition("done", "archived")).toBe(true);
  });

  it("allows reopening from done", () => {
    expect(isValidTransition("done", "ready")).toBe(true);
    expect(isValidTransition("done", "in_progress")).toBe(true);
  });

  it("allows unarchiving", () => {
    expect(isValidTransition("archived", "backlog")).toBe(true);
    expect(isValidTransition("archived", "ready")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(isValidTransition("backlog", "done")).toBe(false);
    expect(isValidTransition("backlog", "review")).toBe(false);
    expect(isValidTransition("backlog", "blocked")).toBe(false);
  });
});

describe("getValidTransitions", () => {
  it("returns expected transitions for ready", () => {
    const transitions = getValidTransitions("ready");
    expect(transitions).toContain("in_progress");
    expect(transitions).toContain("blocked");
    expect(transitions).not.toContain("done");
  });
});

describe("resolveAutoTransition", () => {
  it("moves blocked -> ready when no unresolved blockers", () => {
    expect(resolveAutoTransition("blocked", false)).toBe("ready");
  });

  it("keeps blocked when still has blockers", () => {
    expect(resolveAutoTransition("blocked", true)).toBeNull();
  });

  it("moves ready -> blocked when blockers appear", () => {
    expect(resolveAutoTransition("ready", true)).toBe("blocked");
  });

  it("moves in_progress -> blocked when blockers appear", () => {
    expect(resolveAutoTransition("in_progress", true)).toBe("blocked");
  });

  it("returns null for done regardless of blockers", () => {
    expect(resolveAutoTransition("done", true)).toBeNull();
    expect(resolveAutoTransition("done", false)).toBeNull();
  });
});

describe("status helpers", () => {
  it("isResolvedStatus", () => {
    expect(isResolvedStatus("done")).toBe(true);
    expect(isResolvedStatus("archived")).toBe(true);
    expect(isResolvedStatus("in_progress")).toBe(false);
    expect(isResolvedStatus("blocked")).toBe(false);
  });

  it("isActiveStatus", () => {
    expect(isActiveStatus("ready")).toBe(true);
    expect(isActiveStatus("in_progress")).toBe(true);
    expect(isActiveStatus("blocked")).toBe(true);
    expect(isActiveStatus("review")).toBe(true);
    expect(isActiveStatus("backlog")).toBe(false);
    expect(isActiveStatus("done")).toBe(false);
    expect(isActiveStatus("archived")).toBe(false);
  });
});
