/**
 * Pattern-based task extraction from conversation text.
 *
 * Two confidence tiers:
 *   - explicit: clearly marked tasks (TODO, FIXME, "Action item:") → ready
 *   - implicit: natural-language commitments ("need to", "should") → backlog
 *
 * No LLM call — runs on every message at zero token cost.
 * Deduplication via normalized fingerprints against recent tasks.
 */

import type { TaskCreateInput, TaskPriority } from "./types.js";

export type ExtractedTask = {
  title: string;
  confidence: "explicit" | "implicit";
  priority: TaskPriority;
  labels: string[];
  /** The raw line/sentence that triggered extraction. */
  sourceText: string;
};

export type ExtractionContext = {
  /** Who sent the message ("user" or agent ID). */
  senderId: string;
  senderName: string;
  /** Channel the message came from. */
  channelId?: string;
  /** Session key for linking. */
  sessionKey?: string;
  /** Conversation/chat ID. */
  conversationId?: string;
};

export type ExtractionResult = {
  tasks: ExtractedTask[];
  /** Fingerprints of extracted tasks for dedup. */
  fingerprints: string[];
};

// ── Explicit patterns (high confidence) ────────────────────────────

const EXPLICIT_PREFIX_RE =
  /^[\s*\-•]*(?:TODO|FIXME|HACK|XXX|BUG|NOTE)\s*[:\-]\s*(.+)/i;

const EXPLICIT_LABEL_RE =
  /^[\s*\-•]*(?:(?:action\s+item|task|ticket|issue|work\s+item)\s*[:\-])\s*(.+)/i;

const NEXT_STEPS_HEADER_RE = /^[\s*]*(?:next\s+steps?|remaining\s+work|follow[\s-]?ups?)\s*:/i;

// ── Implicit patterns (medium confidence) ──────────────────────────

type ImplicitPattern = {
  re: RegExp;
  /** Group index that captures the action text. */
  group: number;
};

const IMPLICIT_PATTERNS: ImplicitPattern[] = [
  // "I need to fix the auth flow"
  { re: /\b(?:i|we)\s+need\s+to\s+(.{8,120})/i, group: 1 },
  // "I have to update the docs"
  { re: /\b(?:i|we)\s+have\s+to\s+(.{8,120})/i, group: 1 },
  // "I must remember to..."
  { re: /\b(?:i|we)\s+must\s+(.{8,120})/i, group: 1 },
  // "Remember to deploy before Friday"
  { re: /\bremember\s+to\s+(.{8,120})/i, group: 1 },
  // "Don't forget to run tests"
  { re: /\bdon['']?t\s+forget\s+to\s+(.{8,120})/i, group: 1 },
  // "Make sure to update the version"
  { re: /\bmake\s+sure\s+(?:to\s+)?(.{8,120})/i, group: 1 },
  // "We should refactor the store"
  { re: /\bwe\s+should\s+(?:probably\s+)?(.{8,120})/i, group: 1 },
  // "Let's add error handling"
  { re: /\blet['']?s\s+(.{8,120})/i, group: 1 },
  // "I'll look into the memory leak"
  { re: /\bi['']?ll\s+(?:go\s+ahead\s+and\s+|try\s+to\s+)?(.{8,120})/i, group: 1 },
  // "I will implement the feature"
  { re: /\bi\s+will\s+(?:go\s+ahead\s+and\s+)?(.{8,120})/i, group: 1 },
  // "Can you fix the login page" (from user messages)
  { re: /\bcan\s+you\s+(?:please\s+)?(.{8,120})/i, group: 1 },
  // "Could you add tests"
  { re: /\bcould\s+you\s+(?:please\s+)?(.{8,120})/i, group: 1 },
  // "Please implement X"
  { re: /\bplease\s+(.{8,120})/i, group: 1 },
];

// ── Priority heuristics ────────────────────────────────────────────

const CRITICAL_RE = /\b(?:urgent|critical|asap|immediately|breaking|crash|security\s+vuln)/i;
const HIGH_RE = /\b(?:important|high\s+priority|blocker|must\s+fix|regression)/i;
const LOW_RE = /\b(?:nice\s+to\s+have|low\s+priority|someday|eventually|minor|trivial)/i;

