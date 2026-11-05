-- Nov 2 2026: from the 3rd vote of an election on, the mesa may add a new candidate to the runoff draft.
-- The flag lets the mesa show it as "Nuevo" and remove it again before opening the vote.
ALTER TABLE "ballot_options" ADD COLUMN "is_new" BOOLEAN NOT NULL DEFAULT false;
