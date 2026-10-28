# Deutsch lernen

A personal German-vocabulary app for iPhone, built as an offline PWA (no backend).

- Sets and folders (Quizlet-style); learn a single set, a whole folder, or smart sets (Due, New, Starred, Mistakes)
- Auto-fill from German Wiktionary: article, plural, Präteritum/Perfekt, translations (RU/EN) and example sentences
- Pronunciation with the iPhone's built-in German voices
- Study modes: flashcards, typing, multiple choice, matching, listening, article drill, verb-forms drill
- Spaced repetition (FSRS)
- Quizlet import (paste the export text) and JSON backup
- Works offline once installed; dictionary auto-fill needs internet

## Install on iPhone

Open https://froz-ilya.github.io/language-learning/ in Safari → Share → **Add to Home Screen**.

For nicer pronunciation, download an enhanced German voice: iOS Settings → Accessibility → Spoken Content → Voices → German.

## Develop

```bash
npm install
npm run dev      # local dev server
npm test         # unit tests
npm run check    # type check
npm run build    # production build into dist/
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`
(one-time setup: repo Settings → Pages → Source: **GitHub Actions**).

## Data sources

- Dictionary data: [Wiktionary](https://de.wiktionary.org) via [kaikki.org](https://kaikki.org) (CC BY-SA 4.0)
- Word frequency (levels, offline dictionary): [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (OpenSubtitles 2018, CC BY-SA 4.0)
- Reading texts: [MiniKlexikon](https://miniklexikon.zum.de) & [Klexikon](https://klexikon.zum.de) (CC BY-SA 4.0), [Wikinews](https://de.wikinews.org) (CC BY 2.5), [Wikipedia](https://de.wikipedia.org) (CC BY-SA 4.0), [Project Gutenberg](https://www.gutenberg.org) (public domain)
- Translation fallbacks: Google Translate (unofficial free endpoint), [MyMemory](https://mymemory.translated.net)

Generated data is committed; rebuild it with `npm run data:levels`, `npm run data:dict`, `npm run data:reading` (each reads its download cache under `scripts/*/.cache`). The Klexikon/MiniKlexikon level catalog (`public/reading/klexikon.json`, every article rated with the reader's own level estimate) was downloaded once (`npm run data:klexikon:full`, batched, rate-limited API requests) and is re-rated from that cache by `npm run data:reading`. `npm run data:klexikon` fetches only what changed on the sites since the last sync; the monthly *Update reading list* workflow runs it and opens a pull request (needs "Allow GitHub Actions to create and approve pull requests" in Settings → Actions → General).
