interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
}

interface BraveSearchResponse {
  web?: {
    results: Array<{
      title: string;
      url: string;
      description: string;
    }>;
  };
}

export async function braveWebSearch(query: string, count = 10): Promise<BraveSearchResult[]> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) throw new Error('BRAVE_API_KEY not configured');

  const params = new URLSearchParams({
    q: query,
    count: String(count),
    search_lang: 'en',
    country: 'AU',
  });

  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!res.ok) {
    throw new Error(`Brave Search failed: ${res.status} ${res.statusText}`);
  }

  const data: BraveSearchResponse = await res.json();
  return (data.web?.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description,
  }));
}
