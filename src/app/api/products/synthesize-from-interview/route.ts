/**
 * POST /api/products/synthesize-from-interview
 *
 * Takes 8 interview answers (operator's free-text responses to the structured
 * question set in src/lib/products/interview-questions.ts) and returns a
 * structured product profile the operator can review/edit before saving.
 *
 * Does NOT save the product — synthesis is preview-only. The client renders
 * the returned profile in the existing manual /products form, operator edits
 * inline if needed, then saves through the existing create flow. Keeps a
 * single source of truth for the create path and ensures the operator
 * always sees what's about to be stored before commit.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { synthesizeProductProfile, type InterviewAnswer } from '@/lib/products/interview-synthesizer';

export const maxDuration = 60;

export async function POST(request: Request) {
  const { user, error } = await authenticateAndGetDb();
  if (error) return error;

  let body: { answers?: InterviewAnswer[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const answers = body.answers;
  if (!Array.isArray(answers) || answers.length === 0) {
    return NextResponse.json(
      { error: 'Provide an `answers` array with at least one entry.' },
      { status: 400 },
    );
  }

  // Validate shape of each answer — bad input here produces a useless Claude
  // call (~$0.01 wasted) so guard early.
  for (const a of answers) {
    if (typeof a.question_id !== 'string' || typeof a.answer !== 'string') {
      return NextResponse.json(
        { error: 'Each answer must include question_id (string) and answer (string).' },
        { status: 400 },
      );
    }
  }

  // Reject submissions where every required answer is empty — the synthesizer
  // would just produce a hollow profile. Lets the wizard show a clear error
  // instead of a "synthesized" empty product.
  const nonEmpty = answers.filter(a => a.answer.trim().length > 0);
  if (nonEmpty.length === 0) {
    return NextResponse.json(
      { error: 'All answers are empty. Fill in at least the core questions before synthesizing.' },
      { status: 400 },
    );
  }

  const result = await synthesizeProductProfile(nonEmpty);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // Telemetry: the synthesizer is a new code path; track usage for the first
  // few operators using it so we can see (a) how often it's invoked, (b)
  // whether the synthesized fields are accepted vs edited, (c) failure rate.
  // Voluntary log via console for now — replace with structured event when
  // we add a dedicated synthesizer_events table.
  console.log(`[products/synthesize] user=${user!.id} answered=${nonEmpty.length}/${answers.length} fields=${Object.keys(result.profile).length}`);

  return NextResponse.json({ ok: true, profile: result.profile });
}
