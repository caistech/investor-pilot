interface HunterEmailResult {
  email: string;
  first_name: string;
  last_name: string;
  position: string | null;
  confidence: number;
  type: string;
  linkedin: string | null;
  sources: Array<{ domain: string; uri: string }>;
}

interface HunterDomainResult {
  domain: string;
  organisation: string;
  emails: Array<{
    value: string;
    type: string;
    confidence: number;
    first_name: string | null;
    last_name: string | null;
    position: string | null;
    linkedin: string | null;
  }>;
}

export async function hunterEmailFinder(
  domain: string,
  firstName: string,
  lastName: string
): Promise<HunterEmailResult | null> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) throw new Error('HUNTER_API_KEY not configured');

  const params = new URLSearchParams({
    domain,
    first_name: firstName,
    last_name: lastName,
    api_key: apiKey,
  });

  const res = await fetch(`https://api.hunter.io/v2/email-finder?${params}`);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Hunter Email Finder failed: ${res.status}`);
  }

  const json = await res.json();
  const d = json.data;
  if (!d?.email) return null;

  return {
    email: d.email,
    first_name: d.first_name,
    last_name: d.last_name,
    position: d.position,
    confidence: d.confidence,
    type: d.type,
    linkedin: d.linkedin,
    sources: d.sources || [],
  };
}

export async function hunterDomainSearch(domain: string): Promise<HunterDomainResult | null> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) throw new Error('HUNTER_API_KEY not configured');

  const params = new URLSearchParams({
    domain,
    api_key: apiKey,
    limit: '10',
  });

  const res = await fetch(`https://api.hunter.io/v2/domain-search?${params}`);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Hunter Domain Search failed: ${res.status}`);
  }

  const json = await res.json();
  const d = json.data;
  if (!d) return null;

  return {
    domain: d.domain,
    organisation: d.organization || d.organisation || '',
    emails: (d.emails || []).map((e: Record<string, unknown>) => ({
      value: e.value,
      type: e.type,
      confidence: e.confidence,
      first_name: e.first_name,
      last_name: e.last_name,
      position: e.position,
      linkedin: e.linkedin,
    })),
  };
}

export async function hunterEmailVerifier(email: string): Promise<{
  status: string;
  score: number;
  result: string;
} | null> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) throw new Error('HUNTER_API_KEY not configured');

  const params = new URLSearchParams({ email, api_key: apiKey });
  const res = await fetch(`https://api.hunter.io/v2/email-verifier?${params}`);
  if (!res.ok) return null;

  const json = await res.json();
  const d = json.data;
  if (!d) return null;

  return { status: d.status, score: d.score, result: d.result };
}
