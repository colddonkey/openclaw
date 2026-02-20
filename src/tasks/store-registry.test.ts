import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/config.js", () => ({
  loadConfig: () => ({
    multiAgentOs: { enabled: true },
  }),
}));

vi.mock("../config/paths.js", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-reg-"));
  return { resolveStateDir: () => tmpDir };
});

let registry: typeof import("./store-registry.js");

beforeEach(async () => {
  registry = await import("./store-registry.js");
});

afterEach(() => {
  registry.resetSharedStores();
  vi.restoreAllMocks();
});

describe("store-registry singletons", () => {
  it("returns the same TaskStore instance on repeated calls", () => {
    const a = registry.getSharedTaskStore();
    const b = registry.getSharedTaskStore();
    expect(a).toBe(b);
  });

  it("returns the same IdentityStore instance on repeated calls", () => {
    const a = registry.getSharedIdentityStore();
    const b = registry.getSharedIdentityStore();
    expect(a).toBe(b);
  });

  it("returns the same CommsStore instance on repeated calls", () => {
    const a = registry.getSharedCommsStore();
    const b = registry.getSharedCommsStore();
    expect(a).toBe(b);
  });

  it("resetSharedStores clears singletons", () => {
    const before = registry.getSharedTaskStore();
    registry.resetSharedStores();
    const after = registry.getSharedTaskStore();
    expect(before).not.toBe(after);
  });
});
