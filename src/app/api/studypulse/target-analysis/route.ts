import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface CategoryStatus {
  name:          string;
  weight:        number;
  currentAvg:    number;
  entryCount:    number;
  remainingCount: number;
  requiredAvg:   number | null;  // pre-computed; null = not calculable
  isAchievable:  boolean;
}

export interface PeriodStatus {
  name:        string;
  currentGrade: number;
  targetGrade: number;
  categories:  CategoryStatus[];
}

export interface TargetAnalysisRequest {
  subjectName:    string;
  transmuted:     boolean;
  periods:        PeriodStatus[];
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'AI analysis is not configured (missing ANTHROPIC_API_KEY).' }, { status: 503 });
  }

  const body: TargetAnalysisRequest = await req.json();

  const prompt = buildPrompt(body);

  const message = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages:   [{ role: 'user', content: prompt }],
  });

  const text = (message.content[0] as { type: string; text: string }).text;
  return Response.json({ analysis: text });
}

function buildPrompt({ subjectName, transmuted, periods }: TargetAnalysisRequest): string {
  const scale = transmuted ? 'transmuted grading scale (0–100, non-linear curve)' : 'raw percentage scale (0–100)';

  const periodSections = periods.map(p => {
    const catLines = p.categories.map(c => {
      const req = c.requiredAvg !== null
        ? `needs avg ${c.requiredAvg.toFixed(0)} on ${c.remainingCount} remaining task(s)${c.isAchievable ? '' : ' — TARGET MAY BE UNREACHABLE for this category'}`
        : c.remainingCount === 0
          ? `no remaining tasks planned`
          : `insufficient data to compute`;

      return `    • ${c.name} (${c.weight}%): current avg = ${c.currentAvg.toFixed(1)}, ${c.entryCount} done, ${c.remainingCount} planned → ${req}`;
    }).join('\n');

    const gap     = p.targetGrade - p.currentGrade;
    const onTrack = p.currentGrade >= p.targetGrade;

    return `
  Period: ${p.name}
  Current grade: ${p.currentGrade.toFixed(1)} | Target: ${p.targetGrade.toFixed(0)} | Gap: ${gap > 0 ? '+' + gap.toFixed(1) + ' needed' : 'ON TRACK ✓'}
  Categories:
${catLines}`;
  }).join('\n');

  return `You are a friendly academic advisor. Analyze this student's grade situation for "${subjectName}" and give practical, encouraging advice.

Grading uses the ${scale}.

${periodSections}

Respond in 3–5 short paragraphs. Cover:
1. Overall situation (realistic but positive)
2. Which categories need the most focus and why
3. Specific score targets the student should aim for on upcoming tasks
4. A motivational closing line

Keep it conversational, like a helpful tutor — no bullet lists, no markdown headers. Under 200 words.`;
}
