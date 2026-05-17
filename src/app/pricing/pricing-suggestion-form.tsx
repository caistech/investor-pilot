'use client';

import { useState } from 'react';
import { Send, CheckCircle2 } from 'lucide-react';

export function PricingSuggestionForm() {
  const [suggestedPrice, setSuggestedPrice] = useState('');
  const [useCase, setUseCase] = useState('');
  const [email, setEmail] = useState('');
  // Honeypot — kept off-screen but in the DOM so spam bots happily fill it.
  // The route silently swallows any submission where this is non-empty.
  const [hp, setHp] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!suggestedPrice.trim()) {
      setError('Tell us what you think it should cost — any format is fine.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/pricing-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suggested_price: suggestedPrice.trim(),
          use_case: useCase.trim() || undefined,
          email: email.trim() || undefined,
          hp,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Something went wrong — try again in a moment.');
        return;
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error — try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="card border-corp-green-500/30 bg-corp-green-500/5 text-center py-12">
        <CheckCircle2 className="w-10 h-10 text-corp-green-400 mx-auto mb-3" />
        <h4 className="mb-2">Got it — thank you.</h4>
        <p className="text-dark-300 text-sm max-w-md mx-auto">
          Your suggestion landed in the founder&apos;s inbox. If you left an
          email, you&apos;ll hear back when pricing is published.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card">
      <h3 className="mb-1">What would this be worth to you?</h3>
      <p className="text-dark-400 text-sm mb-6">
        Any format — &quot;$500/mo&quot;, &quot;$5K one-off&quot;, &quot;1% of the
        round we close&quot;, &quot;free if I send you 10 referrals&quot;.
        Whatever framing actually maps to value for your use case.
      </p>

      <div className="space-y-4">
        <div>
          <label className="label-prominent" htmlFor="suggested_price">
            Your suggested pricing
          </label>
          <textarea
            id="suggested_price"
            value={suggestedPrice}
            onChange={(e) => setSuggestedPrice(e.target.value)}
            placeholder="e.g. $500/month for unlimited prospects, or $2K per closed meeting, or…"
            rows={3}
            maxLength={500}
            required
            className="input-prominent resize-y"
          />
        </div>

        <div>
          <label className="label-prominent" htmlFor="use_case">
            Your use case <span className="text-dark-500 font-normal text-sm">(optional but helpful)</span>
          </label>
          <input
            id="use_case"
            type="text"
            value={useCase}
            onChange={(e) => setUseCase(e.target.value)}
            placeholder="e.g. Raising Series A in SEA EdTech / B2B SaaS sales to mid-market"
            maxLength={500}
            className="input-prominent"
          />
        </div>

        <div>
          <label className="label-prominent" htmlFor="email">
            Email <span className="text-dark-500 font-normal text-sm">(optional — only if you want a reply when pricing lands)</span>
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@firm.com"
            maxLength={200}
            className="input-prominent"
          />
        </div>

        {/* Honeypot — hidden from humans, irresistible to bots. */}
        <div
          aria-hidden="true"
          style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}
        >
          <label htmlFor="hp_website">Website (do not fill)</label>
          <input
            id="hp_website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={hp}
            onChange={(e) => setHp(e.target.value)}
          />
        </div>

        {error && (
          <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-60"
          >
            {submitting ? (
              <>Sending…</>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Send to founder
              </>
            )}
          </button>
          <p className="text-dark-500 text-xs">
            Goes straight to the founder. No marketing list, no autoresponder.
          </p>
        </div>
      </div>
    </form>
  );
}
