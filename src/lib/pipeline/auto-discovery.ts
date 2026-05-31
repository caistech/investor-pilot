import { createServiceClient } from '@/lib/supabase/server';

export async function sendProductCreatedEmail(
  email: string,
  productName: string,
  timestamp: string
): Promise<void> {
  const subject = `✅ Product Created in InvestorPilot: ${productName}`;
  const body = `
Your product has been successfully created in InvestorPilot from the Corporate AI Solutions Pipeline.

**Product:** ${productName}
**Created:** ${timestamp}

The following product is now available:
- ${productName} (Distributor)

If data completeness is sufficient, automated discovery will begin shortly.

Best regards,
Corporate AI Solutions
  `.trim();

  await sendEmail(email, subject, body);
}

export async function triggerAutoDiscovery(
  organisationId: string,
  distributorProductId: string,
  endUserProductId: string | null,   // null = distributor-only intake; skip end-user discovery
  createdByEmail: string,
  productName: string
): Promise<void> {
  console.log('[auto-discovery] Starting for org:', organisationId);

  const db = createServiceClient();

  const { data: profile } = await db
    .from('profiles')
    .select('id')
    .eq('email', createdByEmail)
    .maybeSingle();

  const userId = profile?.id || null;

  const distributorJob = await db.from('discovery_jobs').insert({
    organisation_id: organisationId,
    product_id: distributorProductId,
    created_by_user_id: userId,
    status: 'pending',
    params: {
      product_id: distributorProductId,
      query_count: 5,
      sources: ['brave', 'linkedin'],
      enrich_with_brave: true,
      max_total_candidates: 50,
    },
  }).select().single();

  // End-user discovery only runs when an end-user product was supplied.
  // Distributor-only intake passes null — we skip the end-user job entirely
  // (the end-user side is B2C with no discovery motion).
  let endUserJobId: string | null = null;
  if (endUserProductId) {
    const endUserJob = await db.from('discovery_jobs').insert({
      organisation_id: organisationId,
      product_id: endUserProductId,
      created_by_user_id: userId,
      status: 'pending',
      params: {
        product_id: endUserProductId,
        query_count: 5,
        sources: ['brave', 'linkedin'],
        enrich_with_brave: true,
        max_total_candidates: 50,
      },
    }).select().single();
    endUserJobId = endUserJob.data?.id ?? null;
  }

  console.log('[auto-discovery] Discovery jobs created:', distributorJob.data?.id, endUserJobId);

  if (distributorJob.data?.id) {
    pollForCompletion(
      organisationId,
      distributorJob.data.id,
      endUserJobId,
      productName,
      createdByEmail
    ).catch(err => console.error('[auto-discovery] polling error:', err));
  }
}

async function pollForCompletion(
  organisationId: string,
  distributorJobId: string,
  endUserJobId: string | null,   // null = distributor-only; no end-user job to wait on
  productName: string,
  notifyEmail: string
): Promise<void> {
  const db = createServiceClient();
  const maxAttempts = 60;
  const intervalMs = 10000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, intervalMs));

    const jobIds = endUserJobId ? [distributorJobId, endUserJobId] : [distributorJobId];
    const { data: jobs } = await db
      .from('discovery_jobs')
      .select('id, status, result, product_id')
      .in('id', jobIds);

    if (!jobs) continue;

    const distributor = jobs.find(j => j.id === distributorJobId);
    const endUser = endUserJobId ? jobs.find(j => j.id === endUserJobId) : null;

    // Distributor-only: complete when the distributor job completes. With an
    // end-user job, require both.
    const allComplete =
      distributor?.status === 'completed' &&
      (!endUserJobId || endUser?.status === 'completed');

    if (allComplete && distributor) {
      console.log('[auto-discovery] Discovery complete (endUser:', !!endUserJobId, ')');

      const productIds = [distributor.product_id];
      if (endUser?.product_id) productIds.push(endUser.product_id);

      const { data: products } = await db
        .from('products')
        .select('id, name')
        .in('id', productIds);

      const distributorProduct = products?.find(p => p.id === distributor.product_id);

      const { count: distributorProspects } = await db
        .from('partners')
        .select('*', { count: 'exact', head: true })
        .eq('organisation_id', organisationId)
        .eq('distributor_product_id', distributor.product_id)
        .eq('status', 'draft_ready');

      let endUserSummary: { name: string; prospectsFound: number } | undefined;
      if (endUser?.product_id) {
        const endUserProduct = products?.find(p => p.id === endUser.product_id);
        const { count: endUserProspects } = await db
          .from('partners')
          .select('*', { count: 'exact', head: true })
          .eq('organisation_id', organisationId)
          .eq('end_user_product_id', endUser.product_id)
          .eq('status', 'draft_ready');
        endUserSummary = {
          name: endUserProduct?.name || 'End Users',
          prospectsFound: endUserProspects || 0,
        };
      }

      await sendSearchCompleteEmail(notifyEmail, productName, {
        distributor: {
          name: distributorProduct?.name || 'Distributor',
          prospectsFound: distributorProspects || 0,
        },
        endUser: endUserSummary,
      });

      pollForDrafts(
        organisationId,
        distributor.product_id,
        endUser?.product_id ?? null,
        productName,
        notifyEmail
      ).catch(err => console.error('[auto-discovery] draft polling error:', err));

      return;
    }

    if (distributor?.status === 'failed' || (endUserJobId && endUser?.status === 'failed')) {
      console.log('[auto-discovery] Job failed');
      await sendErrorEmail(notifyEmail, productName, 'Discovery failed');
      return;
    }

    console.log('[auto-discovery] Still running... attempt', attempt + 1);
  }
}

