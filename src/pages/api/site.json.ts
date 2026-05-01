import type { APIRoute } from "astro";
import { site } from "../../site";

export const GET: APIRoute = () => {
  return new Response(JSON.stringify(site, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
};
