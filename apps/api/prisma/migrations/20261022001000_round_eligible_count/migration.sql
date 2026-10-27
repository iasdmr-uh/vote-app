-- Oct 22 2026: the percentage base of a ballot is frozen when it closes, so people who join later
-- (for example after the lobby reopens) cannot change the percentages of an earlier vote.
-- Rounds closed before this migration keep NULL and fall back to the live count.
ALTER TABLE "rounds" ADD COLUMN "eligible_count" INTEGER;