async function pollForDrafts(
  organisationId: string,
  distributorProductId: string,
  endUserProductId: string | null,   // null = distributor-only
  productName: string,
  notifyEmail: string
): Promise<void> {
  const db = createServiceClient();
  const maxAttempts = 60;
  const intervalMs = 5000;

  const productIds = endUserProductId
    ? [distributorProductId, endUserProductId]
    : [distributorProductId];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, intervalMs));

    const { count: totalDrafts } = await db
      .from('partners')
      .select('*', { count: 'exact', head: true })
      .eq('organisation_id', organisationId)
      .in('product_id', productIds)
      .eq('status', 'draft_ready');

    if ((totalDrafts || 0) > 0) {
      console.log('[auto-discovery] Drafts ready:', totalDrafts);

      const { data: prospects } = await db
        .from('partners')
        .select('id, name, company_name, contact_name, contact_email, email_source, network_distance, product_id')
        .eq('organisation_id', organisationId)
        .in('product_id', productIds)
        .eq('status', 'draft_ready')
        .limit(20);

      const distributorProspects = prospects?.filter(p => p.product_id === distributorProductId) || [];
      const endUserProspects = endUserProductId
        ? (prospects?.filter(p => p.product_id === endUserProductId) || [])
        : [];

      await sendDraftsReadyEmail(notifyEmail, productName, {
        distributor: distributorProspects.map(p => ({
          name: p.contact_name || p.name,
          company: p.company_name,
          email: p.contact_email,
          source: p.email_source || 'unknown',
          connectionLevel: p.network_distance || 'unknown',
        })),
        endUser: endUserProspects.map(p => ({
          name: p.contact_name || p.name,
          company: p.company_name,
          email: p.contact_email,
          source: p.email_source || 'unknown',
          connectionLevel: p.network_distance || 'unknown',
        })),
      });

      return;
    }
  }
}

async function sendSearchCompleteEmail(
  email: string,
  productName: string,
  results: {
    distributor: { name: string; prospectsFound: number };
    endUser?: { name: string; prospectsFound: number };
  }
): Promise<void> {
  const subject = `🔍 Discovery Complete: ${productName}`;
  const endUserBlock = results.endUser
    ? `

**End-User Search:**
- Prospects found: ${results.endUser.prospectsFound}`
    : '';
  const body = `
Discovery search completed for ${productName}.

**Distributor Search:**
- Prospects found: ${results.distributor.prospectsFound}${endUserBlock}

Next step: Drafts are being prepared for your approval. You'll receive another email when drafts are ready to review.

Best regards,
Corporate AI Solutions
  `.trim();

  await sendEmail(email, subject, body);
}

async function sendDraftsReadyEmail(
  email: string,
  productName: string,
  prospects: {
    distributor: Array<{ name: string; company: string; email: string | null; source: string; connectionLevel: string }>;
    endUser: Array<{ name: string; company: string; email: string | null; source: string; connectionLevel: string }>;
  }
): Promise<void> {
  const formatProspect = (p: typeof prospects.distributor[0]) =>
    `- ${p.name}${p.company ? ` (${p.company})` : ''}${p.email ? ` - ${p.email}` : ''} [${p.source}]`;

  const endUserBlock = prospects.endUser.length > 0
    ? `

**End-User Prospects (${prospects.endUser.length}):**
${prospects.endUser.slice(0, 10).map(formatProspect).join('\n')}${prospects.endUser.length > 10 ? `\n...and ${prospects.endUser.length - 10} more` : ''}`
    : '';

  const subject = `✉️ Drafts Ready for Approval: ${productName}`;
  const body = `
Your outreach drafts are ready for review!

**Product:** ${productName}

**Distributor Prospects (${prospects.distributor.length}):**
${prospects.distributor.slice(0, 10).map(formatProspect).join('\n')}${prospects.distributor.length > 10 ? `\n...and ${prospects.distributor.length - 10} more` : ''}${endUserBlock}

Review and approve drafts at: https://investorpilot.ai/approvals

Best regards,
Corporate AI Solutions
  `.trim();

  await sendEmail(email, subject, body);
}

async function sendErrorEmail(
  email: string,
  productName: string,
  error: string
): Promise<void> {
  const subject = `⚠️ Pipeline Issue: ${productName}`;
  const body = `
There was an issue processing ${productName}:

Error: ${error}

Please check the product in InvestorPilot and try again if needed.

Best regards,
Corporate AI Solutions
  `.trim();

  await sendEmail(email, subject, body);
}

async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  try {
    const res = await fetch(process.env.SITE_URL + '/api/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to,
        subject,
        body,
        from: 'noreply@corporateaisolutions.com',
      }),
    });
    console.log('[email] Sent to', to, 'status:', res.status);
  } catch (err) {
    console.error('[email] Failed:', err);
  }
}