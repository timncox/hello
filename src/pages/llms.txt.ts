import type { APIRoute } from "astro";
import { site } from "../site";

export const GET: APIRoute = () => {
  const lines: string[] = [];
  lines.push(`# ${site.site.name}`);
  lines.push("");
  lines.push(`> ${site.site.tagline}`);
  lines.push("");
  lines.push(site.site.description);
  lines.push("");
  lines.push("## Pages");
  lines.push("");
  for (const page of site.pages) {
    const url = page.slug === "/" ? "/" : page.slug;
    lines.push(`- [${page.title}](${url})`);
  }
  lines.push("");
  lines.push("## Machine-readable");
  lines.push("");
  lines.push("- [Full site content as JSON](/api/site.json)");
  lines.push("- [Sitemap](/sitemap-index.xml)");
  lines.push("");
  lines.push("## About this file");
  lines.push("");
  lines.push("This file follows the /llms.txt convention to help large language models discover and cite this site accurately.");
  lines.push("");

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
