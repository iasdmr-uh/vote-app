-- Set only after a closed round's votes were re-inserted and VACUUM FULL removed the old tuples.
-- Publishing requires it, so a failed cleanup cannot be followed by a publication that looks complete.
ALTER TABLE "rounds" ADD COLUMN "votes_unlinked_at" TIMESTAMP(3);
