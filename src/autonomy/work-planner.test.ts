import { describe, it, expect } from "vitest";
import { decide, planWork, pickNextTask, pickNextTriageTask } from "./work-planner.js";
import type { DecisionContext, AgentState, WorkStep } from "./types.js";
import type { Task } from "../tasks/types.js";
import type { AgentIdentity } from "../tasks/agent-identity.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Fix the widget",
    description: "",
    status: "ready",
    priority: "medium",
    type: "task",
    assigneeId: null,
    assigneeName: null,
    creatorId: "system",
    creatorName: "system",
    labels: [],
    sessionKey: null,
    parentId: null,
    source: "manual",
    metadata: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: null,
    completedAt: null,
    estimateMinutes: null,
    triagePlan: null,
    triagedAt: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    agentId: "agent-1",
    phase: "idle",
    currentTaskId: null,
    currentTaskTitle: null,
    workPlan: [],
    currentStepIndex: 0,
    phaseChangedAt: Date.now(),
    cyclesCompleted: 0,
    errorCount: 0,
    lastError: null,
    sessionStartedAt: Date.now(),
    ...overrides,
  };
}

function makeIdentity(): AgentIdentity {
  return {
    agentId: "agent-1",
    seed: {},
    traits: [],
    skills: [{ domain: "testing", level: 0.8, taskCount: 5, successCount: 4, lastPracticed: Date.now() }],
    stats: { tasksCompleted: 10, tasksFailed: 1, tasksCreated: 3, commentsGiven: 5, conversationsHad: 20, totalWorkMinutes: 120, lastActive: Date.now() },
    selfReflection: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    agent: makeIdentity(),
    state: makeState(),
    assignedTasks: [],
    triageTasks: [],
    unreadMessages: [],
    recentSystemEvents: [],
    currentLoad: 0,
    maxConcurrent: 3,
    ...overrides,
  };
}

describe("decide", () => {
  it("returns idle when no tasks and no messages", () => {
    const ctx = makeContext();
    const decision = decide(ctx);
    expect(decision.type).toBe("idle");
  });

  it("picks a task when one is assigned and ready", () => {
    const task = makeTask({ assigneeId: "agent-1" });
    const ctx = makeContext({ assignedTasks: [task] });
    const decision = decide(ctx);
    expect(decision.type).toBe("pick_task");
    if (decision.type === "pick_task") {
      expect(decision.taskId).toBe("task-1");
    }
  });

  it("responds to direct messages first", () => {
    const task = makeTask({ assigneeId: "agent-1" });
    const ctx = makeContext({
      assignedTasks: [task],
      unreadMessages: [
        {
          channel: { id: "ch-1", name: "dm", kind: "direct", description: "", taskId: null, participants: ["agent-1", "other"], createdAt: Date.now(), updatedAt: Date.now(), lastMessageAt: Date.now(), archived: false },
          messages: [{ id: "msg-1", channelId: "ch-1", authorId: "other", authorName: "Other", text: "Hey!", kind: "text", taskRef: null, metadata: {}, createdAt: Date.now(), editedAt: null }],
        },
      ],
    });
    const decision = decide(ctx);
    expect(decision.type).toBe("respond_message");
  });

  it("continues work when in working phase with pending steps", () => {
    const task = makeTask({ id: "task-1", status: "in_progress" });
    const steps: WorkStep[] = [
      { id: "s0", description: "step 0", status: "done", output: null, startedAt: null, completedAt: null },
      { id: "s1", description: "step 1", status: "pending", output: null, startedAt: null, completedAt: null },
    ];
    const state = makeState({
      phase: "working",
      currentTaskId: "task-1",
      workPlan: steps,
      currentStepIndex: 0,
    });
    const ctx = makeContext({ state, assignedTasks: [task] });
    const decision = decide(ctx);
    expect(decision.type).toBe("continue_work");
    if (decision.type === "continue_work") {
      expect(decision.stepIndex).toBe(1);
    }
  });

  it("completes task when all steps are done", () => {
    const task = makeTask({ id: "task-1", status: "in_progress" });
    const steps: WorkStep[] = [
      { id: "s0", description: "step 0", status: "done", output: null, startedAt: null, completedAt: null },
      { id: "s1", description: "step 1", status: "done", output: null, startedAt: null, completedAt: null },
    ];
    const state = makeState({
      phase: "working",
      currentTaskId: "task-1",
      workPlan: steps,
    });
    const ctx = makeContext({ state, assignedTasks: [task] });
    const decision = decide(ctx);
    expect(decision.type).toBe("complete_task");
  });

  it("returns idle when paused", () => {
    const state = makeState({ phase: "paused" });
    const ctx = makeContext({ state, assignedTasks: [makeTask()] });
    const decision = decide(ctx);
    expect(decision.type).toBe("idle");
    if (decision.type === "idle") {
      expect(decision.reason).toContain("paused");
    }
  });

  it("reflects when idle for too long with completed cycles", () => {
    const state = makeState({
      phase: "idle",
      phaseChangedAt: Date.now() - 120_000,
      cyclesCompleted: 5,
    });
    const ctx = makeContext({ state });
    const decision = decide(ctx);
    expect(decision.type).toBe("reflect");
  });

  it("picks higher priority tasks first", () => {
    const tasks = [
      makeTask({ id: "low", priority: "low", status: "ready" }),
      makeTask({ id: "critical", priority: "critical", status: "ready" }),
      makeTask({ id: "high", priority: "high", status: "ready" }),
    ];
    const ctx = makeContext({ assignedTasks: tasks });
    const decision = decide(ctx);
    expect(decision.type).toBe("pick_task");
    if (decision.type === "pick_task") {
      expect(decision.taskId).toBe("critical");
    }
  });
});

