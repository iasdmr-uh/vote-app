-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('union', 'association');

-- CreateEnum
CREATE TYPE "AssemblyStatus" AS ENUM ('preparing', 'lobby_open', 'lobby_closed', 'in_progress', 'completed');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('active', 'removed');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('draft', 'open', 'closed', 'published');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assemblies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AssemblyStatus" NOT NULL DEFAULT 'preparing',
    "join_code_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assemblies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_sessions" (
    "id" UUID NOT NULL,
    "assembly_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participant_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rounds" (
    "id" UUID NOT NULL,
    "assembly_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'single_choice',
    "counting_rule" JSONB NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'draft',
    "opened_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ballot_options" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "ballot_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participations" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "participant_session_id" UUID NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anonymous_votes" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,

    CONSTRAINT "anonymous_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "assembly_id" UUID NOT NULL,
    "round_id" UUID,
    "actor_ref" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assemblies_join_code_hash_key" ON "assemblies"("join_code_hash");

-- CreateIndex
CREATE INDEX "assemblies_organization_id_status_idx" ON "assemblies"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "participant_sessions_token_hash_key" ON "participant_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "participant_sessions_assembly_id_status_idx" ON "participant_sessions"("assembly_id", "status");

-- CreateIndex
CREATE INDEX "rounds_assembly_id_status_idx" ON "rounds"("assembly_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ballot_options_round_id_order_key" ON "ballot_options"("round_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ballot_options_round_id_id_key" ON "ballot_options"("round_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "participations_round_id_participant_session_id_key" ON "participations"("round_id", "participant_session_id");

-- CreateIndex
CREATE INDEX "anonymous_votes_round_id_option_id_idx" ON "anonymous_votes"("round_id", "option_id");

-- CreateIndex
CREATE INDEX "audit_events_assembly_id_occurred_at_idx" ON "audit_events"("assembly_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "assemblies" ADD CONSTRAINT "assemblies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_sessions" ADD CONSTRAINT "participant_sessions_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ballot_options" ADD CONSTRAINT "ballot_options_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participations" ADD CONSTRAINT "participations_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participations" ADD CONSTRAINT "participations_participant_session_id_fkey" FOREIGN KEY ("participant_session_id") REFERENCES "participant_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anonymous_votes" ADD CONSTRAINT "anonymous_votes_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anonymous_votes" ADD CONSTRAINT "anonymous_votes_round_id_option_id_fkey" FOREIGN KEY ("round_id", "option_id") REFERENCES "ballot_options"("round_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
