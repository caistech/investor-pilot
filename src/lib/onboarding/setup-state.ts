/**
 * Centralised setup-state computation.
 *
 * The dashboard, products card buttons, and the persistent setup banner
 * all read from this single function so they can't drift. Each check is
 * an independent boolean — callers decide which checks gate which action.
 *
 * Server-side only (uses the service-role Supabase client). Cheap to call:
 * 5 small queries against indexed columns, all in parallel.
 */

import { createServiceClient } from '@/lib/supabase/server';

export interface SetupState {
  /** organisations.sender_name + sender_role both filled */
  senderConfigured: boolean;
  /** ≥1 product with is_active=true */
  hasActiveProduct: boolean;
  /** primary active product has product_pitch OR one_sentence_description (enough for generators to run) */
  productPitchConfigured: boolean;
  /** primary active product has scoring_rubric (enough for discovery scoring) */
  rubricConfigured: boolean;
  /** ≥1 project with is_active=true (funding path — peer of hasActiveProduct) */
  hasActiveProject: boolean;
  /** primary active project has investment_thesis OR description */
  projectThesisConfigured: boolean;
  /** primary active project has scoring_rubric */
  projectRubricConfigured: boolean;
  /** ≥1 client_channels with status='active' (any type) */
  channelConnected: boolean;
  /** ≥1 active client_channels with channel_type='linkedin' — required for LinkedIn / Sales Navigator discovery sources */
  linkedInChannelConnected: boolean;
  /** ≥1 active client_channels with channel_type='email' — required to actually send email steps */
  emailChannelConnected: boolean;
  /** ≥1 sequence_templates with is_active=true */
  sequenceConfigured: boolean;
  /** True when at least one of (Products path | Projects path) is fully configured. */
  anyPathConfigured: boolean;
  /** Convenience — sender + channel + sequence + AT LEAST one path (product or project) */
  allDone: boolean;
  /** The first active product's id, if any. Lets UI deep-link to /products?focus= */
  primaryProductId: string | null;
  /** The first active project's id, if any. */
  primaryProjectId: string | null;
}

export const REQUIRED_FOR_DISCOVERY = ['hasActiveProduct', 'productPitchConfigured', 'rubricConfigured'] as const;
export const REQUIRED_FOR_SEQUENCE = ['senderConfigured', 'hasActiveProduct', 'productPitchConfigured'] as const;
export const REQUIRED_FOR_SENDING = ['senderConfigured', 'channelConnected', 'sequenceConfigured'] as const;

export async function getSetupState(orgId: string): Promise<SetupState> {
  const db = createServiceClient();

  const [
    { data: org },
    { data: primaryProduct },
    { data: primaryProject },
    { data: activeChannels },
    { count: activeSequenceCount },
  ] = await Promise.all([
    db.from('organisations').select('sender_name, sender_role').eq('id', orgId).maybeSingle(),
    db
      .from('products')
      .select('id, product_pitch, one_sentence_description, scoring_rubric')
      .eq('organisation_id', orgId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    db
      .from('projects')
      .select('id, investment_thesis, description, scoring_rubric')
      .eq('organisation_id', orgId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    db
      .from('client_channels')
      .select('channel_type')
      .eq('organisation_id', orgId)
      .eq('status', 'active'),
    db
      .from('sequence_templates')
      .select('*', { count: 'exact', head: true })
      .eq('organisation_id', orgId)
      .eq('is_active', true),
  ]);

  const senderConfigured = !!org?.sender_name && !!org?.sender_role;
  const hasActiveProduct = !!primaryProduct;
  const productPitchConfigured = !!(primaryProduct?.product_pitch || primaryProduct?.one_sentence_description);
  const rubricConfigured = !!primaryProduct?.scoring_rubric;
  const hasActiveProject = !!primaryProject;
  const projectThesisConfigured = !!(primaryProject?.investment_thesis || primaryProject?.description);
  const projectRubricConfigured = !!primaryProject?.scoring_rubric;
  const channels = activeChannels ?? [];
  const channelConnected = channels.length > 0;
  const linkedInChannelConnected = channels.some((c) => c.channel_type === 'linkedin');
  const emailChannelConnected = channels.some((c) => c.channel_type === 'email');
  const sequenceConfigured = (activeSequenceCount ?? 0) > 0;

  // A path is fully configured when EITHER the product side or the project
  // side has both pitch/thesis AND rubric set. Operators only need one to
  // start running discovery — they can fill the other later.
  const productPathConfigured = hasActiveProduct && productPitchConfigured && rubricConfigured;
  const projectPathConfigured = hasActiveProject && projectThesisConfigured && projectRubricConfigured;
  const anyPathConfigured = productPathConfigured || projectPathConfigured;

  return {
    senderConfigured,
    hasActiveProduct,
    productPitchConfigured,
    rubricConfigured,
    hasActiveProject,
    projectThesisConfigured,
    projectRubricConfigured,
    channelConnected,
    linkedInChannelConnected,
    emailChannelConnected,
    sequenceConfigured,
    anyPathConfigured,
    allDone:
      senderConfigured &&
      anyPathConfigured &&
      channelConnected &&
      sequenceConfigured,
    primaryProductId: primaryProduct?.id ?? null,
    primaryProjectId: primaryProject?.id ?? null,
  };
}

/**
 * Human-readable description of what's missing. Used by the setup banner
 * to render a single sentence — "you still need X, Y and Z before you
 * can send" — with deep-links per item.
 */
export interface SetupGap {
  key: keyof SetupState;
  label: string;
  href: string;
}

export function listSetupGaps(state: SetupState): SetupGap[] {
  const gaps: SetupGap[] = [];
  if (!state.senderConfigured) {
    gaps.push({ key: 'senderConfigured', label: 'Sender identity (name + role)', href: '/settings' });
  }
  // Dual-path gap: at least ONE of products or projects must be configured.
  // We don't push both — the operator chose their path. Suggest products
  // first since it's the more common default unless they've already
  // started a project.
  if (!state.anyPathConfigured) {
    if (state.hasActiveProject) {
      // Operator started a project — finish that path.
      if (!state.projectThesisConfigured) {
        gaps.push({ key: 'projectThesisConfigured', label: 'Project investment thesis (or description)', href: '/projects' });
      } else if (!state.projectRubricConfigured) {
        gaps.push({ key: 'projectRubricConfigured', label: 'Investor scoring rubric (generate on the project card)', href: '/projects' });
      }
    } else if (state.hasActiveProduct) {
      // Operator started a product — finish that path.
      if (!state.productPitchConfigured) {
        gaps.push({ key: 'productPitchConfigured', label: 'Product pitch (one-line is enough)', href: '/products' });
      } else if (!state.rubricConfigured) {
        gaps.push({ key: 'rubricConfigured', label: 'Customer ICP scoring rubric (generate on the product card)', href: '/products' });
      }
    } else {
      // Nothing started yet — surface both paths so they choose.
      gaps.push({ key: 'hasActiveProduct', label: 'Either a Product (for sales) or a Project (for funding)', href: '/dashboard' });
    }
  }
  if (!state.channelConnected) {
    gaps.push({ key: 'channelConnected', label: 'A connected LinkedIn or email channel', href: '/channels' });
  }
  if (state.anyPathConfigured && !state.sequenceConfigured) {
    const projectPathReady = state.hasActiveProject && state.projectThesisConfigured && state.projectRubricConfigured;
    const targetHref = projectPathReady ? '/projects' : '/products';
    gaps.push({ key: 'sequenceConfigured', label: 'Outreach sequence (generate on the product or project card)', href: targetHref });
  }
  return gaps;
}
