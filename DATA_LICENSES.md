# Data licenses

[`LICENSE`](LICENSE) (Apache-2.0) covers the code in this repository and anything else not listed
here. It doesn't cover the third-party data below, which keeps its own terms.

## Third-party data

| Path | What it holds | Source | License |
| --- | --- | --- | --- |
| `public/dict/`, `public/levels/` | Words, grammar, translations, example sentences | [Wiktionary](https://de.wiktionary.org) contributors, via [kaikki.org](https://kaikki.org) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `public/dict/`, `public/levels/` | Word frequency ranks | [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (OpenSubtitles 2018) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `public/reading/klexikon.json` | Article titles, with the app's level estimates | [MiniKlexikon](https://miniklexikon.zum.de) & [Klexikon](https://klexikon.zum.de) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `public/reading/gutenberg.json` | Stories | [Project Gutenberg](https://www.gutenberg.org) | Public domain |
| `public/fonts/` | Nunito | Nunito Project Authors | [SIL OFL 1.1](public/fonts/OFL-Nunito.txt) |
| `scripts/levels/__fixtures__/kaikki-sample.jsonl`, `src/lib/lookup/__fixtures__/`, `src/lib/sources/providers/__fixtures__/` | Test samples | Wiktionary contributors | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `src/lib/reading/__fixtures__/klexikon-*` | Test samples | MiniKlexikon & Klexikon | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `src/lib/reading/__fixtures__/wikinews-*` | Test samples | [Wikinews](https://de.wikinews.org) | [CC BY 2.5](https://creativecommons.org/licenses/by/2.5/) |

The CC BY-SA data has been changed: entries are extracted, filtered, reformatted and merged. The
result is shared under CC BY-SA 4.0, apart from the content listed in the next section.

## Not licensed by this repository

No license is granted here for the following, even where it sits in the files listed above:

- **Levels A1–B1:** which word belongs to which level comes from the Goethe-Zertifikat word lists
  (© Goethe-Institut), via [DWDS](https://www.dwds.de). This includes the mappings in
  `scripts/levels/goethe.json`. Goethe's example sentences are not used.
- **Levels B2–C2:** these are estimates based partly on
  [DAFlex](https://cental.uclouvain.be/cefrlex/daflex/) (CEFRLex, CENTAL, UCLouvain). The app
  credits DAFlex as CC BY-NC-SA 4.0, but the publisher's pages don't state a license, so its terms
  are still to be confirmed. `scripts/levels/__fixtures__/daflex-sample.tsv` is a short excerpt.
- **Machine translations:** some example translations and some translations of preset words come
  from Google Translate.

## Online sources

The app fetches these on the device while it runs. Apart from the test samples above, their content
isn't in this repository: Wiktionary, [Wikipedia](https://de.wikipedia.org) (CC BY-SA 4.0), Wikinews
(CC BY 2.5), MiniKlexikon and Klexikon articles (CC BY-SA 4.0), [tagesschau](https://www.tagesschau.de)
(© ARD), [Deutsche Welle](https://www.dw.com/de/) (© DW), Google Translate and
[MyMemory](https://mymemory.translated.net). The app shows the attribution under every article.

News from tagesschau and Deutsche Welle isn't openly licensed. The phone reads it from the publisher,
and it's never stored in this repository. The news test samples use invented text.
