import { authenticateAndGetDb } from '@/lib/agent/db';
import { hunterEmailFinder, hunterDomainSearch } from '@/lib/agent/hunter-tools';
import { updateContact } from '@/lib/db/partners';
import { NextResponse } from 'next/server';

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

        try {
          // Try domain search first (doesn't need a name)
          const domainResult = await hunterDomainSearch(partner.domain);

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
