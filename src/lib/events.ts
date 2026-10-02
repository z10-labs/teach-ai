import { z } from "zod";

const base = {
  id: z.uuid().optional(),
  learnerId: z.uuid(),
  sessionId: z.uuid().optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
};

export const questionAnswered = z.object({
  ...base,
  type: z.literal("question.answered"),
  payload: z.object({
    questionId: z.string(),
    skillIds: z.array(z.string()).min(1),
    correct: z.boolean(),
    timeMs: z.number().int().nonnegative().optional(),
    hintsUsed: z.number().int().nonnegative().default(0),
    attempt: z.number().int().positive().default(1),
    chosenOption: z.string().optional(),
    /** Content authors tag wrong options with the misconception they reveal. */
    misconceptionId: z.string().optional(),
  }),
});

export const hintRequested = z.object({
  ...base,
  type: z.literal("hint.requested"),
  payload: z.object({
    questionId: z.string(),
    skillIds: z.array(z.string()).min(1),
  }),
});

export const lessonCompleted = z.object({
  ...base,
  type: z.literal("lesson.completed"),
  payload: z.object({
    lessonId: z.string(),
    skillIds: z.array(z.string()).min(1),
  }),
});

export const learnerEvent = z.discriminatedUnion("type", [
  questionAnswered,
  hintRequested,
  lessonCompleted,
]);

export type LearnerEventInput = z.input<typeof learnerEvent>;
export type LearnerEvent = z.output<typeof learnerEvent>;
export type QuestionAnswered = z.output<typeof questionAnswered>;
