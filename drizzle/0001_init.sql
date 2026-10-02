CREATE TYPE "public"."commitment_owner" AS ENUM('student', 'tutor', 'parent');--> statement-breakpoint
CREATE TYPE "public"."commitment_status" AS ENUM('open', 'done', 'missed');--> statement-breakpoint
CREATE TYPE "public"."episode_scope" AS ENUM('session', 'week', 'month');--> statement-breakpoint
CREATE TYPE "public"."evidence_relation" AS ENUM('supports', 'contradicts');--> statement-breakpoint
CREATE TYPE "public"."evidence_source" AS ENUM('event', 'segment', 'tutor');--> statement-breakpoint
CREATE TYPE "public"."memory_kind" AS ENUM('misconception', 'strategy_works', 'strategy_fails', 'goal', 'preference', 'behavior', 'context');--> statement-breakpoint
CREATE TYPE "public"."memory_status" AS ENUM('proposed', 'active', 'resolved', 'superseded', 'dismissed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('live_tutor', 'ai_tutor', 'self_study');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('open', 'processing', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."speaker" AS ENUM('student', 'tutor', 'other');--> statement-breakpoint
CREATE TABLE "commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"session_id" uuid,
	"owner" "commitment_owner" NOT NULL,
	"description" text NOT NULL,
	"skill_id" text,
	"due_at" timestamp with time zone,
	"status" "commitment_status" DEFAULT 'open' NOT NULL,
	"closed_by_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"scope" "episode_scope" NOT NULL,
	"session_id" uuid,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"summary" text NOT NULL,
	"highlights" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"learner_id" uuid NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_id" uuid,
	"skill_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "learner_snapshots" (
	"learner_id" uuid PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"grade_level" text,
	"curriculum" text,
	"timezone" text DEFAULT 'Africa/Johannesburg' NOT NULL,
	"guardian_consent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"kind" "memory_kind" NOT NULL,
	"skill_id" text,
	"misconception_id" text,
	"statement" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" real NOT NULL,
	"status" "memory_status" DEFAULT 'active' NOT NULL,
	"supersedes_id" uuid,
	"created_by" text NOT NULL,
	"verified_by_tutor" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"embedding" vector(1536)
);
--> statement-breakpoint
CREATE TABLE "memory_evidence" (
	"memory_id" uuid NOT NULL,
	"source_type" "evidence_source" NOT NULL,
	"source_id" text NOT NULL,
	"relation" "evidence_relation" NOT NULL,
	"weight" real NOT NULL,
	"quote" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_evidence_memory_id_source_type_source_id_pk" PRIMARY KEY("memory_id","source_type","source_id")
);
--> statement-breakpoint
CREATE TABLE "misconceptions" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"tutor_name" text,
	"kind" "session_kind" DEFAULT 'live_tutor' NOT NULL,
	"status" "session_status" DEFAULT 'open' NOT NULL,
	"extractor_version" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "skill_states" (
	"learner_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"mastery" real NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"recent_mastery" real[] DEFAULT '{}'::real[] NOT NULL,
	"trend" text DEFAULT 'flat' NOT NULL,
	"last_practiced_at" timestamp with time zone,
	"next_review_at" timestamp with time zone,
	"last_event_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_states_learner_id_skill_id_pk" PRIMARY KEY("learner_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"parent_id" text,
	"prerequisites" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"speaker" "speaker" NOT NULL,
	"start_ms" integer,
	"end_ms" integer,
	"text" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_snapshots" ADD CONSTRAINT "learner_snapshots_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_misconception_id_misconceptions_id_fk" FOREIGN KEY ("misconception_id") REFERENCES "public"."misconceptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_supersedes_id_memories_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."memories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_evidence" ADD CONSTRAINT "memory_evidence_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconceptions" ADD CONSTRAINT "misconceptions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_states" ADD CONSTRAINT "skill_states_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_states" ADD CONSTRAINT "skill_states_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_parent_id_skills_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commitments_learner_status_idx" ON "commitments" USING btree ("learner_id","status");--> statement-breakpoint
CREATE INDEX "episodes_learner_idx" ON "episodes" USING btree ("learner_id","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_session_uq" ON "episodes" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "episodes_embedding_idx" ON "episodes" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "events_learner_time_idx" ON "events" USING btree ("learner_id","occurred_at");--> statement-breakpoint
CREATE INDEX "memories_learner_status_idx" ON "memories" USING btree ("learner_id","status");--> statement-breakpoint
CREATE INDEX "memories_embedding_idx" ON "memories" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "sessions_learner_idx" ON "sessions" USING btree ("learner_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "segments_session_idx" ON "transcript_segments" USING btree ("session_id","idx");