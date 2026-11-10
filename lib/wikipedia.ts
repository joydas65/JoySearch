export type SearchResult = {
  id: number;
  title: string;
  excerpt: string;
  thumbnail?: {
    src: string;
    width: number;
    height: number;
  };
};

type SearchOptions = {
  signal?: AbortSignal;
  width?: number;
};

const RESPONSE_ERROR = "Wikipedia returned an unexpected response. Please try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResults(data: unknown): SearchResult[] {
  if (!isRecord(data)) throw new Error(RESPONSE_ERROR);
  if (data.error || data.errors) {
    throw new Error("Wikipedia could not complete this search. Please try again.");
  }

  // A generator search with no matches has no query property.
  if (!("query" in data) && (data.batchcomplete === true || data.batchcomplete === "")) return [];
  if (!isRecord(data.query) || !Array.isArray(data.query.pages)) {
    throw new Error(RESPONSE_ERROR);
  }

  return data.query.pages
    .map((page: unknown, position: number) => {
      if (
        !isRecord(page) ||
        typeof page.pageid !== "number" ||
        !Number.isSafeInteger(page.pageid) ||
        page.pageid <= 0 ||
        typeof page.title !== "string" ||
        !page.title.trim() ||
        (page.extract !== undefined && typeof page.extract !== "string")
      ) {
        throw new Error(RESPONSE_ERROR);
      }

      const result: SearchResult = {
        id: page.pageid,
        title: page.title,
        excerpt: typeof page.extract === "string" ? page.extract : "",
      };
      const thumbnail = page.thumbnail;
      if (
        isRecord(thumbnail) &&
        typeof thumbnail.source === "string" &&
        thumbnail.source.startsWith("https://") &&
        typeof thumbnail.width === "number" &&
        Number.isFinite(thumbnail.width) &&
        thumbnail.width > 0 &&
        typeof thumbnail.height === "number" &&
        Number.isFinite(thumbnail.height) &&
        thumbnail.height > 0
      ) {
        result.thumbnail = {
          src: thumbnail.source,
          width: thumbnail.width,
          height: thumbnail.height,
        };
      }

      return {
        result,
        position,
        rank:
          typeof page.index === "number" && Number.isFinite(page.index)
            ? page.index
            : Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((left, right) => left.rank - right.rank || left.position - right.position)
    .map(({ result }) => result);
}

export async function searchWikipedia(
  term: string,
  { signal, width = 1024 }: SearchOptions = {},
): Promise<SearchResult[]> {
  const query = term.trim().replace(/\s+/g, " ");
  if (!query) return [];

  const parameters = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrlimit: "20",
    prop: "pageimages|extracts",
    piprop: "thumbnail",
    pithumbsize: "80",
    exchars: String(width < 414 ? 65 : width < 1400 ? 100 : 130),
    exintro: "1",
    explaintext: "1",
    exlimit: "max",
    format: "json",
    formatversion: "2",
    origin: "*",
  });

  let response: Response;
  try {
    response = await fetch(`https://en.wikipedia.org/w/api.php?${parameters}`, {
      signal,
    });
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError"))
    ) {
      throw error;
    }
    throw new Error("Could not reach Wikipedia. Check your connection and try again.");
  }

  if (!response.ok) {
    throw new Error("Wikipedia is unavailable right now. Please try again shortly.");
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(RESPONSE_ERROR);
  }

  return parseResults(data);
}
