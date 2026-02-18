import type { OpenClawConfig } from "../config/config.js";
import { OPUS_MODEL_ID, OPUS_PREV_MODEL_ID } from "../agents/model-identity.js";
import { applyAgentDefaultPrimaryModel } from "./model-default.js";

export const OPENCODE_ZEN_DEFAULT_MODEL = `opencode/${OPUS_MODEL_ID}`;
const LEGACY_OPENCODE_ZEN_DEFAULT_MODELS = new Set([
  `opencode/${OPUS_PREV_MODEL_ID}`,
  `opencode-zen/${OPUS_PREV_MODEL_ID}`,
]);

export function applyOpencodeZenModelDefault(cfg: OpenClawConfig): {
  next: OpenClawConfig;
  changed: boolean;
} {
  return applyAgentDefaultPrimaryModel({
    cfg,
    model: OPENCODE_ZEN_DEFAULT_MODEL,
    legacyModels: LEGACY_OPENCODE_ZEN_DEFAULT_MODELS,
  });
}
