export type SearchProvider = "exa" | "brave";

export type WebSearchResult = {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  publishedAt?: string;
};

export type SearchResponse = {
  provider: SearchProvider;
  results: WebSearchResult[];
  answerContext?: string;
};

export type ProviderResponse = SearchResponse & {
  requestId?: string;
  reportedCostUsd?: number;
};
