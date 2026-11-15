import Link from "next/link";
import { SAMPLE_DOCUMENTS } from "@/lib/sample/scenarios";

export default function SampleSourcesPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8 md:py-12">
      <Link href="/samples" className="inline-flex min-h-11 items-center text-sm text-result-link underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-joy-blue">Back to samples</Link>
      <h1 className="mt-4 text-2xl font-semibold text-gray-900">Owned sample sources</h1>
      <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6">These documents were authored for JoySearch. Atlas Queue, its plans, and its policies are fictional. They are not live web evidence.</p>
      {SAMPLE_DOCUMENTS.map((document) => (
        <article id={document.id} key={document.id} className="mt-8 scroll-mt-5 border-t border-gray-200 pt-6">
          <h2 className="text-xl font-medium text-gray-900">{document.title}</h2>
          <p className="mt-3 text-base leading-7 text-gray-800">{document.excerpt}</p>
        </article>
      ))}
    </main>
  );
}
