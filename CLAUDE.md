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
src/scripts/app.ts         # all app logic: feed sources, cards, routing (#/books, #/book/<id>, #/read/<id>/<ch>, #/themes, #/theme/<id>, #/me)
src/styles/app.css         # app styles (genre gradients, cards, pages)
src/data/themes.json       # curated themes: references only, e.g. "Romans 8:38-39"
scripts/build-bible.mjs    # `npm run bible`: regenerates public/bible/ from the source text + themes.json
public/bible/              # generated: index.json, themes.json, books/<id>.json (don't hand-edit)
```

- Scripture text is the Berean Standard Bible (public domain). Do NOT add NIV/ESV/NLT or other copyrighted text without a license.
- To add or change a theme, edit `src/data/themes.json`, then run `npm run bible` (it fails loudly on a bad reference).
- User state (likes, streak, progress) lives in localStorage under `scrollture:*` keys.

## Don't

- Don't add a JS framework (React, Vue, etc.) unless the user explicitly asks. Astro islands stay zero-JS by default.
- Don't introduce a CSS framework (Tailwind, etc.) unless the user explicitly asks. The vanilla CSS-vars approach keeps the LLM's editing surface tight.
- Don't invent facts. If the brief or instruction doesn't supply a fact, leave a `[placeholder]` and note it.
