# loom-site template

This is the Astro template every loom site is scaffolded from.

## Editing rules (when AI is editing this site)

For 95% of changes, edit ONLY `src/data/main.json`. That file is the canonical content surface.

Touch other files only when the user explicitly asks for structural/visual changes that the schema can't express (e.g. "add a custom contact form component" — that needs a new `.astro` file).

## Schema (src/data/main.json — the canonical content file)

```json
{
  "site":   { "name", "tagline", "description", "url"? },
  "pages":  [ { "slug", "title", "content" (markdown) } ],
  "theme":  { "accent" (#hex), "mode" ("light"|"dark"|"auto"), "font" ("sans"|"serif"|"mono") },
  "schema": { "type" (Schema.org type), "extra"? (object) }
}
```

- `pages[0]` MUST have `slug: "/"` (it's the home page).
- Every other page's slug MUST start with `/` and contain only `[a-z0-9-/]`.
- `content` is rendered as Markdown via `marked`. Headings, lists, links, emphasis, code all work.
- `theme.accent` is the single brand color, surfaced as `--accent` everywhere.
- `schema.type` controls the JSON-LD `@type` emitted in the page head.

## File map

```
src/
  data/main.json           # the contract — edit this
  site.ts                  # typed wrapper around main.json
  layouts/Base.astro       # HTML shell, head, JSON-LD, OG, theme CSS variables
  pages/
    index.astro            # renders pages[slug=="/"]
    [...slug].astro        # renders any non-home page
    llms.txt.ts            # /llms.txt
    api/site.json.ts       # /api/site.json (machine-readable mirror)
public/
  robots.txt               # allow all + sitemap pointer
  media/                   # uploaded images live here
```

## What's already AI-optimized

- Schema.org JSON-LD per page (driven by `schema.type` + page content)
- Open Graph + Twitter card tags
- `/llms.txt` advertising the canonical pages and `/api/site.json`
- `/api/site.json` returning the full content config as JSON
- Sitemap (via `@astrojs/sitemap`) at `/sitemap-index.xml`
- robots.txt allowing all + pointing at sitemap
- Semantic HTML5 throughout

## Scrollture app (this site)

The home page is a full-screen Bible feed app, not markdown content:

```
src/pages/index.astro      # app shell (uses Base with `bare`)
src/scripts/app.ts         # all app logic: feed sources, cards, routing (#/books, #/book/<id>, #/read/<id>/<ch>, #/themes, #/theme/<id>, #/watch = Brainrot Bible, #/me)
src/scripts/video.ts       # video cards: narration playback, word-synced captions, export to MP4/WebM
src/scripts/motion.ts      # animated canvas backgrounds, one look per genre
src/scripts/cards.ts       # brainrot collector cards: DOM card (holo, tilt, flip), locked back, PNG export
src/scripts/satisfying.ts  # split-screen "oddly satisfying" loops synced to word beats (ring, stack, fireworks, sand, spiro, pendulum)
src/styles/app.css         # app styles (genre gradients, cards, pages)
src/data/themes.json       # curated themes: references only, e.g. "Romans 8:38-39"
scripts/build-bible.mjs    # `npm run bible`: regenerates public/bible/ from the source text + themes.json
public/bible/              # generated: index.json, themes.json, books/<id>.json (don't hand-edit)
src/data/characters.json   # brainrot characters: id, name, Italian chant, art prompt, verse refs
scripts/narrate.py         # time every word of the BSB narration for whole books (audio is streamed, not stored)
scripts/align-audio.py     # word-level timing for narrated chapters (faster-whisper + alignment to BSB text)
scripts/make-chants.py     # synthesize + time each character's chant (Piper Italian TTS)
public/brainrot/           # <id>.jpg art (720x1280), <id>.mp3 chant, <id>.json chant word timings
public/media/<book>/       # <chapter>.json word timings; "audio" is /audio/... which astro.config.mjs proxies to openbible.com
```

Adding narration for a book (BSB audio is CC0, streamed from openbible.com/audio/souer/BSB_<nn>_<Abc>_<ccc>.mp3 through the site's /audio proxy):
1. `pip install faster-whisper piper-tts`
2. `python scripts/narrate.py <book> [<book> ...]` (skips chapters already done; `--chapters 1-4` for part of a book)
3. `npm run bible` so index.json lists the narrated chapters; their cards then play as video.

Adding a brainrot character:
1. Add an entry to `src/data/characters.json`. Name: on the nose, English-recognizable words with Italian endings that say who and what (Jonahrino Whalerino, Froggo Pharaoggo), never a copy of an existing meme character. `say`: the same name spelled so the Italian voice pronounces it right (Gionarino Uèilerino). Chant: short, Italian, and accurate to the passage. Refs: verses from that story, ideally in narrated chapters.
2. Generate art from the entry's `prompt` (vertical, "surreal hyperrealistic 3D render, Italian brainrot meme style, no text"), save as `public/brainrot/<id>.jpg` at 720x1280.
3. `python scripts/make-chants.py --only <id>`, narrate its chapters (above), then `npm run bible`.
- Cards: each character has a collector card. `type` (e.g. "🌊 Sea") is set in characters.json; card number and rarity are computed by `npm run bible` (rarity from how many verses the Collect section is: <13 common, <21 rare, <35 epic, else legendary). Card stats (Aura/Chaos/Drip) are playful game values, never Bible facts.
- Collecting: a character is collected by tapping 🎯 Collect (Keep going) on its card and finishing every verse from there to the end of the chapter (min. 5 verses, running into the next chapter). Only cards that play to the end count. State: localStorage `scrollture:collected`; UI at `#/collection`; one character's passages at `#/char/<id>`.
- God and Jesus are never turned into mascots; characters are people, animals, creatures and objects from the stories.

- Scripture text is the Berean Standard Bible (public domain). Do NOT add NIV/ESV/NLT or other copyrighted text without a license.
- To add or change a theme, edit `src/data/themes.json`, then run `npm run bible` (it fails loudly on a bad reference).
- User state (likes, streak, progress) lives in localStorage under `scrollture:*` keys.

## Don't

- Don't add a JS framework (React, Vue, etc.) unless the user explicitly asks. Astro islands stay zero-JS by default.
- Don't introduce a CSS framework (Tailwind, etc.) unless the user explicitly asks. The vanilla CSS-vars approach keeps the LLM's editing surface tight.
- Don't invent facts. If the brief or instruction doesn't supply a fact, leave a `[placeholder]` and note it.
