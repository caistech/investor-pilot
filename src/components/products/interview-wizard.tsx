'use client';

/**
 * Multi-step Product Interview wizard.
 *
 * Operator answers 8 benefit-framed questions; the wizard POSTs the answers
 * to /api/products/synthesize-from-interview which returns a structured
 * 13-field product profile. The wizard then hands the profile back to the
 * parent (typically /settings/products page) which populates the existing
 * manual form for review + save.
 *
 * Why multi-step instead of a single tall form:
 * - One question per screen keeps the operator focused on the framing each
 *   question is forcing. The "pain point" question for example fails its
 *   job if the operator is mentally jumping to the next slot.
 * - Cheap to navigate Back if an earlier answer reads wrong after writing
 *   the later ones.
 * - Mobile-friendly (each step fits one viewport without scrolling).
 */

import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Sparkles, X, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { PRODUCT_INTERVIEW_QUESTIONS, type InterviewQuestion } from '@/lib/products/interview-questions';
import type { SynthesizedProductProfile } from '@/lib/products/interview-synthesizer';

interface Props {
  /** Called when synthesis succeeds — parent populates form + closes wizard. */
  onSynthesized: (profile: SynthesizedProductProfile) => void;
  /** Called when operator cancels or closes mid-flow. */
  onCancel: () => void;
}

export default function InterviewWizard({ onSynthesized, onCancel }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const questions = PRODUCT_INTERVIEW_QUESTIONS;
  const currentQuestion: InterviewQuestion = questions[stepIndex];
  const isLast = stepIndex === questions.length - 1;
  const isFirst = stepIndex === 0;

  // Track progress. Optional questions don't count against the "minimum
  // to synthesize" bar but still take a step — operator can skip the
  // final one and still submit.
  const requiredAnswered = useMemo(() => {
    return questions.filter(q => !q.optional && (answers[q.id] || '').trim().length > 0).length;
  }, [questions, answers]);
  const requiredTotal = useMemo(() => questions.filter(q => !q.optional).length, [questions]);
  const canSubmit = requiredAnswered === requiredTotal;

  function setAnswer(value: string) {
    setAnswers(prev => ({ ...prev, [currentQuestion.id]: value }));
  }

  function next() {
    setError(null);
    if (stepIndex < questions.length - 1) setStepIndex(stepIndex + 1);
  }

  function back() {
    setError(null);
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
  }

  async function submit() {
    if (!canSubmit) {
      setError(`Answer the ${requiredTotal - requiredAnswered} remaining required question${requiredTotal - requiredAnswered === 1 ? '' : 's'} before synthesizing. Use Back to revisit.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Build payload — only include answers that were actually filled.
      const payload = questions
        .filter(q => (answers[q.id] || '').trim().length > 0)
        .map(q => ({
          question_id: q.id,
          question_prompt: q.prompt,
          answer: (answers[q.id] || '').trim(),
        }));
      const res = await fetch('/api/products/synthesize-from-interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: payload }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || `Synthesis failed (HTTP ${res.status})`);
        return;
      }
      onSynthesized(json.profile as SynthesizedProductProfile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Synthesis network error');
    } finally {
      setSubmitting(false);
    }
  }

  const currentAnswer = answers[currentQuestion.id] || '';
  const trimmedLen = currentAnswer.trim().length;
  // Visual cue for how filled the answer is, NOT a hard limit. Operators
  // who write 2-sentence answers shouldn't be punished by a counter that
  // makes them feel short.
  const lengthHint =
    currentQuestion.approxLength === 'short' ? '1 sentence is usually enough.'
    : currentQuestion.approxLength === 'medium' ? '2-3 sentences.'
    : 'Take more room here — 3-5 sentences with specifics.';

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-5 h-5 text-corp-green-400 flex-shrink-0" />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold truncate">Product Interview</h2>
            <p className="text-xs text-dark-500 mt-0.5">
              Step {stepIndex + 1} of {questions.length}
              {currentQuestion.optional && <span className="ml-1 text-dark-400">· optional</span>}
              <span className="mx-2">·</span>
              {requiredAnswered}/{requiredTotal} required answered
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-dark-500 hover:text-dark-300 flex-shrink-0"
          title="Cancel and return to the manual form"
          disabled={submitting}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Progress bar — visible step indicator */}
      <div className="flex gap-1 mb-6">
        {questions.map((q, idx) => {
          const answered = (answers[q.id] || '').trim().length > 0;
          const current = idx === stepIndex;
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => { setError(null); setStepIndex(idx); }}
              disabled={submitting}
              className={`h-1.5 flex-1 rounded transition-colors ${
                current
                  ? 'bg-corp-green-500'
                  : answered
                    ? 'bg-corp-green-700'
                    : 'bg-dark-700 hover:bg-dark-600'
              }`}
              title={`${idx + 1}. ${q.prompt}${q.optional ? ' (optional)' : ''}${answered ? ' · answered' : ''}`}
            />
          );
        })}
      </div>

      {/* Question */}
      <div className="mb-2">
        <h3 className="text-base font-medium leading-snug">
          {currentQuestion.prompt}
          {currentQuestion.optional && <span className="ml-2 text-xs text-dark-500 font-normal">(optional)</span>}
        </h3>
        <p className="text-sm text-dark-400 mt-2">{currentQuestion.helper}</p>
      </div>

      {/* Answer textarea */}
      <textarea
        value={currentAnswer}
        onChange={(e) => setAnswer(e.target.value)}
        disabled={submitting}
        placeholder="Your answer…"
        rows={currentQuestion.approxLength === 'long' ? 6 : currentQuestion.approxLength === 'medium' ? 4 : 2}
        className="w-full bg-dark-800 border border-dark-700 focus:border-corp-green-500 rounded-lg px-3 py-2 text-sm resize-y mt-3 focus:outline-none disabled:opacity-60"
      />
      <p className="text-xs text-dark-500 mt-1">
        {trimmedLen === 0 ? lengthHint : `${trimmedLen} character${trimmedLen === 1 ? '' : 's'}`}
      </p>

      {/* Error display */}
      {error && (
        <div className="mt-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between gap-3 mt-6 flex-wrap">
        <button
          type="button"
          onClick={back}
          disabled={isFirst || submitting}
          className="btn-secondary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Always-visible Synthesize button after the operator has hit the
              required threshold — even on intermediate steps. Lets them skip
              the final optional question without clicking through. */}
          {canSubmit && !isLast && (
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="btn-secondary flex items-center gap-2 disabled:opacity-40"
              title="Skip remaining optional questions and synthesize now"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {submitting ? 'Synthesizing…' : 'Synthesize now'}
            </button>
          )}
          {!isLast ? (
            <button
              type="button"
              onClick={next}
              disabled={submitting}
              className="btn-primary flex items-center gap-2 disabled:opacity-40"
            >
              Next
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={submitting || !canSubmit}
              className="btn-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              title={canSubmit ? 'Generate the structured product profile from these answers' : `${requiredTotal - requiredAnswered} required question(s) still empty`}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {submitting ? 'Synthesizing…' : 'Synthesize profile'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
