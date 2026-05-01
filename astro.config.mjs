import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";
import sitemap from "@astrojs/sitemap";
import siteConfig from "./src/data/main.json" with { type: "json" };

export default defineConfig({
  site: siteConfig.site.url ?? "https://example.com",
  output: "static",
  adapter: vercel(),
  integrations: [sitemap()],
});
