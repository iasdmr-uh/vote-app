-- Secretaría (Oct 2026): every ballot offers a "Voto nulo" option, and the moderator can annul a
-- ballot. Annulled rounds keep their participation receipts but their votes are deleted.
ALTER TYPE "RoundStatus" ADD VALUE 'annulled';

ALTER TABLE "rounds" ADD COLUMN "annulled_at" TIMESTAMP(3);
ALTER TABLE "rounds" ADD COLUMN "annul_reason" TEXT;

ALTER TABLE "ballot_options" ADD COLUMN "is_null_vote" BOOLEAN NOT NULL DEFAULT false;
