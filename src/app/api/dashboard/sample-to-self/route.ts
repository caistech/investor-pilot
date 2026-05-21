/**
 * POST /api/dashboard/sample-to-self
 *
 * Self-diagnostic sample: enriches the operator on Brave + (optionally)
 * LinkedIn, renders a cold-outreach email using a built-in sample offering
 * ("InvestorPilot — sample seed raise"), and sends it to the operator's
 * inbox via Resend. Returns the rendered draft inline so the dashboard
 * can show an Approvals-style preview without polluting real
 * sequence_templates / outbound_messages.
 *
 * Designed as the FIRST one-click test for new operators — proves the
 * pipeline works end-to-end before any project / product / sequence
 * setup. Also surfaces immediately whether the operator's own
 * LinkedIn / firm presence gives the system enough signal to write a
 * non-generic message — the same test the platform runs on every real
 * prospect.
 *
 * Body: {}  (no input — all context comes from the authenticated user's org)
 *
 * Pre-conditions:
 *   - Org has sender_name + sender_role
 *   - Org has sender_linkedin_url (returns 400 "needs_linkedin" if not, so
 *     the UI can prompt for it inline)
 *   - RESEND_FROM_EMAIL configured (server-side; surfaces as 500 if not)
 *
 * Returns:
 *   {
 *     ok: true,
 *     enrichment: { source_used, status, profile_fetched, posts_fetched_count, message? },
 *     rendered: { subject, body, personalization_score, evidence_refs },
 *     sent: { id?, error?, to },
 *     hint: string
 *   }
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { checkCap, buildCapExceededResponse } from '@/lib/usage/events';
import { enrichPartnerFromBrave } from '@/lib/enrichment/brave-firm';
import { enrichPartnerFromLinkedIn } from '@/lib/enrichment/linkedin-profile';
import { renderStep, type RenderPartner, type RenderContext, type StepTemplate } from '@/lib/sequencer/render';
import { sendEmail } from '@/lib/email/resend';

export const maxDuration = 60;

// The built-in sample offering. Hard-coded here so the sample works for a
// brand-new operator who hasn't created any projects/products yet. Mimics
// the shape of RenderPartner.offering_context exactly so the fit-signal
// extractor reasons about the recipient the same way it would for a real
// prospect.
const SAMPLE_OFFERING = {
  name: 'InvestorPilot — sample seed raise',
  pitch: `InvestorPilot is an outbound platform that turns investor research, enrichment, and personalised cold outreach into one operator-controlled workflow. It scores investors against your fund thesis, drafts messages grounded in real public evidence (not generic templates), and queues every send for human approval. Built for capital allocators raising direct from sophisticated investors, family offices, and small LPs — without spamming.`,
  sector: 'B2B SaaS · outbound / fundraising tooling',
  geography: 'Global · primary AU + UK + US',
};

// Inline cold-email template body. Uses the same placeholder vocabulary as
// every other sequencer template so the renderer's substitution layer needs
// no changes. Body intentionally short — operators read this on a phone in
// their own inbox; long-form copy buries the personalisation.
const SAMPLE_TEMPLATE: StepTemplate = {
  subject: '{first_name} — what InvestorPilot would have written to you',
  body: `Hi {first_name},

{credit_signal_lead}

This message was generated end-to-end by InvestorPilot — same pipeline that would write to your real investor prospects. Quick walkthrough of what happened in the ~20 seconds before you got this:

  1. Brave + LinkedIn enrichment on your own profile + firm (so you can verify what the system finds about you in public sources)
  2. Fit-signal extraction tied to the sample offering ({offering_name})
  3. Cold-email render with full courtesy-contract structure (who-I-am · why-you · what-I-offer · ask-last)
  4. Compliance pass, then delivery to your inbox

{value_offer_lead}

If the personalisation above lands flat — the system either couldn't find enough on you in public, or your LinkedIn URL isn't set in /settings. Both are fixable in two clicks. {sender_linkedin_url}

— {sender_name}
{sender_role}`,
  max_chars: 2500,
  is_warm: false,
};

// Where the synthetic sample-partner row lives. Domain is namespaced so it
// can't collide with a real prospect. category='_sample_self' lets the
// Prospects tab filter it out (the table already hides contactless rows;
// this row has a contact, so we hide by category instead).
function sampleDomain(orgId: string): string {
  return `sample-self.${orgId}.investorpilot.local`;
}

export async function POST() {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  // Resolve org + the authenticated user's name/email. profile.full_name is
  // used as the recipient's display name; if missing, we fall back to the
  // local-part of their email so the rendered {first_name} still works.
  const { data: profile } = await db
    .from('profiles')
    .select('active_organisation_id, full_name, email')
    .eq('id', user!.id)
    .single();
  if (!profile?.active_organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }
  const orgId = profile.active_organisation_id as string;

  const operatorEmail = (profile.email as string) || user!.email;
  if (!operatorEmail) {
    return NextResponse.json({ error: 'Your account has no email on file' }, { status: 400 });
  }

  const operatorFullName = (profile.full_name as string)?.trim() || operatorEmail.split('@')[0];

  // Load org sender identity. LinkedIn URL is required — the whole point
  // of the sample is to demonstrate self-enrichment, which needs a URL to
  // pull. The UI catches this client-side via /api/settings/sender check,
  // but we re-validate here so direct API hits get the same error shape.
  const { data: org } = await db
    .from('organisations')
    .select('name, sender_name, sender_role, signature_block, sender_linkedin_url, sender_bio_one_liner, sender_calendar_url')
    .eq('id', orgId)
    .single();
  if (!org) {
    return NextResponse.json({ error: 'Organisation not found' }, { status: 404 });
  }
  if (!org.sender_name || !org.sender_role) {
    return NextResponse.json(
      { error: 'Sender identity is not set. Visit /settings to fill in sender_name and sender_role first.', code: 'needs_sender_identity' },
      { status: 400 },
    );
  }
  if (!org.sender_linkedin_url) {
    return NextResponse.json(
      { error: 'Your LinkedIn URL is not set. The sample test enriches you as the prospect — without your LinkedIn URL we have nothing to look up.', code: 'needs_linkedin' },
      { status: 400 },
    );
  }

  // LLM cap pre-flight — the renderer fires up to 2 Claude calls (fit
  // signal + translation if applicable). Cheaper to refuse here than to
  // half-render and 429 mid-way.
  const llmCap = await checkCap(orgId, 'llm_tokens');
  if (!llmCap.allowed) {
    return NextResponse.json(buildCapExceededResponse('llm_tokens', llmCap), { status: 429 });
  }

  // Upsert the operator-as-partner row. Idempotent on the synthetic
  // domain so repeated samples reuse the same row (and skip re-enrichment
  // if already fresh). category='_sample_self' tags it for UI filtering.
  const domain = sampleDomain(orgId);
  const linkedinUrl = (org.sender_linkedin_url as string) || null;
  const orgName = (org.name as string)?.trim() || 'Your organisation';

  const { data: existingSample } = await db
    .from('partners')
    .select('id, evidence_enriched_at, profile_recent_posts, firm_recent_news, firm_named_deals')
    .eq('organisation_id', orgId)
    .eq('domain', domain)
    .maybeSingle();

  let samplePartnerId: string;
  if (existingSample?.id) {
    samplePartnerId = existingSample.id as string;
    // Always re-blank evidence so the operator sees a FRESH enrichment
    // pass each time they click the button — the point of the sample is
    // diagnosis, not caching.
    await db
      .from('partners')
      .update({
        contact_name: operatorFullName,
        contact_title: org.sender_role as string,
        contact_email: operatorEmail,
        contact_linkedin: linkedinUrl,
        company_name: orgName,
        evidence_enriched_at: null,
        profile_recent_posts: null,
        firm_recent_news: null,
        firm_named_deals: null,
      })
      .eq('id', samplePartnerId);
  } else {
    const { data: inserted, error: insertError } = await db
      .from('partners')
      .insert({
        organisation_id: orgId,
        company_name: orgName,
        domain,
        category: '_sample_self',
        contact_name: operatorFullName,
        contact_title: org.sender_role as string,
        contact_email: operatorEmail,
        contact_linkedin: linkedinUrl,
        source: linkedinUrl ? 'linkedin' : 'brave',
        network_distance: '1st',
        status: 'contact_found',
      })
      .select('id')
      .single();
    if (insertError || !inserted) {
      return NextResponse.json(
        { error: `Could not create sample prospect row: ${insertError?.message || 'no row returned'}` },
        { status: 500 },
      );
    }
    samplePartnerId = inserted.id as string;
  }

  // Enrichment: LinkedIn first (richer), Brave as a fallback or supplement.
  // The orchestrator normally picks one based on partner.source — here we
  // call them directly so the response can report both outcomes side by side
  // (operator sees BOTH ingest paths working / failing).
  type EnrichmentReport = {
    source_used: 'linkedin' | 'brave' | 'both' | 'none';
    linkedin?: { status: string; message?: string; posts_fetched_count: number; profile_fetched: boolean };
    brave?: { status: string; message?: string };
  };
  const enrichmentReport: EnrichmentReport = { source_used: 'none' };

  // Resolve the org's LinkedIn channel for the deep-read (needs an
  // oauth_token_ref). If missing, we skip LinkedIn enrichment quietly and
  // fall back to Brave only — the report reflects that.
  const { data: linkedinChannel } = await db
    .from('client_channels')
    .select('oauth_token_ref')
    .eq('organisation_id', orgId)
    .eq('channel_type', 'linkedin')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  const linkedinAccountId = (linkedinChannel?.oauth_token_ref as string) || null;

  if (linkedinAccountId && linkedinUrl) {
    try {
      const linkedinOutcome = await enrichPartnerFromLinkedIn(
        db,
        {
          id: samplePartnerId,
          contact_linkedin: linkedinUrl,
          contact_email: operatorEmail,
          contact_name: operatorFullName,
          contact_title: org.sender_role as string,
          company_name: orgName,
          network_distance: '1st',
        },
        linkedinAccountId,
      );
      enrichmentReport.linkedin = {
        status: linkedinOutcome.status,
        message: linkedinOutcome.message,
        posts_fetched_count: linkedinOutcome.posts_fetched_count,
        profile_fetched: linkedinOutcome.profile_fetched,
      };
      if (linkedinOutcome.status === 'success' || linkedinOutcome.status === 'partial') {
        enrichmentReport.source_used = 'linkedin';
      }
    } catch (err) {
      enrichmentReport.linkedin = {
        status: 'failed',
        message: err instanceof Error ? err.message : String(err),
        posts_fetched_count: 0,
        profile_fetched: false,
      };
    }
  }

  // Brave always runs — supplements LinkedIn posts with firm-level news
  // and is the only path if LinkedIn enrichment is unavailable. Errors
  // are non-fatal; the renderer degrades to humble fallback when no
  // evidence exists.
  try {
    const braveOutcome = await enrichPartnerFromBrave(db, {
      id: samplePartnerId,
      company_name: orgName,
      contact_name: operatorFullName,
    });
    enrichmentReport.brave = {
      status: braveOutcome.status,
      message: braveOutcome.message,
    };
    if (enrichmentReport.source_used === 'linkedin' && (braveOutcome.status === 'success' || braveOutcome.status === 'partial')) {
      enrichmentReport.source_used = 'both';
    } else if (braveOutcome.status === 'success' || braveOutcome.status === 'partial') {
      enrichmentReport.source_used = 'brave';
    }
  } catch (err) {
    enrichmentReport.brave = {
      status: 'failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // Re-fetch the sample partner so the renderer sees whatever the
  // enrichment passes wrote (profile_recent_posts, firm_recent_news, etc).
  const { data: enrichedPartner } = await db
    .from('partners')
    .select('id, company_name, contact_name, contact_title, audience_overlap_notes, complementarity_notes, partner_readiness_notes, weighted_score, profile_recent_posts, profile_connected_at, profile_shared_connections_count, profile_engagement_flags, firm_recent_news, firm_named_deals, last_session_notes, category')
    .eq('id', samplePartnerId)
    .single();
  if (!enrichedPartner) {
    return NextResponse.json({ error: 'Sample prospect row vanished mid-flight' }, { status: 500 });
  }

  const renderPartner: RenderPartner = {
    id: enrichedPartner.id as string,
    company_name: enrichedPartner.company_name as string,
    contact_name: enrichedPartner.contact_name as string,
    contact_title: enrichedPartner.contact_title as string,
    audience_overlap_notes: (enrichedPartner.audience_overlap_notes as string) || null,
    complementarity_notes: (enrichedPartner.complementarity_notes as string) || null,
    partner_readiness_notes: (enrichedPartner.partner_readiness_notes as string) || null,
    weighted_score: (enrichedPartner.weighted_score as number) || null,
    profile_recent_posts: enrichedPartner.profile_recent_posts,
    profile_connected_at: (enrichedPartner.profile_connected_at as string) || null,
    profile_shared_connections_count: (enrichedPartner.profile_shared_connections_count as number) || null,
    profile_engagement_flags: enrichedPartner.profile_engagement_flags,
    firm_recent_news: enrichedPartner.firm_recent_news,
    firm_named_deals: enrichedPartner.firm_named_deals,
    operator_notes: (enrichedPartner.last_session_notes as string) || null,
    offering_kind: 'product',
    offering_context: {
      name: SAMPLE_OFFERING.name,
      pitch: SAMPLE_OFFERING.pitch,
      sector: SAMPLE_OFFERING.sector,
      geography: SAMPLE_OFFERING.geography,
      recipient_geography: null,
      pitch_deck_url: null,
      one_pager_url: null,
    },
  };

  const renderContext: RenderContext = {
    sender_name: org.sender_name as string,
    sender_role: org.sender_role as string,
    signature_block: (org.signature_block as string) || null,
    sender_linkedin_url: (org.sender_linkedin_url as string) || null,
    sender_bio_one_liner: (org.sender_bio_one_liner as string) || null,
    sender_calendar_url: (org.sender_calendar_url as string) || null,
  };

  let rendered;
  try {
    rendered = await renderStep('sample_self_email', renderPartner, renderContext, SAMPLE_TEMPLATE);
  } catch (err) {
    return NextResponse.json(
      { error: `Render failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  if (!rendered.ok) {
    // Even renderer refusal is informative — return it so the UI can
    // explain WHY the sample couldn't produce a draft (same diagnostic
    // language as the prospects table).
    return NextResponse.json({
      ok: false,
      error: `Renderer declined: ${rendered.reason}`,
      blocker: rendered.blocker,
      enrichment: enrichmentReport,
      hint:
        rendered.blocker === 'no_credit_signal'
          ? 'Public signal on you was too thin for the model to write something grounded. Try adding a richer bio one-liner in /settings, or post something on LinkedIn so there\'s a recent post to anchor on.'
          : 'Renderer refused to produce a sample. Check /settings to confirm your sender identity is complete.',
    });
  }

  // Send via Resend. RESEND_FROM_EMAIL must be configured (CLAUDE.md
  // global rule: updates.corporateaisolutions.com sender). If not, we
  // still return the rendered draft inline so the operator can see what
  // would have been sent.
  const sendResult = await sendEmail({
    to: operatorEmail,
    subject: rendered.subject || `Sample InvestorPilot draft for ${operatorFullName}`,
    body: rendered.body,
  });

  const hintParts: string[] = [];
  if (sendResult.id) {
    hintParts.push(`Sent to ${operatorEmail} — check your inbox in ~30s.`);
  } else if (sendResult.error) {
    hintParts.push(`Email send failed: ${sendResult.error}. The rendered draft is shown below — fix RESEND_FROM_EMAIL in env and retry.`);
  }
  if (enrichmentReport.linkedin?.posts_fetched_count) {
    hintParts.push(`LinkedIn enrichment pulled ${enrichmentReport.linkedin.posts_fetched_count} recent posts from your profile.`);
  } else if (enrichmentReport.linkedin?.status === 'failed' || !linkedinAccountId) {
    hintParts.push(linkedinAccountId
      ? 'LinkedIn deep-read failed for your URL — check the URL or your Unipile channel.'
      : 'No active LinkedIn channel connected, so LinkedIn enrichment was skipped. Connect one in /channels to see the full picture.',
    );
  }
  if (enrichmentReport.brave?.status === 'success' || enrichmentReport.brave?.status === 'partial') {
    hintParts.push('Brave firm-news pass succeeded.');
  } else if (enrichmentReport.brave?.status === 'failed' || enrichmentReport.brave?.status === 'unavailable') {
    hintParts.push(`Brave firm-news returned no signal on "${orgName}" — if that's surprising, your org name in /settings may not match how the firm is referenced online.`);
  }

  return NextResponse.json({
    ok: true,
    enrichment: enrichmentReport,
    rendered: {
      subject: rendered.subject,
      body: rendered.body,
      personalization_score: rendered.personalization_score,
      evidence_refs: rendered.evidence_refs,
    },
    sent: {
      id: sendResult.id,
      error: sendResult.error,
      to: operatorEmail,
    },
    hint: hintParts.join(' '),
  });
}
