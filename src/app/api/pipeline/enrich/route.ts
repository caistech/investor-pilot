import { authenticateAndGetDb } from '@/lib/agent/db';
import { hunterEmailFinder, hunterDomainSearch } from '@/lib/agent/hunter-tools';
import { updateContact } from '@/lib/db/partners';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

// Operational caps — keeps the batch under Vercel's 60s edge ceiling even when
// Hunter is slow. Sized so 20 partners × ~5s Hunter / 5-wide = ~20s, leaving
// headroom for outliers.
const MAX_PARTNERS_PER_REQUEST = 20;
const HUNTER_TIMEOUT_MS = 8_000;

void hunterEmailFinder; // silence unused-import — legacy v2 codepath, kept for future revival

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { partner_ids, organisation_id } = await request.json() as {
    partner_ids: string[];
    organisation_id: string;
  };

  if (!partner_ids?.length || !organisation_id) {
    return NextResponse.json({ error: 'partner_ids[] and organisation_id required' }, { status: 400 });
  }

  if (partner_ids.length > MAX_PARTNERS_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `Too many partners — pass at most ${MAX_PARTNERS_PER_REQUEST} per call (got ${partner_ids.length}). Split into batches to stay under the 60s function ceiling.`,
      },
      { status: 400 },
    );
  }

  // Load partners
  const { data: partners } = await db
    .from('partners')
    .select('id, company_name, domain, contact_name')
    .in('id', partner_ids)
    .eq('organisation_id', organisation_id);

  if (!partners?.length) {
    return NextResponse.json({ error: 'No partners found' }, { status: 404 });
  }

  const results: Array<{
    partner_id: string;
    company_name: string;
    domain: string;
    status: string;
    contact_name?: string;
    contact_email?: string;
    email_confidence?: number;
    error?: string;
  }> = [];

  // Process in parallel batches of 5
  const BATCH_SIZE = 5;
  for (let i = 0; i < partners.length; i += BATCH_SIZE) {
    const batch = partners.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (partner) => {
        if (!partner.domain) {
          return {
            partner_id: partner.id,
            company_name: partner.company_name,
            domain: '',
            status: 'error' as const,
            error: 'No domain set for this partner',
          };
        }

        // GUARD: LinkedIn-sourced rows with no real company domain land here
        // with domain="linkedin.com/in/<public_id>". Hunter silently strips
        // the path and searches linkedin.com itself, returning the top-
        // confidence LinkedIn-employee email (e.g. rnella@linkedin.com) for
        // EVERY such partner — visible contamination in the Prospects view.
        // For these rows, the email-discovery path is LinkedIn deep-read
        // (migration 011 enrichment, 1st-degree only) or manual research,
        // not Hunter. Skip and mark unresolved so the UI shows "no email"
        // instead of incorrect data.
        if (/^linkedin\.com\//i.test(partner.domain) || partner.domain.includes('/')) {
          await db.from('partners').update({
            email_status: 'unresolved',
            contact_source: 'skipped_linkedin_pseudo_domain',
            last_updated_at: new Date().toISOString(),
          }).eq('id', partner.id);
          return {
            partner_id: partner.id,
            company_name: partner.company_name,
            domain: partner.domain,
            status: 'unresolved' as const,
            error: 'LinkedIn pseudo-domain; use LinkedIn deep-read enrichment instead of Hunter',
          };
        }

        try {
          // Try domain search first (doesn't need a name). Hard timeout so a
          // slow Hunter call can't block the whole batch — failed call gets
          // marked unresolved and we move on. The 5-wide concurrency means
          // worst case for 20 partners is 20/5 × 8s = 32s.
          const domainResult = await Promise.race([
            hunterDomainSearch(partner.domain),
            new Promise<null>((_, reject) =>
              setTimeout(() => reject(new Error(`Hunter timeout after ${HUNTER_TIMEOUT_MS}ms`)), HUNTER_TIMEOUT_MS),
            ),
          ]);

          if (domainResult?.emails?.length) {
            // Pick the best email: highest confidence, prefer decision-maker titles
            const sorted = [...domainResult.emails].sort((a, b) => b.confidence - a.confidence);
            const best = sorted[0];

            const contactData = {
              contact_name: [best.first_name, best.last_name].filter(Boolean).join(' ') || null,
              contact_title: best.position || null,
              contact_email: best.value,
              contact_linkedin: best.linkedin || null,
              email_confidence: best.confidence,
              email_status: best.confidence >= 70 ? 'verified' : 'probable',
              contact_source: 'hunter_domain_search',
            };

            await updateContact(db, organisation_id, partner.domain, contactData as Record<string, unknown> as import('@/lib/db/partners').ContactData);

            return {
              partner_id: partner.id,
              company_name: partner.company_name,
              domain: partner.domain,
              status: 'enriched',
              contact_name: contactData.contact_name || undefined,
              contact_email: contactData.contact_email,
              email_confidence: contactData.email_confidence,
            };
          }

          // No emails found
          await updateContact(db, organisation_id, partner.domain, {
            email_status: 'unresolved',
            contact_source: 'hunter_domain_search',
          });

          return {
            partner_id: partner.id,
            company_name: partner.company_name,
            domain: partner.domain,
            status: 'unresolved',
          };
        } catch (err) {
          // Update partner to show error state
          await db.from('partners').update({
            email_status: 'unresolved',
            last_updated_at: new Date().toISOString(),
          }).eq('id', partner.id);

          return {
            partner_id: partner.id,
            company_name: partner.company_name,
            domain: partner.domain,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    }
  }

  return NextResponse.json({
    enriched: results.filter(r => r.status === 'enriched').length,
    unresolved: results.filter(r => r.status === 'unresolved').length,
    errors: results.filter(r => r.status === 'error').length,
    results,
  });
}
