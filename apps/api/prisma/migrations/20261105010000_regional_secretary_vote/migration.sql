ALTER TABLE "participant_sessions" ADD COLUMN "is_regional_secretary" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "rounds" ADD COLUMN "regional_secretary_votes" BOOLEAN NOT NULL DEFAULT false;
