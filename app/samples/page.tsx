import Link from "next/link";
import { SampleApp } from "@/components/sample-app";

export default function SamplesPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8 md:py-12">
      <Link href="/" className="inline-flex min-h-11 items-center text-sm text-result-link underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-joy-blue">Back to live search</Link>
      <h1 className="mt-4 text-2xl font-semibold text-gray-900 md:text-3xl">Explore JoySearch samples</h1>
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-gray-900">
        <p className="font-medium">Sample mode — fictional, authored examples. No live searches or AI requests.</p>
        <p className="mt-1">Explore citations, clarification, missing evidence, and failure handling. Playback delays are simulated and do not measure live performance.</p>
      </div>
      <SampleApp />
      <noscript><p className="mt-4 text-sm text-search-muted">Enable JavaScript to play samples, or <Link href="/samples/sources" className="underline">read the sample sources</Link>.</p></noscript>
    </main>
  );
}