describe("planWork", () => {
  it("creates generic 3-step plan for empty description", () => {
    const task = makeTask({ description: "" });
    const plan = planWork(task);
    expect(plan.steps).toHaveLength(3);
    expect(plan.taskId).toBe("task-1");
    expect(plan.steps[0].description).toContain("Analyze");
    expect(plan.steps[1].description).toContain("Execute");
    expect(plan.steps[2].description).toContain("Verify");
  });

  it("extracts numbered steps from description", () => {
    const task = makeTask({
      description: "1. Research the issue\n2. Write the fix\n3. Add tests\n4. Update docs",
    });
    const plan = planWork(task);
    expect(plan.steps).toHaveLength(4);
    expect(plan.steps[0].description).toBe("Research the issue");
    expect(plan.steps[3].description).toBe("Update docs");
  });

  it("extracts bullet-point steps from description", () => {
    const task = makeTask({
      description: "- First thing\n- Second thing\n- Third thing",
    });
    const plan = planWork(task);
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[1].description).toBe("Second thing");
  });

  it("uses estimate from task when available", () => {
    const task = makeTask({ estimateMinutes: 30, description: "" });
    const plan = planWork(task);
    expect(plan.estimatedMinutes).toBe(30);
  });

  it("all steps start as pending", () => {
    const task = makeTask({ description: "- A\n- B" });
    const plan = planWork(task);
    for (const step of plan.steps) {
      expect(step.status).toBe("pending");
      expect(step.startedAt).toBeNull();
      expect(step.completedAt).toBeNull();
    }
  });
});

describe("triage decisions", () => {
  it("decides to triage a task before picking ready tasks", () => {
    const readyTask = makeTask({ id: "ready-1", status: "ready" });
    const triageTask = makeTask({ id: "triage-1", status: "triage", type: "story" });
    const ctx = makeContext({
      assignedTasks: [readyTask],
      triageTasks: [triageTask],
    });
    const decision = decide(ctx);
    expect(decision.type).toBe("triage_task");
    if (decision.type === "triage_task") {
      expect(decision.taskId).toBe("triage-1");
    }
  });

  it("continues triage when already planning a triage task", () => {
    const triageTask = makeTask({ id: "triage-1", status: "triage", type: "epic" });
    const state = makeState({
      phase: "planning",
      currentTaskId: "triage-1",
    });
    const ctx = makeContext({
      state,
      triageTasks: [triageTask],
    });
    const decision = decide(ctx);
    expect(decision.type).toBe("triage_task");
  });

  it("falls through to pick_task when no triage tasks exist", () => {
    const readyTask = makeTask({ id: "ready-1", status: "ready" });
    const ctx = makeContext({
      assignedTasks: [readyTask],
      triageTasks: [],
    });
    const decision = decide(ctx);
    expect(decision.type).toBe("pick_task");
  });
});

describe("pickNextTriageTask", () => {
  it("returns null when no triage tasks", () => {
    expect(pickNextTriageTask([], makeState())).toBeNull();
  });

  it("picks highest priority triage task", () => {
    const tasks = [
      makeTask({ id: "low", status: "triage", priority: "low" }),
      makeTask({ id: "high", status: "triage", priority: "high" }),
    ];
    const result = pickNextTriageTask(tasks, makeState());
    expect(result?.id).toBe("high");
  });

  it("skips current task", () => {
    const tasks = [
      makeTask({ id: "current", status: "triage" }),
      makeTask({ id: "other", status: "triage" }),
    ];
    const state = makeState({ currentTaskId: "current" });
    const result = pickNextTriageTask(tasks, state);
    expect(result?.id).toBe("other");
  });
});

describe("pickNextTask", () => {
  it("returns null when no tasks", () => {
    expect(pickNextTask([], makeState())).toBeNull();
  });

  it("returns null when all tasks are done", () => {
    const tasks = [makeTask({ status: "done" }), makeTask({ id: "t2", status: "archived" })];
    expect(pickNextTask(tasks, makeState())).toBeNull();
  });

  it("skips the current task", () => {
    const tasks = [
      makeTask({ id: "current", status: "in_progress" }),
      makeTask({ id: "next", status: "ready" }),
    ];
    const state = makeState({ currentTaskId: "current" });
    const result = pickNextTask(tasks, state);
    expect(result?.id).toBe("next");
  });

  it("returns oldest task at same priority", () => {
    const tasks = [
      makeTask({ id: "newer", status: "ready", createdAt: 2000 }),
      makeTask({ id: "older", status: "ready", createdAt: 1000 }),
    ];
    const result = pickNextTask(tasks, makeState());
    expect(result?.id).toBe("older");
  });
});
