import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import { braveWebSearch } from './brave-tools';
import { hunterEmailFinder, hunterDomainSearch } from './hunter-tools';
import { saveMemory } from './memory';

export interface ToolContext {
  db: SupabaseClient;
  sessionId: string;
  organisationId: string;
  productId: string;
}

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'brave_search',
    description: 'Search the web using Brave Search. Use to find partner companies, research websites, find team members, verify partnership signals.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'The search query' },
        count: { type: 'number', description: 'Number of results (1-20, default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'hunter_email_finder',
    description: "Find a specific person's email using Hunter.io. Requires first name, last name, and company domain.",
    input_schema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'Company domain (e.g. "example.com.au")' },
        first_name: { type: 'string', description: 'Contact first name' },
        last_name: { type: 'string', description: 'Contact last name' },
      },
      required: ['domain', 'first_name', 'last_name'],
    },
  },
  {
    name: 'hunter_domain_search',
    description: 'Find email addresses associated with a domain. Use as fallback when you don\'t have a specific name.',
    input_schema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'Company domain to search' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'save_partner',
    description: 'Save or update a partner company record. Upserts by domain within the organisation. Use after scoring or screening a candidate.',
    input_schema: {
      type: 'object' as const,
      properties: {
        company_name: { type: 'string' },
        domain: { type: 'string' },
        category: { type: 'string' },
        partner_type: { type: 'string', enum: ['referral', 'integration', 'reseller', 'combination'] },
        status: { type: 'string', enum: ['scored', 'contact_found', 'contact_partial', 'angle_defined', 'draft_ready'] },
        weighted_score: { type: 'number' },
        confidence_score: { type: 'string', enum: ['normal', 'low-confidence'] },
        audience_overlap_score: { type: 'number' },
        audience_overlap_notes: { type: 'string' },
        complementarity_score: { type: 'number' },
        complementarity_notes: { type: 'string' },
        partner_readiness_score: { type: 'number' },
        partner_readiness_notes: { type: 'string' },
        reachability_score: { type: 'number' },
        reachability_notes: { type: 'string' },
        strategic_leverage_score: { type: 'number' },
        strategic_leverage_notes: { type: 'string' },
        screened_out: { type: 'boolean' },
        screened_out_reason: { type: 'string' },
      },
      required: ['company_name', 'domain'],
    },
  },
  {
    name: 'save_contact',
    description: 'Save contact information for a partner. Only overwrites existing contact if new confidence is higher.',
    input_schema: {
      type: 'object' as const,
      properties: {
        partner_domain: { type: 'string', description: 'Domain of the partner to update' },
        contact_name: { type: 'string' },
        contact_title: { type: 'string' },
        contact_email: { type: 'string' },
        contact_linkedin: { type: 'string' },
        email_confidence: { type: 'number' },
        email_status: { type: 'string', enum: ['verified', 'probable', 'company_level', 'unresolved'] },
        contact_source: { type: 'string' },
        partnership_motion: { type: 'string' },
        selected_gtm_angle: { type: 'string' },
      },
      required: ['partner_domain'],
    },
  },
  {
    name: 'save_draft',
    description: 'Save an outreach email draft for a partner. Sets status to draft_ready.',
    input_schema: {
      type: 'object' as const,
      properties: {
        partner_domain: { type: 'string', description: 'Domain of the partner' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body' },
        partnership_motion: { type: 'string' },
        selected_gtm_angle: { type: 'string' },
      },
      required: ['partner_domain', 'subject', 'body'],
    },
  },
  {
    name: 'emit_event',
    description: 'Emit a status event to the user interface. Use to show progress, analysis, or findings.',
    input_schema: {
      type: 'object' as const,
      properties: {
        event_type: { type: 'string', description: 'Event type (e.g. categories_generated, partner_scored, contact_found, motion_selected, draft_created, candidate_screened_out, stage_progress)' },
        event_data: { type: 'object', description: 'Event payload to display' },
      },
      required: ['event_type', 'event_data'],
    },
  },
  {
    name: 'request_approval',
    description: 'Pause and ask the user for approval before continuing. Use at decision points in guided mode.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message: { type: 'string', description: 'What to review/approve' },
        approval_type: { type: 'string', enum: ['categories', 'candidates', 'scores', 'contacts', 'motions', 'drafts'] },
      },
      required: ['message', 'approval_type'],
    },
  },
  {
    name: 'save_memory',
    description: 'Save an important insight or decision for future reference. Use when you discover something worth remembering across conversation chunks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        memory_type: { type: 'string', enum: ['partner_insight', 'decision', 'screening_reason', 'contact_note', 'draft_feedback'] },
        content: { type: 'string', description: 'What to remember' },
        importance: { type: 'number', description: 'Importance 1-10 (default 5)' },
      },
      required: ['memory_type', 'content'],
    },
  },
];

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  context: ToolContext
): Promise<unknown> {
  try {
    switch (name) {
      case 'brave_search': {
        const results = await braveWebSearch(
          input.query as string,
          (input.count as number) || 5
        );
        return { results };
      }

      case 'hunter_email_finder': {
        const result = await hunterEmailFinder(
          input.domain as string,
          input.first_name as string,
          input.last_name as string
        );
        return result || { error: 'No email found for this person' };
      }

      case 'hunter_domain_search': {
        const result = await hunterDomainSearch(input.domain as string);
        return result || { error: 'No emails found for this domain' };
      }

      case 'save_partner': {
        const { data: existing } = await context.db
          .from('partners')
          .select('id')
          .eq('organisation_id', context.organisationId)
          .eq('domain', input.domain)
          .single();

        const partnerData = {
          organisation_id: context.organisationId,
          product_id: context.productId,
          company_name: input.company_name,
          domain: input.domain,
          category: input.category || null,
          partner_type: input.partner_type || 'referral',
          status: input.status || 'scored',
          weighted_score: input.weighted_score || null,
          confidence_score: input.confidence_score || null,
          audience_overlap_score: input.audience_overlap_score || null,
          audience_overlap_notes: input.audience_overlap_notes || null,
          complementarity_score: input.complementarity_score || null,
          complementarity_notes: input.complementarity_notes || null,
          partner_readiness_score: input.partner_readiness_score || null,
          partner_readiness_notes: input.partner_readiness_notes || null,
          reachability_score: input.reachability_score || null,
          reachability_notes: input.reachability_notes || null,
          strategic_leverage_score: input.strategic_leverage_score || null,
          strategic_leverage_notes: input.strategic_leverage_notes || null,
          screened_out: input.screened_out || false,
          screened_out_reason: input.screened_out_reason || null,
          last_updated_at: new Date().toISOString(),
        };

        if (existing) {
          const { error: updateErr } = await context.db.from('partners').update(partnerData).eq('id', existing.id);
          if (updateErr) {
            console.error('[TOOL] save_partner update failed:', updateErr.message);
            return { status: 'error', error: updateErr.message };
          }
          return { status: 'updated', partner_id: existing.id };
        } else {
          const { data, error: insertErr } = await context.db.from('partners').insert(partnerData).select('id').single();
          if (insertErr) {
            console.error('[TOOL] save_partner insert failed:', insertErr.message);
            return { status: 'error', error: insertErr.message };
          }
          return { status: 'created', partner_id: data?.id };
        }
      }

      case 'save_contact': {
        // Try exact match first, then fuzzy domain matching
        const domain = (input.partner_domain as string || '').replace(/^www\./, '');
        let { data: partner } = await context.db
          .from('partners')
          .select('id, email_confidence')
          .eq('organisation_id', context.organisationId)
          .eq('domain', domain)
          .single();

        // Fallback: try with www. prefix or ilike
        if (!partner) {
          const { data: fuzzy } = await context.db
            .from('partners')
            .select('id, email_confidence')
            .eq('organisation_id', context.organisationId)
            .or(`domain.eq.www.${domain},domain.ilike.%${domain}%`)
            .limit(1)
            .single();
          partner = fuzzy;
        }

        if (!partner) return { error: `Partner not found for domain: ${input.partner_domain}` };

        const newConfidence = (input.email_confidence as number) || 0;
        const existingConfidence = partner.email_confidence || 0;

        if (newConfidence >= existingConfidence) {
          const updateData: Record<string, unknown> = {
            last_updated_at: new Date().toISOString(),
          };
          if (input.contact_name) updateData.contact_name = input.contact_name;
          if (input.contact_title) updateData.contact_title = input.contact_title;
          if (input.contact_email) updateData.contact_email = input.contact_email;
          if (input.contact_linkedin) updateData.contact_linkedin = input.contact_linkedin;
          if (input.email_confidence) updateData.email_confidence = input.email_confidence;
          if (input.email_status) updateData.email_status = input.email_status;
          if (input.contact_source) updateData.contact_source = input.contact_source;
          if (input.partnership_motion) updateData.partnership_motion = input.partnership_motion;
          if (input.selected_gtm_angle) updateData.selected_gtm_angle = input.selected_gtm_angle;
          if (input.contact_email) {
            updateData.status = 'contact_found';
          } else {
            updateData.status = 'contact_partial';
          }

          const { error: contactErr } = await context.db.from('partners').update(updateData).eq('id', partner.id);
          if (contactErr) {
            console.error('[TOOL] save_contact failed:', contactErr.message);
            return { status: 'error', error: contactErr.message };
          }
          return { status: 'updated', partner_id: partner.id };
        }

        return { status: 'skipped', reason: 'existing contact has higher confidence' };
      }

      case 'save_draft': {
        const draftDomain = (input.partner_domain as string || '').replace(/^www\./, '');
        let { data: partner } = await context.db
          .from('partners')
          .select('id')
          .eq('organisation_id', context.organisationId)
          .eq('domain', draftDomain)
          .single();

        if (!partner) {
          const { data: fuzzy } = await context.db
            .from('partners')
            .select('id')
            .eq('organisation_id', context.organisationId)
            .or(`domain.eq.www.${draftDomain},domain.ilike.%${draftDomain}%`)
            .limit(1)
            .single();
          partner = fuzzy;
        }

        if (!partner) return { error: `Partner not found for domain: ${input.partner_domain}` };

        const { error: draftErr } = await context.db.from('partners').update({
          draft_subject: input.subject,
          draft_body: input.body,
          draft_status: 'created',
          status: 'draft_ready',
          partnership_motion: input.partnership_motion || null,
          selected_gtm_angle: input.selected_gtm_angle || null,
          last_updated_at: new Date().toISOString(),
        }).eq('id', partner.id);

        if (draftErr) {
          console.error('[TOOL] save_draft failed:', draftErr.message);
          return { status: 'error', error: draftErr.message };
        }
        return { status: 'draft_saved', partner_id: partner.id };
      }

      case 'emit_event': {
        await context.db.from('session_events').insert({
          session_id: context.sessionId,
          partner_id: null,
          event_type: input.event_type,
          event_data: input.event_data,
        });
        return { status: 'emitted' };
      }

      case 'request_approval': {
        await context.db.from('session_events').insert({
          session_id: context.sessionId,
          partner_id: null,
          event_type: 'approval_required',
          event_data: { message: input.message, approval_type: input.approval_type },
        });
        return { status: 'approval_requested' };
      }

      case 'save_memory': {
        await saveMemory(
          context.db,
          context.sessionId,
          context.organisationId,
          input.memory_type as string,
          input.content as string,
          (input.importance as number) || 5
        );
        return { status: 'memory_saved' };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[TOOL] ${name} failed:`, message);
    return { error: message };
  }
}
