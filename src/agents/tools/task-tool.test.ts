import { describe, expect, it } from "vitest";
import { createTaskTool } from "./task-tool.js";

describe("createTaskTool", () => {
  it("returns a valid tool definition", () => {
    const tool = createTaskTool();
    expect(tool.name).toBe("tasks");
    expect(tool.description).toContain("kanban");
    expect(tool.schema).toBeDefined();
    expect(typeof tool.execute).toBe("function");
  });

  it("schema includes expected actions", () => {
    const tool = createTaskTool();
    const schema = tool.schema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    const actionSchema = properties.action as Record<string, unknown>;
    const actions = actionSchema.enum as string[];
    expect(actions).toContain("create");
    expect(actions).toContain("update");
    expect(actions).toContain("board");
    expect(actions).toContain("identity");
    expect(actions).toContain("my_tasks");
  });
});
