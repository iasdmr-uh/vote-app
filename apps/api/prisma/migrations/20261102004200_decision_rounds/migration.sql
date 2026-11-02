-- Nov 2 2026: the Asamblea also votes decisions. A decision is A favor / En contra or a set of options
-- written by the mesa, approved with mayoría simple (> 1/2) or 3/4 of the habilitados frozen at close.
ALTER TYPE "RoundCategory" ADD VALUE 'decision';
ALTER TABLE "rounds" ADD COLUMN "decision_format" TEXT;
ALTER TABLE "rounds" ADD COLUMN "approval_rule" TEXT NOT NULL DEFAULT 'simple';
