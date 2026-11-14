import type { WebSearchResult } from "@/lib/search/types";

export function SearchResults({ results }: { results: WebSearchResult[] }) {
  return (
    <ul className="w-full list-none">
      {results.map((result) => (
        <li key={result.id} className="w-full py-[0.75rem] md:py-[1rem]">
          <article>
            <p className="mb-1 truncate text-xs text-search-muted md:text-sm">
              {new URL(result.url).hostname}
              {result.publishedAt ? (
                <> · <time dateTime={result.publishedAt}>{result.publishedAt.slice(0, 10)}</time></>
              ) : null}
            </p>
            <h3 className="mb-[0.25rem] break-words px-[2px] py-[3px] text-[1rem] leading-[1.5rem] font-normal md:mb-[0.5rem] md:text-[1.5rem] md:leading-[1.75rem]">
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-result-link visited:text-result-visited hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
              >
                {result.title}
              </a>
            </h3>
            <p className="line-clamp-3 break-words text-[14px] leading-[20px] md:text-[1rem] md:leading-[28px]">
              {result.excerpt}
            </p>
          </article>
        </li>
      ))}
    </ul>
  );
}
