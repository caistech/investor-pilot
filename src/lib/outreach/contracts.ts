// lib/outreach/contracts.ts
//
// THE CONTRACT. Format, tone, structure, identity discipline, and CTA routing
// live here — NOT on the product card. A product supplies slot *content*
// (pitch, ICP, outcomes, URLs); it must never carry formatting instructions.
//
// Selection is automatic: partner_type (already on every product via the
// webhook payload) picks the contract. Push a brand-new product through the
// pipeline, touch nothing by hand, and the copy comes out correctly shaped.
// If you ever find yourself fixing TONE on a product card, the contract has
// leaked into the data — pull it back here.

import { buildTrackingUrl } from "./tracking-url";

export type PartnerType = "distributor" | "enduser";

export interface ProductSlots {
  productName: string;
  oneLineDescription: string;
  coreMechanism: string;
  customerOutcomes: string;       // real economics, as slot content only
  icpVerticals: string | null;
  geography: string | null;
  landingPageUrl: string;         // bare; no tracking params
  partnerLandingPageUrl: string | null;
}

export interface SenderIdentity {
  name: string;
  // ONE honest relationship line, injected verbatim. This is what stops the
  // "founder / advisor / distributor / build-shop" drift — the generator is
  // forbidden from inventing its own.
  relationshipLine: string;       // e.g. "I run distribution for Singify in Australia"
  linkedinUrl: string;
  signatureName: string;
}

interface ContractStep {
  n: number;
  channel: "email" | "linkedin";
  beat: string;
  carriesAsk: boolean;            // does the commercial ask appear in this touch
}

export interface MessageContract {
  partnerType: PartnerType;
  steps: ContractStep[];
  // Which page the click lands on for this motion.
  resolveCtaUrl(slots: ProductSlots, prospectRef: string): string;
  // The invariant instruction block injected into the generator's system prompt.
  buildSystemBlock(slots: ProductSlots, sender: SenderIdentity): string;
}

const SHARED_RULES = (sender: SenderIdentity) => `
NON-NEGOTIABLE RULES (apply to every message, every step):
- Identity: refer to yourself ONLY as: "${sender.relationshipLine}". Do not
  call yourself founder, builder, "we built", tech advisor, or anything else.
  One identity, used consistently across the whole sequence.
- Signature: ${sender.signatureName}, ${sender.linkedinUrl}.
- CTA link: insert the provided tracking URL EXACTLY as given. Do not append,
  duplicate, or modify any query parameters. One link per message.
- Personalization: use ONLY facts supplied in the prospect research evidence.
  If a specific program name, methodology, or post is not in the evidence, do
  NOT invent one — fall back to category-level framing. A fabricated specific
  is worse than none; these recipients will spot it.
- Length: 90–130 words for email bodies; 1–2 sentences for LinkedIn touches.
`.trim();

const DISTRIBUTOR: MessageContract = {
  partnerType: "distributor",
  steps: [
    { n: 1, channel: "email",    beat: "Open on STUDENT VALUE only — practice between lessons, feedback loop, retention. No commercial ask.", carriesAsk: false },
    { n: 2, channel: "email",    beat: "Reframe as a PARTNER PROGRAM: the academy earns recurring revenue share on every student subscription they activate. This is the ask.", carriesAsk: true },
    { n: 3, channel: "linkedin", beat: "How rollout works: they offer it to their own students as a value-add; students get real-time feedback; teacher gets practice data back. Reinforce the economics lightly.", carriesAsk: true },
    { n: 4, channel: "email",    beat: "Proof / specificity — what a first cohort looks like, what the academy nets. Concrete, not pushy.", carriesAsk: true },
    { n: 5, channel: "linkedin", beat: "Soft nudge; offer a 10-minute call to walk the partner terms.", carriesAsk: false },
    { n: 6, channel: "email",    beat: "Polite final touch; leave the door open, no pressure.", carriesAsk: false },
  ],
  resolveCtaUrl(slots, prospectRef) {
    // Distributor motion lands on the PARTNER page, not the end-user page.
    const base = slots.partnerLandingPageUrl ?? slots.landingPageUrl;
    return buildTrackingUrl(base, prospectRef);
  },
  buildSystemBlock(slots, sender) {
    return `
You are writing a 6-step DISTRIBUTOR / reseller outreach sequence for ${slots.productName}.
The recipient is a business (e.g. ${slots.icpVerticals ?? "a teaching business"}) that would
RESELL or offer this to THEIR OWN clients — they are a channel partner, not the end user.

MOTION FRAMING:
- The partner makes money: recurring revenue share on every end-user subscription they activate.
- They share it with their clients as a value-add (${slots.coreMechanism}).
- Their clients (end users) get the benefit and generate feedback/data the partner can see.
- Real economics for this product: ${slots.customerOutcomes}

SEQUENCING THE ASK (critical):
- Step 1 opens on what the partner's CLIENTS get — never lead a cold email with "earn commission".
- The revenue-share / partner-program ask first appears at STEP 2, and is reinforced steps 3–4.
- ${slots.geography ? `Target market: ${slots.geography}.` : ""}

${SHARED_RULES(sender)}
`.trim();
  },
};

const ENDUSER: MessageContract = {
  partnerType: "enduser",
  steps: [
    { n: 1, channel: "email",    beat: "Open on the user's own outcome / pain. No hard ask.", carriesAsk: false },
    { n: 2, channel: "email",    beat: "Show the mechanism and the adoption/retention benefit; light trial ask.", carriesAsk: true },
    { n: 3, channel: "linkedin", beat: "Social proof or a concrete result.", carriesAsk: true },
    { n: 4, channel: "email",    beat: "Direct ask — start a trial / book a demo.", carriesAsk: true },
    { n: 5, channel: "linkedin", beat: "Soft nudge.", carriesAsk: false },
    { n: 6, channel: "email",    beat: "Final polite touch.", carriesAsk: false },
  ],
  resolveCtaUrl(slots, prospectRef) {
    return buildTrackingUrl(slots.landingPageUrl, prospectRef);
  },
  buildSystemBlock(slots, sender) {
    return `
You are writing a 6-step END-USER outreach sequence for ${slots.productName}.
The recipient is the person who would USE the product directly.

FRAMING:
- Lead with their outcome: ${slots.customerOutcomes}
- Mechanism: ${slots.coreMechanism}
- ${slots.geography ? `Market: ${slots.geography}.` : ""}

${SHARED_RULES(sender)}
`.trim();
  },
};

const CONTRACTS: Record<PartnerType, MessageContract> = {
  distributor: DISTRIBUTOR,
  enduser: ENDUSER,
};

/**
 * Single entry point for the generator. Reads partner_type off the product and
 * returns the contract. Defaults to distributor (your primary motion) and logs
 * if it sees an unknown value, rather than silently picking the wrong shape.
 */
export function getContract(partnerType: string | null | undefined): MessageContract {
  const key = (partnerType ?? "").toLowerCase().trim();
  if (key === "distributor" || key === "enduser") return CONTRACTS[key];
  console.warn(`[outreach/contracts] unknown partner_type="${partnerType}" — defaulting to distributor`);
  return DISTRIBUTOR;
}