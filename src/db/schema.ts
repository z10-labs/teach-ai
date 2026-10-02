import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const EMBEDDING_DIMENSIONS = 1536;

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const tsz = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export const learners = pgTable("learners", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name").notNull(),
  gradeLevel: text("grade_level"),
  curriculum: text("curriculum"),
  timezone: text("timezone").notNull().default("Africa/Johannesburg"),
  guardianConsentAt: tsz("guardian_consent_at"),
  createdAt: createdAt(),
});

export const skills = pgTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  parentId: text("parent_id").references((): AnyPgColumn => skills.id),
  prerequisites: text("prerequisites").array().notNull().default(sql`'{}'::text[]`),
});

export const misconceptions = pgTable("misconceptions", {
  id: text("id").primaryKey(),
  skillId: text("skill_id")
    .notNull()
    .references(() => skills.id),
  description: text("description").notNull(),
});

// ---------------------------------------------------------------------------
// Sources (append-only)
// ---------------------------------------------------------------------------

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => learners.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    occurredAt: tsz("occurred_at").notNull(),
    receivedAt: tsz("received_at").notNull().defaultNow(),
    sessionId: uuid("session_id"),
    skillIds: text("skill_ids").array().notNull().default(sql`'{}'::text[]`),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    processedAt: tsz("processed_at"),
  },
  (t) => [index("events_learner_time_idx").on(t.learnerId, t.occurredAt)],
);

export const sessionKind = pgEnum("session_kind", ["live_tutor", "ai_tutor", "self_study"]);
export const sessionStatus = pgEnum("session_status", ["open", "processing", "processed", "failed"]);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => learners.id, { onDelete: "cascade" }),
    tutorName: text("tutor_name"),
    kind: sessionKind("kind").notNull().default("live_tutor"),
    status: sessionStatus("status").notNull().default("open"),
    extractorVersion: text("extractor_version"),
    startedAt: tsz("started_at").notNull(),
    endedAt: tsz("ended_at"),
  },
  (t) => [index("sessions_learner_idx").on(t.learnerId, t.startedAt)],
);

export const speaker = pgEnum("speaker", ["student", "tutor", "other"]);

export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    speaker: speaker("speaker").notNull(),
    startMs: integer("start_ms"),
    endMs: integer("end_ms"),
    text: text("text").notNull(),
  },
  (t) => [uniqueIndex("segments_session_idx").on(t.sessionId, t.idx)],
);

// ---------------------------------------------------------------------------
// Memory (interpreted, versioned)
// ---------------------------------------------------------------------------

export const skillStates = pgTable(
  "skill_states",
  {
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => learners.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id),
    mastery: real("mastery").notNull(),
    confidence: real("confidence").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    recentMastery: real("recent_mastery").array().notNull().default(sql`'{}'::real[]`),
    trend: text("trend").$type<"up" | "flat" | "down">().notNull().default("flat"),
    lastPracticedAt: tsz("last_practiced_at"),
    nextReviewAt: tsz("next_review_at"),
    lastEventId: uuid("last_event_id"),
    updatedAt: tsz("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.learnerId, t.skillId] })],
);

export const memoryKind = pgEnum("memory_kind", [
  "misconception",
  "strategy_works",
  "strategy_fails",
  "goal",
  "preference",
  "behavior",
  "context",
]);

export const memoryStatus = pgEnum("memory_status", [
  "proposed",
  "active",
  "resolved",
  "superseded",
  "dismissed",
  "expired",
]);

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => learners.id, { onDelete: "cascade" }),
    kind: memoryKind("kind").notNull(),
    skillId: text("skill_id").references(() => skills.id),
    misconceptionId: text("misconception_id").references(() => misconceptions.id),
    statement: text("statement").notNull(),
    attributes: jsonb("attributes").notNull().default({}).$type<Record<string, unknown>>(),
    confidence: real("confidence").notNull(),
    status: memoryStatus("status").notNull().default("active"),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => memories.id),
    createdBy: text("created_by").notNull(),
    verifiedByTutor: boolean("verified_by_tutor").notNull().default(false),
    firstSeenAt: tsz("first_seen_at").notNull().defaultNow(),
    lastConfirmedAt: tsz("last_confirmed_at").notNull().defaultNow(),
    expiresAt: tsz("expires_at"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
  },
  (t) => [
    index("memories_learner_status_idx").on(t.learnerId, t.status),
    index("memories_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const evidenceSource = pgEnum("evidence_source", ["event", "segment", "tutor"]);
export const evidenceRelation = pgEnum("evidence_relation", ["supports", "contradicts"]);

export const memoryEvidence = pgTable(
  "memory_evidence",
  {
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    sourceType: evidenceSource("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    relation: evidenceRelation("relation").notNull(),
    weight: real("weight").notNull(),
    quote: text("quote"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.memoryId, t.sourceType, t.sourceId] })],
);

export const commitmentOwner = pgEnum("commitment_owner", ["student", "tutor", "parent"]);
export const commitmentStatus = pgEnum("commitment_status", ["open", "done", "missed"]);

export const commitments = pgTable(
  "commitments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => learners.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
    owner: commitmentOwner("owner").notNull(),
    description: text("description").notNull(),
    skillId: text("skill_id").references(() => skills.id),
    dueAt: tsz("due_at"),
    status: commitmentStatus("status").notNull().default("open"),
    closedByEventId: uuid("closed_by_event_id"),
    createdAt: createdAt(),
  },
  (t) => [index("commitments_learner_status_idx").on(t.learnerId, t.status)],
);

export const episodeScope = pgEnum("episode_scope", ["session", "week", "month"]);

export const episodes = pgTable(
  "episodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => learners.id, { onDelete: "cascade" }),
    scope: episodeScope("scope").notNull(),
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    periodStart: tsz("period_start").notNull(),
    periodEnd: tsz("period_end").notNull(),
    summary: text("summary").notNull(),
    highlights: jsonb("highlights").notNull().default({}).$type<Record<string, unknown>>(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: createdAt(),
  },
  (t) => [
    index("episodes_learner_idx").on(t.learnerId, t.periodEnd),
    uniqueIndex("episodes_session_uq").on(t.sessionId),
    index("episodes_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

// ---------------------------------------------------------------------------
// Snapshot (read model)
// ---------------------------------------------------------------------------

export const learnerSnapshots = pgTable("learner_snapshots", {
  learnerId: uuid("learner_id")
    .primaryKey()
    .references(() => learners.id, { onDelete: "cascade" }),
  snapshot: jsonb("snapshot").notNull(),
  builtAt: tsz("built_at").notNull().defaultNow(),
});

export type Memory = typeof memories.$inferSelect;
export type MemoryKind = (typeof memoryKind.enumValues)[number];
export type MemoryStatus = (typeof memoryStatus.enumValues)[number];
export type SkillState = typeof skillStates.$inferSelect;
