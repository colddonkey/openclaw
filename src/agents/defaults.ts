import { OPUS_MODEL_ID, PROVIDER_ANTHROPIC } from "./model-identity.js";

// Defaults for agent metadata when upstream does not supply them.
// Model id uses pi-ai's built-in Anthropic catalog.
export const DEFAULT_PROVIDER = PROVIDER_ANTHROPIC;
export const DEFAULT_MODEL = OPUS_MODEL_ID;
// Conservative fallback used when model metadata is unavailable.
export const DEFAULT_CONTEXT_TOKENS = 200_000;
