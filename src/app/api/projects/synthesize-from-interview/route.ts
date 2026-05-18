/**
 * POST /api/projects/synthesize-from-interview
 *
 * Funding-side mirror of /api/products/synthesize-from-interview. Takes
 * the operator's answers to the Project Interview question set and
 * returns a structured project profile they can review/edit before
 * saving through the existing manual /projects form.
 *
 * Does NOT save the project — synthesis is preview-only. Operator sees
 * the structured fields in the existing form, edits any that need
 * adjustment, then saves through the existing client-side create flow.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { synthesizeProjectProfile } from '@/lib/projects/interview-synthesizer';
import type { InterviewAnswer } from '@/lib/products/interview-synthesizer';

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

  for (const a of answers) {
    if (typeof a.question_id !== 'string' || typeof a.answer !== 'string') {
      return NextResponse.json(
        { error: 'Each answer must include question_id (string) and answer (string).' },
        { status: 400 },
      );
    }
  }

  const nonEmpty = answers.filter(a => a.answer.trim().length > 0);
  if (nonEmpty.length === 0) {
    return NextResponse.json(
      { error: 'All answers are empty. Fill in at least the core questions before synthesizing.' },
      { status: 400 },
    );
  }

  const result = await synthesizeProjectProfile(nonEmpty);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  console.log(`[projects/synthesize] user=${user!.id} answered=${nonEmpty.length}/${answers.length} fields=${Object.keys(result.profile).length}`);

  return NextResponse.json({ ok: true, profile: result.profile });
}
