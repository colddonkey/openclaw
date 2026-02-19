import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentLoop, type WorkExecutor } from "./agent-loop.js";
import { TaskStore } from "../tasks/store.js";
import { AgentIdentityStore } from "../tasks/agent-identity.js";
import { CommsStore } from "../comms/store.js";

let taskStore: TaskStore;
let identityStore: AgentIdentityStore;
let commsStore: CommsStore;

beforeEach(() => {
  taskStore = new TaskStore(":memory:");
  identityStore = new AgentIdentityStore(":memory:");
  commsStore = new CommsStore(":memory:");
});

afterEach(() => {
  taskStore.close();
  identityStore.close();
  commsStore.close();
});

function makeLoop(executor?: WorkExecutor) {
  return new AgentLoop("agent-1", {
    taskStore,
    identityStore,
    commsStore,
    workExecutor: executor,
  }, {
    enabled: true,
    tickIntervalMs: 100_000, // won't auto-fire in tests
    maxConsecutiveErrors: 3,
    maxCyclesPerSession: 50,
    completionCooldownMs: 0,
  });
}

describe("AgentLoop", () => {
  it("starts in idle phase", () => {
    const loop = makeLoop();
    const state = loop.getState();
    expect(state.phase).toBe("idle");
    expect(state.currentTaskId).toBeNull();
    expect(state.cyclesCompleted).toBe(0);
  });

  it("returns idle decision when no tasks assigned", async () => {
    const loop = makeLoop();
    const result = await loop.tick();
    expect(result.decision.type).toBe("idle");
    expect(result.tasksCompleted).toBe(0);
  });

  it("picks up an assigned task on tick", async () => {
    const task = taskStore.create({
      title: "Test task",
      description: "- Step one\n- Step two",
      status: "ready",
      assigneeId: "agent-1",
      creatorId: "system",
      creatorName: "system",
    });

    const loop = makeLoop();
    // First tick: picks the task
    const result = await loop.tick();
    expect(result.decision.type).toBe("pick_task");

    const state = loop.getState();
    expect(state.currentTaskId).toBe(task.id);
    expect(state.workPlan.length).toBe(2);
    expect(state.phase).toBe("planning");
  });

  it("continues working through steps", async () => {
    taskStore.create({
      title: "Multi-step task",
      description: "- Alpha\n- Beta",
      status: "ready",
      assigneeId: "agent-1",
      creatorId: "system",
      creatorName: "system",
    });

    const executor: WorkExecutor = async ({ stepDescription }) => ({
      output: `Done: ${stepDescription}`,
      success: true,
    });

    const loop = makeLoop(executor);

    // Tick 1: pick task
    await loop.tick();
    expect(loop.getState().phase).toBe("planning");

    // Tick 2: work on step 0
    const r2 = await loop.tick();
    expect(r2.decision.type).toBe("continue_work");

    // Tick 3: work on step 1
    const r3 = await loop.tick();
    expect(r3.decision.type).toBe("continue_work");

    // Tick 4: all steps done → complete
    const r4 = await loop.tick();
    expect(r4.decision.type).toBe("complete_task");
    expect(r4.tasksCompleted).toBe(1);
    expect(loop.getState().currentTaskId).toBeNull();
    expect(loop.getState().phase).toBe("idle");
  });

  it("updates task status to in_progress and done", async () => {
    const task = taskStore.create({
      title: "Status transitions",
      description: "",
      status: "ready",
      assigneeId: "agent-1",
      creatorId: "system",
      creatorName: "system",
    });

    const executor: WorkExecutor = async () => ({ output: "ok", success: true });
    const loop = makeLoop(executor);

    // Pick
    await loop.tick();
    expect(taskStore.get(task.id)!.status).toBe("in_progress");

    // Execute 3 generic steps
    await loop.tick();
    await loop.tick();
    await loop.tick();

    // Complete
    await loop.tick();
    expect(taskStore.get(task.id)!.status).toBe("done");
  });

  it("updates agent identity on task completion", async () => {
    taskStore.create({
      title: "Skill builder",
      description: "",
      status: "ready",
      assigneeId: "agent-1",
      labels: ["testing"],
      creatorId: "system",
      creatorName: "system",
    });

    const executor: WorkExecutor = async () => ({ output: "ok", success: true });
    const loop = makeLoop(executor);

    // Run through the full cycle
    for (let i = 0; i < 6; i++) await loop.tick();

    const identity = identityStore.get("agent-1");
    expect(identity).not.toBeNull();
    expect(identity!.stats.tasksCompleted).toBeGreaterThanOrEqual(1);

    const skills = identityStore.getSkills("agent-1");
    const testingSkill = skills.find((s) => s.domain === "testing");
    expect(testingSkill).toBeDefined();
    expect(testingSkill!.taskCount).toBeGreaterThanOrEqual(1);
  });

  it("posts messages to comms on task lifecycle", async () => {
    const task = taskStore.create({
      title: "Chatty task",
      description: "- Step A",
      status: "ready",
      assigneeId: "agent-1",
      creatorId: "system",
      creatorName: "system",
    });

    const executor: WorkExecutor = async () => ({ output: "ok", success: true });
    const loop = makeLoop(executor);

    // Run until task completes
    for (let i = 0; i < 10; i++) {
      const r = await loop.tick();
      if (r.decision.type === "idle" && r.tasksCompleted === 0 && loop.getState().cyclesCompleted > 1) break;
    }

    // Task channel should have progress + status messages
    const taskChannel = commsStore.getChannelForTask(task.id);
    expect(taskChannel).not.toBeNull();
    const messages = commsStore.getRecentMessages(taskChannel!.id, 50);
    expect(messages.length).toBeGreaterThan(0);
  });

  it("handles step failures gracefully", async () => {
    taskStore.create({
      title: "Failing task",
      description: "- Will fail",
      status: "ready",
      assigneeId: "agent-1",
      creatorId: "system",
      creatorName: "system",
    });

    const executor: WorkExecutor = async () => ({
      output: "Something went wrong",
      success: false,
    });

    const loop = makeLoop(executor);

    // Pick
    await loop.tick();
    // Execute (fails)
    const result = await loop.tick();
    expect(result.errors.length).toBeGreaterThan(0);

    const state = loop.getState();
    expect(state.workPlan[0].status).toBe("failed");
  });

  it("pauses after max consecutive errors", async () => {
    const throwingExecutor: WorkExecutor = async () => {
      throw new Error("Boom");
    };

    taskStore.create({
      title: "Error prone",
      description: "- Explodes",
      status: "ready",
      assigneeId: "agent-1",
      creatorId: "system",
      creatorName: "system",
    });

    const loop = makeLoop(throwingExecutor);

    // Pick + 3 errors
    await loop.tick(); // pick (succeeds)
    await loop.tick(); // error 1
    await loop.tick(); // error 2
    await loop.tick(); // error 3 → paused

    const state = loop.getState();
    expect(state.phase).toBe("error");
    expect(state.errorCount).toBe(3);
  });

  it("increments cyclesCompleted each tick", async () => {
    const loop = makeLoop();
    expect(loop.getState().cyclesCompleted).toBe(0);
    await loop.tick();
    expect(loop.getState().cyclesCompleted).toBe(1);
    await loop.tick();
    expect(loop.getState().cyclesCompleted).toBe(2);
  });
});
