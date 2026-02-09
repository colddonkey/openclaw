export type PollInput = {
  question: string;
  options: string[];
  maxSelections?: number;
  durationHours?: number;
};

export type NormalizedPollInput = {
  question: string;
  options: string[];
  maxSelections: number;
  durationHours?: number;
};

type NormalizePollOptions = {
  maxOptions?: number;
};

export function normalizePollInput(
  input: PollInput,
  options: NormalizePollOptions = {},
): NormalizedPollInput {
  const question = input.question.trim();
  if (!question) {
    throw new Error("Poll question is required. Provide a non-empty question string.");
  }
  const pollOptions = (input.options ?? []).map((option) => option.trim());
  const cleaned = pollOptions.filter(Boolean);
  if (cleaned.length < 2) {
    throw new Error(`Poll requires at least 2 options, but received ${cleaned.length}. Provide at least 2 non-empty option strings.`);
  }
  if (options.maxOptions !== undefined && cleaned.length > options.maxOptions) {
    throw new Error(`Poll supports at most ${options.maxOptions} options, but received ${cleaned.length}. Remove ${cleaned.length - options.maxOptions} option(s).`);
  }
  const maxSelectionsRaw = input.maxSelections;
  const maxSelections =
    typeof maxSelectionsRaw === "number" && Number.isFinite(maxSelectionsRaw)
      ? Math.floor(maxSelectionsRaw)
      : 1;
  if (maxSelections < 1) {
    throw new Error(`maxSelections must be at least 1, but received ${maxSelectionsRaw}. Set maxSelections to 1 or higher.`);
  }
  if (maxSelections > cleaned.length) {
    throw new Error(`maxSelections (${maxSelections}) cannot exceed the number of options (${cleaned.length}). Reduce maxSelections or add more options.`);
  }
  const durationRaw = input.durationHours;
  const durationHours =
    typeof durationRaw === "number" && Number.isFinite(durationRaw)
      ? Math.floor(durationRaw)
      : undefined;
  if (durationHours !== undefined && durationHours < 1) {
    throw new Error(`durationHours must be at least 1, but received ${durationRaw}. Set durationHours to 1 or higher, or omit it.`);
  }
  return {
    question,
    options: cleaned,
    maxSelections,
    durationHours,
  };
}

export function normalizePollDurationHours(
  value: number | undefined,
  options: { defaultHours: number; maxHours: number },
): number {
  const base =
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : options.defaultHours;
  return Math.min(Math.max(base, 1), options.maxHours);
}
