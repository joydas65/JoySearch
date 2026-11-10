import Image from "next/image";
import type { SearchResult } from "@/lib/wikipedia";

export function SearchResults({ results }: { results: SearchResult[] }) {
  return (
    <ul className="w-full list-none">
      {results.map((result) => (
        <li key={result.id} className="w-full py-[0.25rem] md:py-[0.5rem]">
          <article>
            <h3 className="mb-[0.25rem] truncate px-[2px] py-[3px] text-[1rem] leading-[1.5rem] font-normal md:mb-[0.5rem] md:text-[1.5rem] md:leading-[1.75rem]">
              <a
                href={`https://en.wikipedia.org/?curid=${result.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-result-link visited:text-result-visited hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
              >
                {result.title}
              </a>
            </h3>
            <div className="flex w-full items-start">
              {result.thumbnail ? (
                <Image
                  src={result.thumbnail.src}
                  width={result.thumbnail.width}
                  height={result.thumbnail.height}
                  alt=""
                  className="mr-[0.5rem] h-auto max-h-[80px] w-auto max-w-[80px] shrink-0 object-contain"
                />
              ) : null}
              <p className="max-h-[60px] min-w-0 grow overflow-hidden text-[14px] leading-[20px] text-ellipsis md:text-[1rem] md:leading-[28px]">
                {result.excerpt}
              </p>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