function inferPriority(text: string): TaskPriority {
  if (CRITICAL_RE.test(text)) return "critical";
  if (HIGH_RE.test(text)) return "high";
  if (LOW_RE.test(text)) return "low";
  return "medium";
}

// ── Label heuristics ───────────────────────────────────────────────

const LABEL_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(?:test|spec|coverage)\b/i, label: "testing" },
  { re: /\b(?:doc|docs|documentation|readme)\b/i, label: "docs" },
  { re: /\b(?:bug|fix|broken|crash|error)\b/i, label: "bug" },
  { re: /\b(?:refactor|clean\s*up|simplify)\b/i, label: "refactor" },
  { re: /\b(?:feature|implement|add|new)\b/i, label: "feature" },
  { re: /\b(?:deploy|release|publish|ship)\b/i, label: "ops" },
  { re: /\b(?:perf|performance|optimize|slow)\b/i, label: "performance" },
  { re: /\b(?:ui|ux|design|layout|style|css)\b/i, label: "ui" },
  { re: /\b(?:security|auth|permission|token)\b/i, label: "security" },
];

function inferLabels(text: string): string[] {
  const labels: string[] = [];
  for (const { re, label } of LABEL_PATTERNS) {
    if (re.test(text)) {
      labels.push(label);
    }
  }
  return labels;
}

// ── Deduplication ──────────────────────────────────────────────────

/** Normalize text for fingerprinting: lowercase, collapse whitespace, strip punctuation. */
export function fingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Text cleaning ──────────────────────────────────────────────────

const TRAILING_JUNK_RE = /[.!?,;:\s]+$/;
const LEADING_JUNK_RE = /^[*\-•\s]+/;

function cleanTitle(raw: string): string {
  let s = raw.replace(LEADING_JUNK_RE, "").replace(TRAILING_JUNK_RE, "").trim();
  if (s.length > 120) {
    s = `${s.slice(0, 117)}...`;
  }
  // Capitalize first letter
  if (s.length > 0) {
    s = s[0]!.toUpperCase() + s.slice(1);
  }
  return s;
}

// ── Minimum quality gates ──────────────────────────────────────────

const MIN_TITLE_LENGTH = 8;
const MAX_TITLE_LENGTH = 200;

const NOISE_RE =
  /^(?:ok|okay|sure|yes|no|yeah|nah|thanks|thank you|got it|sounds good|cool|nice|great|hello|hi|hey|bye|goodbye|lol|haha|hmm|ah|oh|right|alright)$/i;

function isValidTitle(title: string): boolean {
  if (title.length < MIN_TITLE_LENGTH || title.length > MAX_TITLE_LENGTH) return false;
  if (NOISE_RE.test(title.trim())) return false;
  // Must contain at least one verb-like word (rough heuristic)
  if (!/\b[a-z]{3,}\b/i.test(title)) return false;
  return true;
}

// ── Main extractor ─────────────────────────────────────────────────

/**
 * Extract tasks from a single message's text content.
 * Returns deduplicated list of extracted tasks with fingerprints.
 */
