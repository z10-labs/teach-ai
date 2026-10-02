/**
 * Drives the pipeline through the public API, the way a tutoring app would.
 *
 *   pnpm demo struggle    # wrong answers that reveal a misconception
 *   pnpm demo session     # a live tutoring session transcript (needs AI_GATEWAY_API_KEY)
 *   pnpm demo practice    # clean correct answers + homework lesson completed
 *   pnpm demo             # all three, in order
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const BASE = process.env.TEACH_AI_URL ?? "http://localhost:3000";
const LEARNER = "00000000-0000-4000-8000-000000000001";
const PART_WHOLE = "math.ratio.part_whole";
const WORD_PROBLEMS = "math.ratio.word_problems";

async function api(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.TEACH_AI_API_KEY ? { authorization: `Bearer ${process.env.TEACH_AI_API_KEY}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function struggle() {
  const answers = [
    { q: "r1", correct: false, misconceptionId: "ratio.part_part_vs_whole" },
    { q: "r2", correct: true, hintsUsed: 2 },
    { q: "r3", correct: false, misconceptionId: "ratio.part_part_vs_whole" },
    { q: "r4", correct: false, misconceptionId: "ratio.part_part_vs_whole" },
    { q: "r5", correct: false },
  ];
  const events = [
    ...answers.map((a, i) => ({
      type: "question.answered",
      learnerId: LEARNER,
      occurredAt: minutesAgo(120 - i * 2),
      payload: {
        questionId: a.q,
        skillIds: [PART_WHOLE],
        correct: a.correct,
        hintsUsed: a.hintsUsed ?? 0,
        timeMs: 40_000,
        ...(a.misconceptionId ? { misconceptionId: a.misconceptionId, chosenOption: "B" } : {}),
      },
    })),
    { type: "hint.requested", learnerId: LEARNER, occurredAt: minutesAgo(111), payload: { questionId: "r2", skillIds: [PART_WHOLE] } },
    {
      type: "question.answered",
      learnerId: LEARNER,
      occurredAt: minutesAgo(100),
      payload: { questionId: "w1", skillIds: [WORD_PROBLEMS, PART_WHOLE], correct: false, hintsUsed: 0, timeMs: 95_000 },
    },
  ];
  console.log("struggle:", await api("/api/events", events));
}

async function session() {
  const { id } = await api("/api/sessions", {
    learnerId: LEARNER,
    tutorName: "Mr Dlamini",
    kind: "live_tutor",
    startedAt: minutesAgo(60),
  });
  const segments: [string, string][] = [
    ["tutor", "Hi Thandi. Last time you said ratios were confusing. What's going on with them?"],
    ["student", "When it says the ratio of boys to girls is 3 to 2, I don't know if that means three out of two or what. I just put 3 over 2."],
    ["tutor", "Okay. So if there are 3 boys for every 2 girls, how many students are in each group of five?"],
    ["student", "Five... oh. So the boys are 3 out of 5, not 3 over 2?"],
    ["tutor", "Exactly. Let's draw it as a tape diagram. Three blocks for boys, two blocks for girls."],
    ["student", "Okay that makes way more sense when I can see the blocks. The formula thing just confuses me."],
    ["tutor", "Try this one: the ratio of red to blue marbles is 4 to 1 and there are 20 marbles. How many are red?"],
    ["student", "Draw five blocks... each block is 4 marbles... so red is 16."],
    ["tutor", "Perfect. With word problems, what do you usually do first?"],
    ["student", "Honestly I just start multiplying numbers. I don't really read which thing they're asking for."],
    ["student", "I really need to get at least a B in the finals on the 14th of November, my mom said."],
    ["tutor", "We can get you there. For homework, please do the ratio word problems worksheet, lesson 3, before Tuesday."],
    ["student", "Okay, I'll do lesson 3."],
    ["tutor", "And I'll send you some tape diagram examples tonight."],
  ];
  const result = await api(`/api/sessions/${id}/transcript`, {
    endedAt: minutesAgo(5),
    segments: segments.map(([speaker, text], i) => ({ speaker, text, startMs: i * 60_000, endMs: i * 60_000 + 50_000 })),
  });
  console.log("session:", result);
}

async function practice() {
  const events = [
    ...Array.from({ length: 7 }, (_, i) => ({
      type: "question.answered",
      learnerId: LEARNER,
      occurredAt: minutesAgo(4 - i * 0.1),
      payload: { questionId: `p${i}`, skillIds: [PART_WHOLE], correct: true, hintsUsed: 0, timeMs: 30_000 },
    })),
    {
      type: "lesson.completed",
      learnerId: LEARNER,
      occurredAt: minutesAgo(3),
      payload: { lessonId: "ratio-word-problems-3", skillIds: [WORD_PROBLEMS] },
    },
  ];
  console.log("practice:", await api("/api/events", events));
}

const phases = { struggle, session, practice } as const;
const arg = process.argv[2] as keyof typeof phases | undefined;

(async () => {
  if (arg) return phases[arg]();
  await struggle();
  await session();
  await practice();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
