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
  /** ≥1 client_channels with status='active' (any type) */
  channelConnected: boolean;
  /** ≥1 active client_channels with channel_type='linkedin' — required for LinkedIn / Sales Navigator discovery sources */
  linkedInChannelConnected: boolean;
  /** ≥1 active client_channels with channel_type='email' — required to actually send email steps */
  emailChannelConnected: boolean;
  /** ≥1 sequence_templates with is_active=true */
  sequenceConfigured: boolean;
  /** Convenience — true when every required prerequisite is met */
  allDone: boolean;
  /** The first active product's id, if any. Lets UI deep-link to /products?focus= */
  primaryProductId: string | null;
}

export const REQUIRED_FOR_DISCOVERY = ['hasActiveProduct', 'productPitchConfigured', 'rubricConfigured'] as const;
export const REQUIRED_FOR_SEQUENCE = ['senderConfigured', 'hasActiveProduct', 'productPitchConfigured'] as const;
export const REQUIRED_FOR_SENDING = ['senderConfigured', 'channelConnected', 'sequenceConfigured'] as const;

export async function getSetupState(orgId: string): Promise<SetupState> {
  const db = createServiceClient();

  const [
    { data: org },
    { data: primaryProduct },
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
    // Pull channel rows (not just count) so we can distinguish LinkedIn from
    // email — Find Investors gates on LinkedIn specifically.
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
  const channels = activeChannels ?? [];
  const channelConnected = channels.length > 0;
  const linkedInChannelConnected = channels.some((c) => c.channel_type === 'linkedin');
  const emailChannelConnected = channels.some((c) => c.channel_type === 'email');
  const sequenceConfigured = (activeSequenceCount ?? 0) > 0;

  return {
    senderConfigured,
    hasActiveProduct,
    productPitchConfigured,
    rubricConfigured,
    channelConnected,
    linkedInChannelConnected,
    emailChannelConnected,
    sequenceConfigured,
    allDone:
      senderConfigured &&
      hasActiveProduct &&
      productPitchConfigured &&
      rubricConfigured &&
      channelConnected &&
      sequenceConfigured,
    primaryProductId: primaryProduct?.id ?? null,
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
  if (!state.hasActiveProduct) {
    gaps.push({ key: 'hasActiveProduct', label: 'At least one active product', href: '/products' });
  } else if (!state.productPitchConfigured) {
    gaps.push({ key: 'productPitchConfigured', label: 'Product pitch (one-line is enough)', href: '/products' });
  }
  if (state.hasActiveProduct && !state.rubricConfigured) {
    gaps.push({ key: 'rubricConfigured', label: 'ICP scoring rubric (generate on the product card)', href: '/products' });
  }
  if (!state.channelConnected) {
    gaps.push({ key: 'channelConnected', label: 'A connected LinkedIn or email channel', href: '/channels' });
  }
  if (state.hasActiveProduct && state.productPitchConfigured && !state.sequenceConfigured) {
    gaps.push({ key: 'sequenceConfigured', label: 'Outreach sequence (generate on the product card)', href: '/products' });
  }
  return gaps;
}
