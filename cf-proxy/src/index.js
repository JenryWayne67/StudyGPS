// StudyGPS reverse proxy Worker.
//
// Why this exists: the real app runs on Render (studygps.onrender.com),
// but Render's shared IP ranges are reportedly blocked for some users in
// Myanmar even though the app itself was never targeted. Cloudflare's own
// IP ranges are used by a huge share of the internet, so they're rarely
// blocked wholesale - this Worker sits in front of Render on a free
// *.workers.dev URL and quietly relays every request to it, so visitors
// only ever talk to Cloudflare directly.
//
// No code change needed on the Render/Express side: cookies, redirects,
// and API calls all pass through untouched because this only rewrites
// the destination host, nothing else about the request.

const ORIGIN = 'https://studygps.onrender.com';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, ORIGIN);
    const proxied = new Request(target, request);
    const response = await fetch(proxied);
    // Passing response.body/response straight through preserves every
    // header - including multiple Set-Cookie headers - so login sessions
    // keep working exactly as they do hitting Render directly.
    return new Response(response.body, response);
  }
};