export function extractTasksFromText(
  text: string,
  existingFingerprints?: Set<string>,
): ExtractionResult {
  const tasks: ExtractedTask[] = [];
  const fingerprints: string[] = [];
  const seen = new Set(existingFingerprints ?? []);

  const lines = text.split(/\n/);
  let inNextStepsBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) {
      inNextStepsBlock = false;
      continue;
    }

    // Check if this line starts a "Next steps:" block
    if (NEXT_STEPS_HEADER_RE.test(line)) {
      inNextStepsBlock = true;
      // The header line itself might have content after the colon
      const afterColon = line.replace(NEXT_STEPS_HEADER_RE, "").trim();
      if (afterColon) {
        const task = tryCreateNextStepTask(afterColon, line, seen);
        if (task) {
          tasks.push(task);
          fingerprints.push(fingerprint(task.title));
        }
      }
      continue;
    }

    // Lines inside a "Next steps" block are treated as explicit tasks
    if (inNextStepsBlock && /^[\s*\-•\d.)]+/.test(line)) {
      const cleaned = line.replace(/^[\s*\-•\d.)]+/, "").trim();
      if (cleaned) {
        const task = tryCreateNextStepTask(cleaned, line, seen);
        if (task) {
          tasks.push(task);
          fingerprints.push(fingerprint(task.title));
        }
      }
      continue;
    }
    // Exit "next steps" block when we hit a non-list line
    if (inNextStepsBlock && !/^[\s*\-•\d.)]+/.test(line)) {
      inNextStepsBlock = false;
    }

    // Try explicit patterns first
    const explicit = tryExtractExplicit(line, line, seen);
    if (explicit) {
      tasks.push(explicit);
      fingerprints.push(fingerprint(explicit.title));
      continue;
    }

    // Try implicit patterns
    const implicit = tryExtractImplicit(line, seen);
    if (implicit) {
      tasks.push(implicit);
      fingerprints.push(fingerprint(implicit.title));
    }
  }

  return { tasks, fingerprints };
}

/** Items inside "Next steps:" blocks — no prefix required. */
function tryCreateNextStepTask(
  text: string,
  sourceLine: string,
  seen: Set<string>,
): ExtractedTask | null {
  const title = cleanTitle(text);
  if (!isValidTitle(title)) return null;

  const fp = fingerprint(title);
  if (seen.has(fp)) return null;
  seen.add(fp);

  return {
    title,
    confidence: "explicit",
    priority: inferPriority(sourceLine),
    labels: ["auto-generated", ...inferLabels(sourceLine)],
    sourceText: sourceLine,
  };
}

function tryExtractExplicit(
  text: string,
  sourceLine: string,
  seen: Set<string>,
): ExtractedTask | null {
  let match = EXPLICIT_PREFIX_RE.exec(text);
  if (!match) match = EXPLICIT_LABEL_RE.exec(text);
  if (!match) return null;

  const raw = match[1]!;
  const title = cleanTitle(raw);
  if (!isValidTitle(title)) return null;

  const fp = fingerprint(title);
  if (seen.has(fp)) return null;
  seen.add(fp);

  return {
    title,
    confidence: "explicit",
    priority: inferPriority(sourceLine),
    labels: ["auto-generated", ...inferLabels(sourceLine)],
    sourceText: sourceLine,
  };
}

function tryExtractImplicit(line: string, seen: Set<string>): ExtractedTask | null {
  for (const { re, group } of IMPLICIT_PATTERNS) {
    const m = re.exec(line);
    if (!m?.[group]) continue;

    const raw = m[group]!;
    // Trim at sentence boundary
    const sentenceEnd = raw.search(/[.!?]\s|$/);
    const trimmed = sentenceEnd > 0 ? raw.slice(0, sentenceEnd) : raw;
    const title = cleanTitle(trimmed);

    if (!isValidTitle(title)) continue;

    const fp = fingerprint(title);
    if (seen.has(fp)) continue;
    seen.add(fp);

    return {
      title,
      confidence: "implicit",
      priority: inferPriority(line),
      labels: ["auto-generated", ...inferLabels(line)],
      sourceText: line,
    };
  }
  return null;
}

// ── Convert to TaskCreateInput ─────────────────────────────────────

/**
 * Convert extracted tasks into TaskCreateInput objects ready for the store.
 */
export function toTaskCreateInputs(
  extracted: ExtractedTask[],
  ctx: ExtractionContext,
): TaskCreateInput[] {
  return extracted.map((t) => ({
    title: t.title,
    description: `Auto-extracted from conversation.\n\nSource: "${t.sourceText}"`,
    status: t.confidence === "explicit" ? "ready" : "backlog",
    priority: t.priority,
    creatorId: ctx.senderId,
    creatorName: ctx.senderName,
    labels: t.labels,
    sessionKey: ctx.sessionKey,
    source: "conversation",
    metadata: {
      extractionConfidence: t.confidence,
      channelId: ctx.channelId,
      conversationId: ctx.conversationId,
    },
  }));
}
