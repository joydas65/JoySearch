// Verified against the live AI Gateway catalog on 2026-11-14.
export const DEFAULT_ANSWER_MODEL = "openai/gpt-4.1-mini";
export const DEFAULT_INTENT_MODEL = "openai/gpt-5-mini";
export const ANSWER_RESERVATION_MICROS = 10_000;
export const ANSWER_DEADLINE_MS = 15_000;
export const ANSWER_MAX_OUTPUT_TOKENS = 600;
export const ANSWER_MAX_INPUT_TOKENS = 4_000;
export const INTENT_MAX_OUTPUT_TOKENS = 300;
export const ANSWER_MAX_TOTAL_INPUT_TOKENS = 8_000;
export const ANSWER_MAX_TOTAL_OUTPUT_TOKENS = 900;
export const ANSWER_MAX_CALLS = 2;
export const ANSWER_MODEL_RATES = {
  "openai/gpt-4.1-mini": { input: 0.0000004, output: 0.0000016 },
  "openai/gpt-5-mini": { input: 0.00000025, output: 0.000002 },
} as const;

export function answerModelRate(model: string) {
  if (!Object.hasOwn(ANSWER_MODEL_RATES, model)) throw new Error("The answer model has not been budgeted.");
  return ANSWER_MODEL_RATES[model as keyof typeof ANSWER_MODEL_RATES];
}

export function answerModelSettings(model: string) {
  answerModelRate(model);
  return model === "openai/gpt-5-mini" ? { reasoning: "minimal" as const } : { temperature: 0 };
}
