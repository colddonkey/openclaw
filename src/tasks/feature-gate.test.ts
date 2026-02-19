import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.js";
import {
  isMultiAgentOsEnabled,
  isMultiAgentOsFeatureEnabled,
  resolveMultiAgentOsGate,
} from "./feature-gate.js";

describe("resolveMultiAgentOsGate", () => {
  it("returns all-disabled gate when multiAgentOs is absent", () => {
    const gate = resolveMultiAgentOsGate({});
    expect(gate.enabled).toBe(false);
    expect(gate.autoTasksEnabled).toBe(false);
    expect(gate.identityEnabled).toBe(false);
    expect(gate.telegramEnabled).toBe(false);
  });

  it("returns all-disabled gate when enabled is false", () => {
    const gate = resolveMultiAgentOsGate({ multiAgentOs: { enabled: false } });
    expect(gate.enabled).toBe(false);
    expect(gate.autoTasksEnabled).toBe(false);
  });

  it("returns all-enabled gate when enabled is true with defaults", () => {
    const gate = resolveMultiAgentOsGate({ multiAgentOs: { enabled: true } });
    expect(gate.enabled).toBe(true);
    expect(gate.autoTasksEnabled).toBe(true);
    expect(gate.autoTasksImplicit).toBe(true);
    expect(gate.identityEnabled).toBe(true);
    expect(gate.telegramEnabled).toBe(true);
    expect(gate.traitDecayRate).toBe(0.02);
    expect(gate.dbPath).toBeUndefined();
  });

  it("respects autoTasks.enabled = false", () => {
    const gate = resolveMultiAgentOsGate({
      multiAgentOs: { enabled: true, autoTasks: { enabled: false } },
    });
    expect(gate.enabled).toBe(true);
    expect(gate.autoTasksEnabled).toBe(false);
  });

  it("respects autoTasks.explicitOnly = true", () => {
    const gate = resolveMultiAgentOsGate({
      multiAgentOs: { enabled: true, autoTasks: { explicitOnly: true } },
    });
    expect(gate.autoTasksEnabled).toBe(true);
    expect(gate.autoTasksImplicit).toBe(false);
  });

  it("respects identity.enabled = false", () => {
    const gate = resolveMultiAgentOsGate({
      multiAgentOs: { enabled: true, identity: { enabled: false } },
    });
    expect(gate.identityEnabled).toBe(false);
  });

  it("respects custom traitDecayRate", () => {
    const gate = resolveMultiAgentOsGate({
      multiAgentOs: { enabled: true, identity: { traitDecayRate: 0.1 } },
    });
    expect(gate.traitDecayRate).toBe(0.1);
  });

  it("respects telegram.enabled = false", () => {
    const gate = resolveMultiAgentOsGate({
      multiAgentOs: { enabled: true, telegram: { enabled: false } },
    });
    expect(gate.telegramEnabled).toBe(false);
  });

  it("passes through dbPath", () => {
    const gate = resolveMultiAgentOsGate({
      multiAgentOs: { enabled: true, dbPath: "/custom/path.sqlite" },
    });
    expect(gate.dbPath).toBe("/custom/path.sqlite");
  });
});

describe("isMultiAgentOsEnabled", () => {
  it("returns false for empty config", () => {
    expect(isMultiAgentOsEnabled({})).toBe(false);
  });

  it("returns true when enabled", () => {
    expect(isMultiAgentOsEnabled({ multiAgentOs: { enabled: true } })).toBe(true);
  });

  it("returns false when explicitly disabled", () => {
    expect(isMultiAgentOsEnabled({ multiAgentOs: { enabled: false } })).toBe(false);
  });
});

describe("isMultiAgentOsFeatureEnabled", () => {
  const enabled: OpenClawConfig = { multiAgentOs: { enabled: true } };
  const disabled: OpenClawConfig = { multiAgentOs: { enabled: false } };

  it("returns false when master toggle is off", () => {
    expect(isMultiAgentOsFeatureEnabled(disabled, "autoTasks")).toBe(false);
    expect(isMultiAgentOsFeatureEnabled(disabled, "identity")).toBe(false);
    expect(isMultiAgentOsFeatureEnabled(disabled, "telegram")).toBe(false);
  });

  it("returns true for sub-features by default when master is on", () => {
    expect(isMultiAgentOsFeatureEnabled(enabled, "autoTasks")).toBe(true);
    expect(isMultiAgentOsFeatureEnabled(enabled, "identity")).toBe(true);
    expect(isMultiAgentOsFeatureEnabled(enabled, "telegram")).toBe(true);
  });

  it("respects individual sub-feature toggles", () => {
    const cfg: OpenClawConfig = {
      multiAgentOs: { enabled: true, autoTasks: { enabled: false } },
    };
    expect(isMultiAgentOsFeatureEnabled(cfg, "autoTasks")).toBe(false);
    expect(isMultiAgentOsFeatureEnabled(cfg, "identity")).toBe(true);
  });
});
