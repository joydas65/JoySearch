# JoySearch

A responsive Wikipedia search application built with **HTML**, **Sass**, and **vanilla JavaScript**.

**[Live demo](https://joysearch.netlify.app/)**

## Features

- Search Wikipedia articles and display up to 20 results.
- Show article titles, summaries, and available thumbnail images.
- Open full articles on Wikipedia.
- Adapt the layout and summary length to the screen size.
- Clear search terms using the mouse or keyboard.
- Use modular JavaScript and Sass partials for maintainable code.

## Run locally

Clone this repository, then serve its root directory over HTTP:

```sh
git clone https://github.com/joydas65/JoySearch.git
cd JoySearch
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000). An HTTP server is required because the app uses JavaScript modules; opening `index.html` directly with a `file://` URL may fail.

The compiled stylesheet is included, so no build step or API key is needed to run the app. An internet connection is required for Wikipedia requests, Google Fonts, and Font Awesome icons.

## Edit styles

The Sass entry point is `sass/style.scss`. With Node.js and npm installed, compile it using:

```sh
npx --yes sass@1.93.2 sass/style.scss sass/style.css
```

To rebuild automatically while editing:

```sh
npx --yes sass@1.93.2 --watch sass/style.scss:sass/style.css
```

The recovered Sass uses legacy `@import` rules. Dart Sass 1.93.2 supports these rules with deprecation warnings.

## Project structure

```text
index.html              Page structure and accessible search controls
js/
  main.js               Application initialization and search flow
  dataFunctions.js      Wikipedia requests and result normalization
  searchBar.js          Search input, clear button, and focus handling
  searchResults.js      Result rendering and result count
sass/
  style.scss            Sass entry point
  _base.scss            Colors, typography, mixins, and base layout
  _sharedClasses.scss   Shared utility classes
  _searchEntry.scss     Logo and search form styles
  _searchResults.scss   Result layout and responsive styles
  style.css             Compiled stylesheet
  style.css.map         Stylesheet source map
```

## How search works

The browser calls the English Wikipedia Action API with `generator=search`, requesting article extracts and available page images. Results link to their Wikipedia page IDs. No backend or credentials are required.

## Source recovery

This repository was restored on **10 November 2026** from the publicly served files at [joysearch.netlify.app](https://joysearch.netlify.app/). The deployed HTML, JavaScript, original Sass partials, compiled CSS, and source map were recovered. A hosting-injected advertising comment was removed from the HTML, and this README and `.gitignore` were added.

The app's behavior and styling are preserved. The original Git history, repository configuration, and deployment configuration were not available from the site. Creating this repository does not change or reconnect the existing Netlify deployment.

### Known limitations in the recovered version

- Network or Wikipedia API failures do not yet display a friendly error message.
- Search terms containing an ampersand (`&`) are not independently URL-encoded and may produce unexpected results.

## Credits

- Project by [Joy Das](https://github.com/joydas65).
- Search results and article content are provided by [Wikipedia](https://www.wikipedia.org/).
- Icons: Font Awesome 5.15.1 via cdnjs. Typeface: Roboto via Google Fonts.
