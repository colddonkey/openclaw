import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLlmExecutor } from "./llm-executor.js";

vi.mock("../agents/tools/agent-step.js", () => ({
  runAgentStep: vi.fn(),
}));

import { runAgentStep } from "../agents/tools/agent-step.js";
const mockRunAgentStep = vi.mocked(runAgentStep);

describe("createLlmExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("returns a WorkExecutor function", () => {
    const executor = createLlmExecutor();
    expect(typeof executor).toBe("function");
  });

  it("calls runAgentStep with correct session key", async () => {
    mockRunAgentStep.mockResolvedValueOnce("I completed the step successfully.");
    const executor = createLlmExecutor();

    const result = await executor({
      agentId: "agent-1",
      taskId: "task-123",
      stepDescription: "Fix the validation bug",
      stepIndex: 0,
      totalSteps: 3,
    });

    expect(mockRunAgentStep).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:agent-1:autonomy",
        lane: "autonomy",
        sourceTool: "autonomy-executor",
      }),
    );
    expect(result.output).toBe("I completed the step successfully.");
    expect(result.success).toBe(true);
  });

  it("builds message with step context", async () => {
    mockRunAgentStep.mockResolvedValueOnce("Done.");
    const executor = createLlmExecutor();

    await executor({
      agentId: "a1",
      taskId: "t1",
      stepDescription: "Add unit tests",
      stepIndex: 2,
      totalSteps: 5,
    });

    const call = mockRunAgentStep.mock.calls[0][0];
    expect(call.message).toContain("Step 3/5");
    expect(call.message).toContain("Add unit tests");
    expect(call.message).toContain("t1");
  });

  it("returns failure when agent returns null (timeout)", async () => {
    mockRunAgentStep.mockResolvedValueOnce(undefined);
    const executor = createLlmExecutor();

    const result = await executor({
      agentId: "a1",
      taskId: "t1",
      stepDescription: "Do something",
      stepIndex: 0,
      totalSteps: 1,
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain("timeout");
  });

  it("detects failure when response starts with a weak error signal", async () => {
    mockRunAgentStep.mockResolvedValueOnce("I cannot complete this step due to missing dependencies.");
    const executor = createLlmExecutor();

    const result = await executor({
      agentId: "a1",
      taskId: "t1",
      stepDescription: "Edit missing file",
      stepIndex: 0,
      totalSteps: 1,
    });

    expect(result.success).toBe(false);
  });

  it("detects failure on strong signals anywhere in response", async () => {
    mockRunAgentStep.mockResolvedValueOnce("I tried everything but got: permission denied when writing the output");
    const executor = createLlmExecutor();

    const result = await executor({
      agentId: "a1",
      taskId: "t1",
      stepDescription: "Write output",
      stepIndex: 0,
      totalSteps: 1,
    });

    expect(result.success).toBe(false);
  });

  it("does NOT false-positive on 'not found' in a success report", async () => {
    mockRunAgentStep.mockResolvedValueOnce(
      "I completed the migration. The old config file was not found so I created a new one from the template.",
    );
    const executor = createLlmExecutor();

    const result = await executor({
      agentId: "a1",
      taskId: "t1",
      stepDescription: "Migrate config",
      stepIndex: 0,
      totalSteps: 1,
    });

    expect(result.success).toBe(true);
  });

  it("detects failure on very short/empty responses", async () => {
    mockRunAgentStep.mockResolvedValueOnce("  ");
    const executor = createLlmExecutor();

    const result = await executor({
      agentId: "a1",
      taskId: "t1",
      stepDescription: "Do something",
      stepIndex: 0,
      totalSteps: 1,
    });

    expect(result.success).toBe(false);
  });

  it("returns failure on exception", async () => {
    mockRunAgentStep.mockRejectedValueOnce(new Error("Network error"));
    const executor = createLlmExecutor();

    const result = await executor({
      agentId: "a1",
      taskId: "t1",
      stepDescription: "Do something",
      stepIndex: 0,
      totalSteps: 1,
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain("Network error");
  });

  it("uses custom system prompt when provided", async () => {
    mockRunAgentStep.mockResolvedValueOnce("Done.");
    const executor = createLlmExecutor({
      extraSystemPrompt: "You are a testing specialist.",
    });

    await executor({
      agentId: "a1",
      taskId: "t1",
      stepDescription: "Write tests",
      stepIndex: 0,
      totalSteps: 1,
    });

    const call = mockRunAgentStep.mock.calls[0][0];
    expect(call.extraSystemPrompt).toContain("testing specialist");
    expect(call.extraSystemPrompt).toContain("autonomous agent");
  });

  it("uses custom timeout", async () => {
    mockRunAgentStep.mockResolvedValueOnce("Done.");
    const executor = createLlmExecutor({ stepTimeoutMs: 30_000 });

    await executor({
      agentId: "a1",
      taskId: "t1",
      stepDescription: "Quick fix",
      stepIndex: 0,
      totalSteps: 1,
    });

    const call = mockRunAgentStep.mock.calls[0][0];
    expect(call.timeoutMs).toBe(30_000);
  });
});
