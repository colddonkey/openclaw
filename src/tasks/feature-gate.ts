/**
 * Feature gate for multi-agent OS capabilities.
 *
 * All multi-agent OS features check this gate before activating.
 * The gate reads from OpenClawConfig.multiAgentOs and provides
 * fine-grained toggles for each subsystem.
 */

import type { OpenClawConfig } from "../config/types.js";
import type { MultiAgentOsConfig } from "../config/types.multi-agent-os.js";

export type MultiAgentOsGate = {
  /** Master toggle — is the multi-agent OS enabled at all? */
  enabled: boolean;
  /** Should we extract tasks from conversation messages? */
  autoTasksEnabled: boolean;
  /** Should implicit patterns (commitments, requests) be extracted? */
  autoTasksImplicit: boolean;
  /** Should the agent identity system track traits/skills/stats? */
  identityEnabled: boolean;
  /** Trait decay rate per day (0.0-1.0). */
  traitDecayRate: number;
  /** Should Telegram kanban commands be registered? */
  telegramEnabled: boolean;
  /** Should the agent communication board be active? */
  commsEnabled: boolean;
  /** Should agent messages be forwarded to Telegram? */
  commsTelegramForward: boolean;
  /** Should the automatic task scheduler be active? */
  schedulerEnabled: boolean;
  /** SQLite database path override (undefined = use default). */
  dbPath: string | undefined;
};

const DEFAULT_TRAIT_DECAY_RATE = 0.02;

/**
 * Resolve the feature gate from config.
 * Returns a fully-resolved gate object with all defaults applied.
 */
export function resolveMultiAgentOsGate(cfg: OpenClawConfig): MultiAgentOsGate {
  const os = cfg.multiAgentOs;
  const enabled = os?.enabled === true;

  if (!enabled) {
    return {
      enabled: false,
      autoTasksEnabled: false,
      autoTasksImplicit: false,
      identityEnabled: false,
      traitDecayRate: DEFAULT_TRAIT_DECAY_RATE,
      telegramEnabled: false,
      commsEnabled: false,
      commsTelegramForward: false,
      schedulerEnabled: false,
      dbPath: undefined,
    };
  }

  return {
    enabled: true,
    autoTasksEnabled: os?.autoTasks?.enabled !== false,
    autoTasksImplicit: os?.autoTasks?.explicitOnly !== true,
    identityEnabled: os?.identity?.enabled !== false,
    traitDecayRate: os?.identity?.traitDecayRate ?? DEFAULT_TRAIT_DECAY_RATE,
    telegramEnabled: os?.telegram?.enabled !== false,
    commsEnabled: os?.comms?.enabled !== false,
    commsTelegramForward: os?.comms?.telegramForward === true,
    schedulerEnabled: os?.scheduler?.enabled !== false,
    dbPath: os?.dbPath,
  };
}

/**
 * Quick check: is the multi-agent OS enabled in this config?
 */
export function isMultiAgentOsEnabled(cfg: OpenClawConfig): boolean {
  return cfg.multiAgentOs?.enabled === true;
}

/**
 * Check if a specific sub-feature is enabled.
 */
export function isMultiAgentOsFeatureEnabled(
  cfg: OpenClawConfig,
  feature: keyof Omit<MultiAgentOsConfig, "enabled" | "dbPath">,
): boolean {
  if (!isMultiAgentOsEnabled(cfg)) return false;
  const sub = cfg.multiAgentOs?.[feature];
  if (typeof sub === "object" && sub !== null && "enabled" in sub) {
    return (sub as { enabled?: boolean }).enabled !== false;
  }
  return true;
}
