// Single source of truth for canonical Anthropic model identifiers.
// When a new model version is released, update ONLY this file.
// All runtime code imports from here; bump versions in one place.

export const PROVIDER_ANTHROPIC = "anthropic";

// --- Opus (current) ---
export const OPUS_MODEL_ID = "claude-opus-4-6";
export const OPUS_DISPLAY_NAME = "Claude Opus 4.6";
export const OPUS_REF = `${PROVIDER_ANTHROPIC}/${OPUS_MODEL_ID}`;

// --- Sonnet (current) ---
export const SONNET_MODEL_ID = "claude-sonnet-4-6";
export const SONNET_DISPLAY_NAME = "Claude Sonnet 4.6";
export const SONNET_REF = `${PROVIDER_ANTHROPIC}/${SONNET_MODEL_ID}`;

// --- Haiku (current) ---
export const HAIKU_MODEL_ID = "claude-haiku-4-5";
export const HAIKU_DISPLAY_NAME = "Claude Haiku 4.5";
export const HAIKU_REF = `${PROVIDER_ANTHROPIC}/${HAIKU_MODEL_ID}`;

// Previous-generation IDs kept for backward compatibility mappings.
// These let existing configs/sessions that reference old model IDs continue working.
export const OPUS_PREV_MODEL_ID = "claude-opus-4-5";
export const SONNET_PREV_MODEL_ID = "claude-sonnet-4-5";
export const OPUS_PREV_REF = `${PROVIDER_ANTHROPIC}/${OPUS_PREV_MODEL_ID}`;
export const SONNET_PREV_REF = `${PROVIDER_ANTHROPIC}/${SONNET_PREV_MODEL_ID}`;

// Standard set of Anthropic models available via OAuth (used by gateway auth, allowlists).
export const ANTHROPIC_OAUTH_MODEL_REFS = [OPUS_REF, OPUS_PREV_REF, SONNET_REF, HAIKU_REF] as const;
