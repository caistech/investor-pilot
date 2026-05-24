import { NextRequest, NextResponse } from 'next/server';
import { authenticateMethodologyApiKey } from '@/lib/methodology/auth';
import { braveWebSearch } from '@/lib/agent/brave-tools';
import { findContactByDomain } from '@/lib/agent/email-finder';
import { upsertPartner, saveDraft } from '@/lib/db/partners';
import { claudeClient as client, claudeModel as MODEL } from '@/lib/llm/client';
import { meterTokens } from '@/lib/usage/events';

/**
 * POST /api/methodology/campaigns/[id]/activate
 *
 * Runs a methodology validation campaign through IP's existing discovery +
 * outreach engine. For the campaign's ICP it:
 *   1. discovers prospects (Brave) and tags them with methodology_campaign_id,
 *   2. enriches a contact email (Hunter/Apollo cascade), best-effort,
 *   3. drafts a research INVITE (one Claude call per prospect) that embeds the
 *      Connexions voice-interview link + the thin-MVP url and teases 1–2 of the
 *      campaign's research questions — research framing, never a pitch,
 *   4. leaves each prospect at status 'draft_ready'.
 *
 * It does NOT send. A human reviews the drafts and sends them via the normal
 * IP outreach UI (the locked human-in-the-loop step). Responses come back via
 * the Connexions voice loop (post-call webhook → CAS sync), NOT via IP replies.
 *
 * Auth: METHODOLOGY_API_KEY Bearer token (called by CAS at Gate-1 kick-off).
 *
 * Requires the campaign to carry `ip_org_id` (the IP org that hosts the research
 * prospects + where the human approves) and ideally `connexions_interview_url` +
 * `mvp_url` (set by CAS at campaign creation). Without ip_org_id the route can't
 * place prospects, so it returns 409 with a clear message.
 */

interface MethodologyCampaignRow {
  id: string;
  cas_product_slug: string;
  campaign_type: 'target-user' | 'distributor-candidate';
  icp_description: string;
  questions: string[];
  expected_response_count: number;
  status: string;
  ip_org_id: string | null;
  mvp_url: string | null;
  connexions_interview_url: string | null;
}

// Cap discovery per activation — keeps Brave/Hunter/LLM spend bounded and
// matches the methodology's low-volume, operator-triggered cadence.
const MAX_PROSPECTS = 12;

