import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";
import sitemap from "@astrojs/sitemap";
import siteConfig from "./src/data/main.json" with { type: "json" };
import { readFile, writeFile } from "node:fs/promises";

// Narration streams from the public-domain BSB audio host through our own origin
// (/audio/... -> openbible.com/audio/...), so it isn't stored in the repo and stays
// same-origin for video export. The Vercel adapter ignores vercel.json rewrites,
// so add the proxy route to its Build Output config after it is written.
const audioProxy = {
  name: "audio-proxy",
  hooks: {
    "astro:build:done": async () => {
      const file = new URL("./.vercel/output/config.json", import.meta.url);
      const config = JSON.parse(await readFile(file, "utf8"));
      const route = { src: "^/audio/(.*)$", dest: "https://openbible.com/audio/$1" };
      config.routes = [route, ...(config.routes ?? []).filter((r) => r.src !== route.src)];
      await writeFile(file, JSON.stringify(config, null, 2));
    },
  },
};

export default defineConfig({
  site: siteConfig.site.url ?? "https://example.com",
  output: "static",
  adapter: vercel(),
  integrations: [sitemap(), audioProxy],
});
