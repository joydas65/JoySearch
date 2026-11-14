export type AnswerSource = { id: string; title: string; url: string; excerpt: string };
export type AnswerClaim = { text: string; sourceIds: string[] };
export type AnswerKind = "answer" | "navigation" | "clarify" | "insufficient";
export type AnswerContentEvent =
  | { type: "claim"; claim: AnswerClaim }
  | { type: "done"; kind: AnswerKind; message?: string };
export type AnswerEvent =
  | { type: "start"; requestId: string; sources: AnswerSource[] }
  | AnswerContentEvent
  | { type: "error"; message: string; code: string; requestId: string };
export type AnswerUsage = { inputTokens: number; outputTokens: number; totalTokens: number; reasoningTokens?: number };
export type AnswerMetering = { callCount: number; providerRequestIds: string[]; usage: AnswerUsage; usageComplete: boolean };
export type AnswerStageUsage = { stage: "intent" | "answer"; model: string; usage: AnswerUsage; requestId?: string };
export type AnswerGeneration = {
  kind: AnswerKind;
  claims: AnswerClaim[];
  message?: string;
  usage: AnswerUsage;
  requestId?: string;
  reportedCostUsd?: number;
  callCount?: number;
  providerRequestIds?: string[];
  stageUsage?: AnswerStageUsage[];
};
