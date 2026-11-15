import { SearchApp } from "@/components/search-app";
import Link from "next/link";

export default function Home() {
  return (
    <>
      <main className="flex min-h-[calc(100dvh-60px)] flex-col items-center">
        <h1 className="sr-only">JoySearch — search the web</h1>
        <p className="mt-5 px-5 text-center text-sm text-search-muted">
          Explore without live requests:{" "}
          <Link href="/samples" className="inline-flex min-h-11 items-center text-result-link underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-joy-blue">Try sample mode</Link>
        </p>
        <SearchApp />
        <noscript>
          <p className="mt-4 px-4 text-center text-sm text-search-muted">
            Enable JavaScript to search the web with JoySearch.
          </p>
        </noscript>
      </main>
      <footer className="flex min-h-[60px] items-center justify-center px-4 text-center text-[0.5rem] text-search-muted md:text-[1rem]">
        <p>
          <span aria-hidden="true">&lt;&lt; </span>
          Built by{" "}
          <a
            href="https://github.com/joydas65/JoySearch"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-joy-blue"
          >
            Joy Das
          </a>
          <span aria-hidden="true"> &gt;&gt;</span>
        </p>
      </footer>
    </>
  );
}
