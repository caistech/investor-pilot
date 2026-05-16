/**
 * Per-page operator guidance — surfaced by the <PageGuide /> component
 * at the top of every dashboard page. Each entry answers three questions:
 *
 *   what_is        — what this page is for, in one line
 *   what_to_do     — the single most important action on this page
 *   what_to_expect — what changes after the action, where the result shows up
 *   next           — the natural next stage in the operator workflow
 *
 * Keep copy tight and concrete. No marketing voice. Lead with the verb.
 * Order of the keys here is the canonical operator journey — match the
 * sidebar grouping in src/components/layout/sidebar.tsx.
 */

export interface PageGuide {
  title: string;
  what_is: string;
  what_to_do: string;
  what_to_expect: string;
  next?: { href: string; label: string };
}

export const PAGE_GUIDES: Record<string, PageGuide> = {
  '/settings': {
    title: 'Settings',
    what_is: 'Your sender identity, primary product pitch, and ICP scoring rubric. Every outbound message and every prospect score reads from here.',
    what_to_do: 'Fill in your name, role and signature block. Then write a 2–3 sentence product pitch and define the ICP categories that count as a good fit.',
    what_to_expect: 'Drafts will use your sender details automatically. Discovery will score prospects against your ICP — high scores show up first in Prospects.',
    next: { href: '/products', label: 'Add your products' },
  },
  '/products': {
    title: 'Products',
    what_is: 'The product profiles the discovery engine pitches to investors. Each product has its own ICP, knowledge base, outreach pitch, and auto-generated outreach sequence.',
    what_to_do: 'Add a product — paste a URL and let auto-fill draft the ICP. Then click "Generate sequence" on the active product to create a 6-step LinkedIn + email sequence tailored to this pitch.',
    what_to_expect: 'Active products get a "Find Investors" button that runs a discovery batch and a "Generate sequence" button that writes the outreach copy. Both can be re-run anytime.',
    next: { href: '/projects', label: 'Group products into projects' },
  },
  '/projects': {
    title: 'Projects',
    what_is: 'Optional groupings of products under a single campaign or fund. Lets you report on outreach by initiative.',
    what_to_do: 'Create a project if you are running multiple products at once. Otherwise skip — products work on their own.',
    what_to_expect: 'Project filters appear in Prospects and Outreach so you can see funnel performance per initiative.',
    next: { href: '/channels', label: 'Connect a sending channel' },
  },
  '/channels': {
    title: 'Channels',
    what_is: 'LinkedIn and email accounts wired up via Unipile. Nothing sends until at least one is active.',
    what_to_do: 'Click Connect, complete the OAuth/QR flow, and toggle the channel Active. Connect both LinkedIn and email for the full sequence.',
    what_to_expect: 'Active channels become eligible for the send queue. The kill switch on this page pauses every channel in one click if anything looks off.',
    next: { href: '/discover', label: 'Find investor prospects' },
  },
  '/discover': {
    title: 'Discover',
    what_is: 'Runs a multi-query batch across LinkedIn and Brave to find investor prospects matching your product ICP.',
    what_to_do: 'Pick a product, pick the sources, and run. ~2–5 minutes. The engine scores every candidate 1–10 across five dimensions.',
    what_to_expect: 'New prospects land in Prospects, ranked by weighted score. Top-tier matches appear first.',
    next: { href: '/partners', label: 'Review scored prospects' },
  },
  '/partners': {
    title: 'Prospects',
    what_is: 'Every prospect the engine has found, with score, contact status and draft status. The pipeline view.',
    what_to_do: 'Filter by status. Open any prospect to see the score breakdown, enrich contacts, generate a draft, or queue for approval.',
    what_to_expect: 'Drafts you queue go to Approvals. Sent messages go to Outreach. Replies update the prospect status automatically.',
    next: { href: '/approvals', label: 'Approve queued drafts' },
  },
  '/approvals': {
    title: 'Approvals',
    what_is: 'Drafts waiting for your sign-off before they send. Nothing leaves the system without your OK.',
    what_to_do: 'Read each draft, edit inline if needed, then approve or skip. Approved drafts go to the send queue.',
    what_to_expect: 'Sent messages appear in Outreach. Replies route back to the prospect and trigger follow-up scheduling.',
    next: { href: '/outreach', label: 'Track sent messages' },
  },
  '/outreach': {
    title: 'Outreach',
    what_is: 'Every message sent and its current status — delivered, replied, bounced, follow-up due.',
    what_to_do: 'Watch reply rate and bounce rate. Click a row to open the conversation thread and respond.',
    what_to_expect: 'Follow-ups are queued automatically 7 days after the last send if there is no reply. Bounces flag the prospect for re-enrichment.',
    next: { href: '/sessions', label: 'See live conversations' },
  },
  '/sessions': {
    title: 'Sessions',
    what_is: 'Live reply threads. Each session is one prospect conversation with the messages exchanged.',
    what_to_do: 'Open a session to read the thread and reply manually. Quick-action buttons handle the common responses.',
    what_to_expect: 'Replies and your responses sync back to the prospect record and update funnel metrics.',
    next: { href: '/sequences', label: 'Review sequence templates' },
  },
  '/sequences': {
    title: 'Sequences',
    what_is: 'Read-only view of your outreach templates and in-flight steps. Sequences are auto-generated from each product\'s pitch — go to Products → Generate sequence to create or regenerate one.',
    what_to_do: 'Inspect each step\'s channel + delay. Edit step body/subject via Settings → Templates.',
    what_to_expect: 'Sequence changes apply to every new prospect scheduled after the edit. In-flight prospects stay on their original template. A full sequence builder (add/remove steps, multiple sequences per product) is on the roadmap.',
    next: { href: '/dashboard', label: 'Back to dashboard' },
  },
  '/settings/templates': {
    title: 'Sequence templates',
    what_is: 'The actual body and subject copy for each outreach step. Sequences here are auto-generated from your product pitch — you can regenerate from this page or edit any step inline.',
    what_to_do: 'If empty, click Generate. Otherwise edit the subject and body for any step. Tokens like {first_name}, {sender_name}, {credit_signal} interpolate per prospect at send time.',
    what_to_expect: 'Edits take effect for prospects scheduled after the save. Existing scheduled steps keep their original copy. Use "Regenerate" to start over from your latest product pitch.',
    next: { href: '/settings', label: 'Back to settings' },
  },
};

export function getPageGuide(pathname: string): PageGuide | null {
  if (PAGE_GUIDES[pathname]) return PAGE_GUIDES[pathname];
  // Match deepest prefix (so /partners/[id] falls back to /partners).
  const matches = Object.keys(PAGE_GUIDES)
    .filter((k) => pathname === k || pathname.startsWith(k + '/'))
    .sort((a, b) => b.length - a.length);
  return matches[0] ? PAGE_GUIDES[matches[0]] : null;
}
