import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AutonomyService } from "./service.js";
import { TaskStore } from "../tasks/store.js";
import { AgentIdentityStore } from "../tasks/agent-identity.js";
import { CommsStore } from "../comms/store.js";
import type { WorkExecutor } from "./agent-loop.js";

let taskStore: TaskStore;
let identityStore: AgentIdentityStore;
let commsStore: CommsStore;

const fastExecutor: WorkExecutor = async () => ({ output: "ok", success: true });

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

function makeService(overrides: Record<string, unknown> = {}) {
  return new AutonomyService(
    { taskStore, identityStore, commsStore, workExecutor: fastExecutor },
    {
      enabled: true,
      tickIntervalMs: 100_000,
      maxConsecutiveErrors: 5,
      maxCyclesPerSession: 50,
      completionCooldownMs: 0,
      ...overrides,
    },
  );
}

describe("AutonomyService", () => {
  it("starts with no agents", () => {
    const svc = makeService();
    const status = svc.getStatus();
    expect(status.running).toBe(false);
    expect(status.agentCount).toBe(0);
  });

  it("spawns agents from identity store on start", () => {
    identityStore.getOrCreate("alpha");
    identityStore.getOrCreate("beta");

    const svc = makeService();
    svc.start();

    const status = svc.getStatus();
    expect(status.running).toBe(true);
    expect(status.agentCount).toBe(2);
    expect(status.agents.map((a) => a.agentId).sort()).toEqual(["alpha", "beta"]);

    svc.stop();
  });

  it("respects activeAgents config filter", () => {
    identityStore.getOrCreate("alpha");
    identityStore.getOrCreate("beta");
    identityStore.getOrCreate("gamma");

    const svc = makeService({ activeAgents: ["alpha", "gamma"] });
    svc.start();

    const status = svc.getStatus();
    expect(status.agentCount).toBe(2);
    expect(status.agents.map((a) => a.agentId).sort()).toEqual(["alpha", "gamma"]);

    svc.stop();
  });

  it("can manually spawn and remove agents", () => {
    const svc = makeService();
    svc.spawnAgent("agent-x");
    expect(svc.getStatus().agentCount).toBe(1);

    svc.removeAgent("agent-x");
    expect(svc.getStatus().agentCount).toBe(0);
  });

  it("tickAgent runs a single cycle for a specific agent", async () => {
    taskStore.create({
      title: "Tickable task",
      description: "",
      status: "ready",
      assigneeId: "agent-1",
      creatorId: "system",
      creatorName: "system",
    });

    const svc = makeService();
    svc.spawnAgent("agent-1");

    const result = await svc.tickAgent("agent-1");
    expect(result).not.toBeNull();
    expect(result!.decision.type).toBe("pick_task");
  });

  it("returns null when ticking unknown agent", async () => {
    const svc = makeService();
    const result = await svc.tickAgent("nope");
    expect(result).toBeNull();
  });

  it("collects cycle history", async () => {
    const svc = makeService();
    svc.spawnAgent("agent-1");

    await svc.tickAgent("agent-1");
    await svc.tickAgent("agent-1");

    const cycles = svc.getRecentCycles();
    expect(cycles.length).toBe(2);
    expect(cycles[0].agentId).toBe("agent-1");
  });

  it("stop halts all loops", () => {
    identityStore.getOrCreate("a");
    identityStore.getOrCreate("b");

    const svc = makeService();
    svc.start();
    expect(svc.getStatus().running).toBe(true);

    svc.stop();
    expect(svc.getStatus().running).toBe(false);
  });

  it("agent completes a full task lifecycle via ticks", async () => {
    taskStore.create({
      title: "Full lifecycle",
      description: "- Step 1",
      status: "ready",
      assigneeId: "worker",
      creatorId: "system",
      creatorName: "system",
    });

    const svc = makeService();
    svc.spawnAgent("worker");

    // Run ticks until the task is completed or we hit a safety limit
    const results = [];
    for (let i = 0; i < 10; i++) {
      const r = await svc.tickAgent("worker");
      results.push(r!);
      if (r!.decision.type === "idle" && results.some((prev) => prev.tasksCompleted > 0)) break;
    }

    // Verify the lifecycle happened: pick → work → complete → idle
    const types = results.map((r) => r.decision.type);
    expect(types[0]).toBe("pick_task");
    expect(types).toContain("continue_work");
    expect(types).toContain("complete_task");
    expect(types[types.length - 1]).toBe("idle");

    const totalCompleted = results.reduce((sum, r) => sum + r.tasksCompleted, 0);
    expect(totalCompleted).toBe(1);
  });

  it("posts system notifications on start and stop", () => {
    identityStore.getOrCreate("agent-1");
    const svc = makeService();
    svc.start();
    svc.stop();

    const systemChannel = commsStore.getChannelByName("system");
    expect(systemChannel).not.toBeNull();
    const messages = commsStore.getRecentMessages(systemChannel!.id, 50);
    const texts = messages.map((m) => m.text);
    expect(texts.some((t) => t.includes("started"))).toBe(true);
    expect(texts.some((t) => t.includes("stopped"))).toBe(true);
  });
});
