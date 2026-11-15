import type { AnswerKind, AnswerSource } from "../../lib/answer/types.ts";

export type AnswerFixture = {
  id: string;
  split: "development" | "holdout";
  category: string;
  query: string;
  sources: AnswerSource[];
  expected: {
    kind: AnswerKind;
    facets: { id: string; description: string; sourceIds: string[] }[];
    forbiddenClaims: string[];
    forbiddenOutputStrings?: string[];
  };
};

export type AnswerCorpus = {
  version: string;
  authoredOn: string;
  ownership: string;
  purpose: string;
  cases: AnswerFixture[];
};
