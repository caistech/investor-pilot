// lib/outreach/tracking-url.ts
//
// The ONLY place outreach tracking params are applied. Idempotent by design:
// it strips any ref/src already on the URL before setting them fresh, so a
// second pass (or a URL that was stored with params already baked in) can
// never produce the doubled
//   ...vercel.app?ref=X&src=ip-outreach/?ref=X&src=ip-outreach
// string that shipped in the last draft batch.
//
// Rule for the whole codebase: store landing URLs BARE; stamp tracking here,
// once, at draft time. Never string-concatenate ref/src anywhere else.

export function stripTrackingParams(rawUrl: string): string {
  try {
    const u = normalize(rawUrl);
    u.searchParams.delete("ref");
    u.searchParams.delete("src");
    return tidy(u);
  } catch {
    // If it won't parse, fall back to a dumb split so we at least don't
    // persist a params-laden URL.
    return rawUrl.split("?")[0];
  }
}

export function buildTrackingUrl(rawUrl: string, ref: string): string {
  const u = normalize(rawUrl);
  // Strip first so re-runs / pre-stamped URLs can't double up.
  u.searchParams.delete("ref");
  u.searchParams.delete("src");
  u.searchParams.set("ref", ref);
  u.searchParams.set("src", "ip-outreach");
  return tidy(u);
}

function normalize(rawUrl: string): URL {
  // Tolerate a missing protocol (e.g. "singify-platform.vercel.app").
  try {
    return new URL(rawUrl);
  } catch {
    return new URL(`https://${rawUrl.replace(/^\/+/, "")}`);
  }
}

function tidy(u: URL): string {
  // WHATWG URL always keeps a root "/", which yields a cosmetic "/?ref="
  // for bare hosts. Strip just that trailing-slash-before-query case so the
  // link reads clean in an email body.
  return u.toString().replace(/\/\?/, "?");
}