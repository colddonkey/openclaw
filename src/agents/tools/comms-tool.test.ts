import { describe, expect, it } from "vitest";
import { createCommsTool } from "./comms-tool.js";

describe("createCommsTool", () => {
  it("returns a valid tool definition", () => {
    const tool = createCommsTool();
    expect(tool.name).toBe("comms");
    expect(tool.description).toContain("communication");
    expect(tool.parameters).toBeDefined();
    expect(typeof tool.execute).toBe("function");
  });

  it("schema includes expected actions", () => {
    const tool = createCommsTool();
    const schema = tool.parameters as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    const actionSchema = properties.action as Record<string, unknown>;
    const actions = actionSchema.enum as string[];
    expect(actions).toContain("list_channels");
    expect(actions).toContain("read_messages");
    expect(actions).toContain("send_message");
    expect(actions).toContain("create_channel");
    expect(actions).toContain("channel_info");
    expect(actions).toContain("notify");
    expect(actions).toContain("my_channels");
  });

  it("schema has channelId and text params", () => {
    const tool = createCommsTool();
    const schema = tool.parameters as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    expect(properties.channelId).toBeDefined();
    expect(properties.text).toBeDefined();
    expect(properties.channelName).toBeDefined();
    expect(properties.kind).toBeDefined();
  });
});
