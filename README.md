# JoySearch

A responsive Wikipedia search app built with **Next.js App Router**, **React**, **TypeScript**, and **Tailwind CSS**.

JoySearch keeps the original colorful logo, search layout, and mobile breakpoints while replacing standalone HTML, Sass, and DOM manipulation with React components and Tailwind utilities.

## Features

- Search up to 20 Wikipedia articles, ordered by relevance.
- Read summaries and view available article thumbnails.
- Open full articles on Wikipedia.
- Use the search and clear controls with a keyboard or pointer.
- See accessible loading, empty-result, and connection-error messages.
- Search for terms containing `&`, `+`, `#`, and other special characters.
- Cancel superseded requests so old results cannot replace a newer search.
- Run as a static site with no backend, API keys, or environment variables.

## Run locally

Use **Node.js 24 or newer** and **pnpm 11.25.0**.

```sh
git clone https://github.com/joydas65/JoySearch.git
cd JoySearch
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Checks and production build

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The build exports a static site to `out/`. Preview the production output with any static HTTP server, for example:

```sh
python3 -m http.server 8000 --directory out
```

Open [http://localhost:8000](http://localhost:8000). `next start` is not used because this app is configured with `output: "export"`.

## Deploy to Netlify

The included `netlify.toml` uses Node.js 24, build command `pnpm build`, and publish directory `out`. Connect this repository and the desired branch in Netlify, or upload the built `out` directory to a static host.

The [existing JoySearch deployment](https://joysearch.netlify.app/) is the original app. This migration does not automatically reconnect or update that deployment.

## Project structure

```text
app/
  layout.tsx                  Root document and metadata
  page.tsx                    Home page and Wikipedia footer
  globals.css                 Tailwind import, design tokens, and local fonts
components/
  joy-logo.tsx                Original JoySearch wordmark
  search-app.tsx              Search form, request lifecycle, and UI states
  search-results.tsx          Article links, thumbnails, and summaries
lib/
  wikipedia.ts               Typed Wikipedia API client
tests/
  wikipedia.test.ts          API normalization and failure regression tests
next.config.ts               Static export configuration
postcss.config.mjs           Tailwind CSS PostCSS integration
netlify.toml                 Static hosting build configuration
```

Edit colors and the font family in `app/globals.css`; layout and responsive styles live in each component's Tailwind classes. Roboto is bundled locally using Fontsource, and the search/clear icons use inline SVG, so rendering does not depend on font or icon CDNs.

## Search and testing

The browser calls the English Wikipedia Action API directly with `generator=search`, `pageimages`, `extracts`, and `origin=*`. Queries use `URLSearchParams`; summaries adapt to the viewport width. Requests time out after 15 seconds, and clearing or starting a new search cancels the previous request.

`pnpm test` uses Node's test runner and mocked API responses to cover query encoding, normalization, responsive summary lengths, relevance ordering, optional thumbnails, empty results, failure responses, and cancellation. Real Wikipedia searches require an internet connection.

## Project history and credits

The original HTML, JavaScript, and Sass sources were recovered from the public JoySearch deployment on 10 November 2026. They remain available in [the original source commit](https://github.com/joydas65/JoySearch/tree/3d96b4dc138922092be997a5bab6d0fca4a9e014). This migration replaces the old source files in the working application; no original pre-recovery Git history was available.

- Project by [Joy Das](https://github.com/joydas65).
- Article content and images are provided by [Wikipedia](https://www.wikipedia.org/).
- Roboto is bundled through [Fontsource](https://fontsource.org/fonts/roboto).
