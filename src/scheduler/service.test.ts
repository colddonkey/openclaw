import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SchedulerService } from "./service.js";
import { TaskStore } from "../tasks/store.js";
import { AgentIdentityStore } from "../tasks/agent-identity.js";
import { CommsStore } from "../comms/store.js";

let taskStore: TaskStore;
let identityStore: AgentIdentityStore;
let commsStore: CommsStore;
let scheduler: SchedulerService;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sched-test-"));
  taskStore = new TaskStore(path.join(tmpDir, "tasks.sqlite"));
  identityStore = new AgentIdentityStore(path.join(tmpDir, "identities.sqlite"));
  commsStore = new CommsStore(path.join(tmpDir, "comms.sqlite"));
  scheduler = new SchedulerService({
    taskStore,
    identityStore,
    commsStore,
    config: { maxConcurrentPerAgent: 3 },
  });
});

afterEach(() => {
  scheduler.stop();
  taskStore.close();
  identityStore.close();
  commsStore.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("SchedulerService", () => {
  it("does nothing when no unassigned tasks", async () => {
    const result = await scheduler.runOnce();
    expect(result.assignments).toHaveLength(0);
    expect(result.skippedTasks).toBe(0);
  });

  it("does nothing when no agents exist", async () => {
    taskStore.create({
      title: "A task",
      creatorId: "system",
      creatorName: "System",
      status: "ready",
    });

    const result = await scheduler.runOnce();
    expect(result.assignments).toHaveLength(0);
    expect(result.skippedTasks).toBe(1);
  });

  it("assigns an unassigned ready task to an available agent", async () => {
    const task = taskStore.create({
      title: "Build the API",
      labels: ["api"],
      creatorId: "system",
      creatorName: "System",
      status: "ready",
    });

    const identity = identityStore.getOrCreate("agent-alpha");
    identityStore.recordSkillUpdate("agent-alpha", { domain: "api", success: true });

    const result = await scheduler.runOnce();
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].taskId).toBe(task.id);
    expect(result.assignments[0].assignedTo).toBe("agent-alpha");

    const updated = taskStore.get(task.id);
    expect(updated!.assigneeId).toBe("agent-alpha");
  });

  it("does not reassign already-assigned tasks", async () => {
    identityStore.getOrCreate("agent-alpha");

    taskStore.create({
      title: "Already assigned",
      creatorId: "system",
      creatorName: "System",
      status: "ready",
      assigneeId: "agent-beta",
      assigneeName: "Beta",
    });

    const result = await scheduler.runOnce();
    expect(result.assignments).toHaveLength(0);
  });

  it("assigns to best-skilled agent", async () => {
    const task = taskStore.create({
      title: "Database migration",
      labels: ["database"],
      creatorId: "system",
      creatorName: "System",
      status: "ready",
    });

    identityStore.getOrCreate("agent-frontend");
    identityStore.recordSkillUpdate("agent-frontend", { domain: "frontend", success: true });

    identityStore.getOrCreate("agent-db");
    identityStore.recordSkillUpdate("agent-db", { domain: "database", success: true });
    identityStore.recordSkillUpdate("agent-db", { domain: "database", success: true });
    identityStore.recordSkillUpdate("agent-db", { domain: "database", success: true });

    const result = await scheduler.runOnce();
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].assignedTo).toBe("agent-db");
  });

  it("respects max concurrent limit", async () => {
    identityStore.getOrCreate("agent-only");

    for (let i = 0; i < 3; i++) {
      taskStore.create({
        title: `Active task ${i}`,
        creatorId: "system",
        creatorName: "System",
        status: "in_progress",
        assigneeId: "agent-only",
        assigneeName: "Only",
      });
    }

    taskStore.create({
      title: "New task",
      creatorId: "system",
      creatorName: "System",
      status: "ready",
    });

    const result = await scheduler.runOnce();
    expect(result.assignments).toHaveLength(0);
    expect(result.skippedTasks).toBe(1);
  });

  it("assigns multiple tasks in a single run", async () => {
    identityStore.getOrCreate("agent-alpha");
    identityStore.getOrCreate("agent-beta");

    taskStore.create({ title: "Task 1", creatorId: "system", creatorName: "System", status: "ready" });
    taskStore.create({ title: "Task 2", creatorId: "system", creatorName: "System", status: "ready" });
    taskStore.create({ title: "Task 3", creatorId: "system", creatorName: "System", status: "ready" });

    const result = await scheduler.runOnce();
    expect(result.assignments.length).toBeGreaterThanOrEqual(2);
  });

  it("posts a system notification on assignment", async () => {
    taskStore.create({
      title: "Notify test",
      creatorId: "system",
      creatorName: "System",
      status: "ready",
    });
    identityStore.getOrCreate("agent-alpha");

    await scheduler.runOnce();

    const systemCh = commsStore.getChannelByName("system")!;
    const messages = commsStore.getRecentMessages(systemCh.id);
    const assignmentMsg = messages.find((m) => m.text.includes("Notify test"));
    expect(assignmentMsg).toBeDefined();
  });

  it("tracks last run result", async () => {
    expect(scheduler.getLastRun()).toBeNull();

    await scheduler.runOnce();

    const lastRun = scheduler.getLastRun();
    expect(lastRun).not.toBeNull();
    expect(lastRun!.runAt).toBeGreaterThan(0);
    expect(lastRun!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("ignores non-ready tasks", async () => {
    identityStore.getOrCreate("agent-alpha");

    taskStore.create({ title: "In progress", creatorId: "system", creatorName: "System", status: "in_progress" });
    taskStore.create({ title: "Blocked", creatorId: "system", creatorName: "System", status: "blocked" });
    taskStore.create({ title: "Backlog", creatorId: "system", creatorName: "System", status: "backlog" });

    const result = await scheduler.runOnce();
    expect(result.assignments).toHaveLength(0);
  });
});
