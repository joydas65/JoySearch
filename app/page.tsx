import { SearchApp } from "@/components/search-app";

export default function Home() {
  return (
    <>
      <main className="flex min-h-[calc(100dvh-60px)] flex-col items-center">
        <h1 className="sr-only">JoySearch — a Wikipedia powered search engine</h1>
        <SearchApp />
        <noscript>
          <p className="mt-4 px-4 text-center text-sm text-search-muted">
            Enable JavaScript to search Wikipedia with JoySearch.
          </p>
        </noscript>
      </main>
      <footer className="flex min-h-[60px] items-center justify-center px-4 text-center text-[0.5rem] text-search-muted md:text-[1rem]">
        <p>
          <span aria-hidden="true">&lt;&lt; </span>
          Powered by{" "}
          <a
            href="https://www.wikipedia.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-joy-blue"
          >
            Wikipedia
          </a>
          <span aria-hidden="true"> &gt;&gt;</span>
        </p>
      </footer>
    </>
  );
}
