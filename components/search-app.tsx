"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { searchWikipedia, type SearchResult } from "@/lib/wikipedia";
import { JoyLogo } from "./joy-logo";
import { SearchResults } from "./search-results";

type SearchState =
  | { status: "idle" }
  | { status: "loading"; term: string }
  | { status: "success"; term: string; results: SearchResult[] }
  | { status: "error"; message: string };

export function SearchApp() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, []);

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    requestRef.current?.abort();
    requestRef.current = null;
    const term = query.trim().replace(/\s+/g, " ");
    inputRef.current?.focus();

    if (!term) {
      setSearch({ status: "idle" });
      return;
    }

    const request = new AbortController();
    requestRef.current = request;
    setSearch({ status: "loading", term });
    const timeout = window.setTimeout(() => {
      request.abort(new DOMException("Search timed out", "TimeoutError"));
    }, 15000);

    try {
      const results = await searchWikipedia(term, {
        signal: request.signal,
        width: window.innerWidth,
      });
      if (requestRef.current === request) {
        setSearch({ status: "success", term, results });
      }
    } catch (error) {
      if (requestRef.current === request) {
        setSearch({
          status: "error",
          message: request.signal.reason?.name === "TimeoutError"
            ? "Wikipedia took too long to respond. Please try again."
            : error instanceof Error
              ? error.message
              : "We couldn’t complete your search. Please try again.",
        });
      }
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === request) requestRef.current = null;
    }
  }

  function clearSearch() {
    requestRef.current?.abort();
    requestRef.current = null;
    setQuery("");
    setSearch({ status: "idle" });
    inputRef.current?.focus();
  }

  let statusMessage = "";
  if (search.status === "loading") statusMessage = `Searching Wikipedia for “${search.term}”…`;
  if (search.status === "success") {
    statusMessage = search.results.length
      ? `Displaying ${search.results.length} results`
      : `Sorry, no results for “${search.term}”. Try another search.`;
  }

  return (
    <>
      <section aria-labelledby="search-heading" className="flex w-full flex-col items-center pt-[40px]">
        <h2 id="search-heading" className="sr-only">Search Wikipedia</h2>
        <JoyLogo />
        <form
          role="search"
          aria-label="Wikipedia"
          onSubmit={submitSearch}
          className="flex w-[90vw] rounded-full border-2 border-search-border py-[0.15rem] pr-[0.25rem] pl-[0.75rem] hover:shadow-[0_2px_5px_2px_#e6e6e6] focus-within:border-joy-blue focus-within:shadow-[0_2px_5px_2px_#e6e6e6] md:w-[80vw] md:px-[1.5rem] md:py-[1.25rem] wide:w-[60vw]"
        >
          <label htmlFor="search" className="sr-only">Enter a search term or phrase</label>
          <input
            ref={inputRef}
            id="search"
            type="text"
            role="searchbox"
            autoComplete="off"
            enterKeyHint="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 grow border-0 bg-transparent text-left text-[0.75rem] tracking-[0.1rem] outline-none md:text-[1.25rem]"
          />
          {query.length > 0 ? (
            <button
              type="button"
              aria-label="Clear search terms"
              onClick={clearSearch}
              className="flex min-h-[48px] min-w-[48px] shrink-0 cursor-pointer items-center justify-center border-r border-[#d9d9d9] text-search-muted hover:text-joy-red focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-joy-blue md:px-[1rem]"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[1rem] md:size-[1.5rem]" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          ) : null}
          <button
            type="submit"
            aria-label="Search Wikipedia"
            className="flex min-h-[48px] min-w-[48px] shrink-0 cursor-pointer items-center justify-center text-joy-blue hover:text-joy-green focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-joy-blue md:pl-[1rem]"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[1rem] md:size-[1.5rem]" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 5 5" />
            </svg>
          </button>
        </form>
      </section>
      <section aria-labelledby="results-heading" className="flex w-[90vw] flex-col items-center px-[1rem] py-[0.5rem] md:w-[75vw] wide:w-[55vw]">
        <h2 id="results-heading" className="sr-only">Search results</h2>
        <p role="status" aria-live="polite" aria-atomic="true" className="w-full text-[0.75rem] text-search-muted md:text-[1rem]">
          {statusMessage}
        </p>
        {search.status === "error" ? (
          <p role="alert" className="w-full text-[0.75rem] text-joy-red md:text-[1rem]">{search.message}</p>
        ) : null}
        {search.status === "success" ? <SearchResults results={search.results} /> : null}
      </section>
    </>
  );
}