function buildInvitePrompt(campaign: MethodologyCampaignRow): string {
  const audience =
    campaign.campaign_type === 'distributor-candidate'
      ? 'a potential distributor / channel partner (an operator who could onsell this to their own clients)'
      : 'a potential end-user of the product';
  const teaser = campaign.questions.slice(0, 2).map((q, i) => `${i + 1}. ${q}`).join('\n');

  return `You write short, warm, RESEARCH outreach invites — never sales pitches. The recipient is ${audience} for an early-stage idea called "${campaign.cas_product_slug}".

ICP context: ${campaign.icp_description}

Your job: invite them to a 5-minute voice conversation to share their view. This is research, not selling.

HARD RULES:
- Do NOT pitch, promise outcomes, or claim the product exists yet ("we're exploring building...").
- No pricing, no "exclusive offer", no hype, no AI clichés ("revolutionise", "game-changer", "in today's fast-paced world").
- Be specific and human. Under 110 words in the body.
- The single call-to-action is the voice-interview link${campaign.mvp_url ? '; you may also mention they can take an early look at the prototype link' : ''}.
- Reference one of the research questions below to show it's genuinely about their world.

Research questions (teaser, do not list all):
${teaser || '(none provided)'}

Links to weave in naturally:
- Voice interview (the CTA): ${campaign.connexions_interview_url || '[INTERVIEW_LINK_MISSING]'}
${campaign.mvp_url ? `- Early prototype look (optional): ${campaign.mvp_url}` : ''}

Return ONLY JSON: {"subject": "...", "body": "..."}. The body is plain text (line breaks allowed), addressed to the contact, signed "— The ${campaign.cas_product_slug} research team".`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = authenticateMethodologyApiKey(request);
  if (!auth.ok) return auth.error;

  const campaignId = params.id;
  if (!campaignId || !/^[0-9a-f-]{36}$/i.test(campaignId)) {
    return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 });
  }

  // methodology_campaigns is not in the generated types; the service client is
  // untyped at runtime. Cast narrowly for the reads/writes we do here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.db as any;

  const { data: campaign, error: loadErr } = await db
    .from('methodology_campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();

  if (loadErr || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  const c = campaign as MethodologyCampaignRow;

  if (!c.ip_org_id) {
    return NextResponse.json(
      {
        error:
          'Campaign has no ip_org_id — set the IP organisation that hosts the research prospects (and where the human approves outreach) before activation.',
      },
      { status: 409 },
    );
  }
  if (!c.connexions_interview_url) {
    return NextResponse.json(
      {
        error:
          'Campaign has no connexions_interview_url — the invite has nothing to point respondents at. Run the CAS validate step (which creates the Connexions panel) first.',
      },
      { status: 409 },
    );
  }

  const orgId = c.ip_org_id;
  const meterFor = { organisation_id: orgId, route: '/api/methodology/campaigns/[id]/activate' };

  // 1. Discover prospects for the ICP. v1: use the ICP text as the Brave query
  //    (truncated). Discovery quality can be sharpened later with an LLM-derived
  //    query; this gets the loop running.
  const query = c.icp_description.slice(0, 180);
  let candidates: { name: string; domain: string; description: string }[] = [];
  try {
    const searchResults = await braveWebSearch(query, 15, undefined, meterFor);
    const seen = new Set<string>();
    for (const r of searchResults) {
      let domain: string;
      try {
        domain = new URL(r.url).hostname.replace(/^www\./, '');
      } catch {
        continue;
      }
      if (seen.has(domain)) continue;
      seen.add(domain);
      candidates.push({
        name: r.title.split(' - ')[0].split(' | ')[0].trim(),
        domain,
        description: r.description,
      });
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Discovery failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  candidates = candidates.slice(0, MAX_PROSPECTS);
  if (candidates.length === 0) {
    return NextResponse.json(
      { error: 'No prospects found for this ICP. Refine icp_description and retry.' },
      { status: 400 },
    );
  }

  const results: Array<{ company: string; domain: string; status: string; has_email: boolean; error?: string }> = [];

  for (const cand of candidates) {
    try {
      // 2. Enrich a contact email (best-effort; partner still lands if Hunter misses).
      //    FoundContact fields: contact_name / contact_email / email_confidence / source.
      const contact = await findContactByDomain(cand.domain, { meterFor });
      const hasEmail = !!contact?.contact_email;

      // 3. Tag the prospect to this campaign + org.
      const up = await upsertPartner(db, {
        organisation_id: orgId,
        company_name: cand.name,
        domain: cand.domain,
        status: 'scored',
        source: 'brave',
        methodology_campaign_id: c.id,
        contact_name: contact?.contact_name ?? undefined,
        contact_email: contact?.contact_email ?? null,
        email_confidence: contact?.email_confidence ?? null,
        email_status: contact ? (contact.email_confidence >= 70 ? 'verified' : 'probable') : null,
        contact_source: contact ? (contact.source === 'apollo' ? 'apollo_enrich' : 'hunter_domain_search') : undefined,
      });
      if (up.status === 'error') {
        results.push({ company: cand.name, domain: cand.domain, status: 'error', has_email: hasEmail, error: up.error });
        continue;
      }

      // 4. Draft the research invite — one Claude call per prospect (IP rule).
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 600,
        system: buildInvitePrompt(c),
        messages: [{
          role: 'user',
          content: `Contact company: ${cand.name} (${cand.domain})${contact?.contact_name ? `, contact: ${contact.contact_name}` : ''}\nWhat they do: ${cand.description || 'unknown'}\n\nWrite the research invite for this specific recipient.`,
        }],
      });
      meterTokens(meterFor, response, MODEL);

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        results.push({ company: cand.name, domain: cand.domain, status: 'draft_failed', has_email: hasEmail, error: 'invalid draft response' });
        continue;
      }
      const draft = JSON.parse(jsonMatch[0]) as { subject?: string; body?: string };
      if (!draft.subject || !draft.body) {
        results.push({ company: cand.name, domain: cand.domain, status: 'draft_failed', has_email: hasEmail, error: 'draft missing subject/body' });
        continue;
      }

      const saved = await saveDraft(db, orgId, cand.domain, {
        draft_subject: draft.subject,
        draft_body: draft.body,
      });
      results.push({
        company: cand.name,
        domain: cand.domain,
        status: saved.status === 'error' ? 'error' : 'draft_ready',
        has_email: hasEmail,
        error: saved.status === 'error' ? saved.error : undefined,
      });
    } catch (err) {
      results.push({ company: cand.name, domain: cand.domain, status: 'error', has_email: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const drafted = results.filter(r => r.status === 'draft_ready').length;
  const withEmail = results.filter(r => r.has_email).length;

  // 5. Advance campaign lifecycle. 'sending' = drafts ready, awaiting human
  //    approval + send (we do NOT auto-send).
  await db
    .from('methodology_campaigns')
    .update({ status: 'sending', ip_org_id: orgId })
    .eq('id', c.id);

  return NextResponse.json({
    campaign_id: c.id,
    campaign_type: c.campaign_type,
    discovered: results.length,
    drafted,
    with_email: withEmail,
    awaiting_approval: drafted,
    note: 'Drafts are queued at draft_ready. Review + send in the IP outreach UI (nothing was sent). Responses return via the Connexions voice interview.',
    results,
  });
}
