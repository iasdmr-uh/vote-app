-- Oct 21 2026: "Voto nulo" is removed from every ballot, and a committee becomes a plain ballot of
-- typed candidate names where each delegate marks up to the committee size. The Nomination
-- Committee workflow (proposals, supports, approval, Secretaría validation) is removed with it.

-- Null-vote options go with their votes (anonymous_votes and official_result_options cascade).
DELETE FROM "ballot_options" WHERE "is_null_vote";
ALTER TABLE "ballot_options" DROP COLUMN "is_null_vote";

ALTER TABLE "ballot_options" DROP CONSTRAINT "ballot_options_candidate_unique_per_round";
ALTER TABLE "ballot_options" DROP COLUMN "candidate_participant_id";

DROP TABLE "committee_proposal_supports";
DROP TABLE "committee_proposals";
DROP TABLE "committee_winners";

ALTER TABLE "rounds" DROP CONSTRAINT "rounds_committee_metadata_check";
ALTER TABLE "rounds"
  DROP COLUMN "committee_type",
  DROP COLUMN "decision_note",
  DROP COLUMN "committee_stage",
  DROP COLUMN "committee_configuration";
ALTER TABLE "rounds"
  ADD CONSTRAINT "rounds_office_without_member_count" CHECK ("category" = 'committee' OR "member_count" IS NULL);
DROP TYPE "CommitteeStage";

ALTER TABLE "participant_sessions"
  DROP COLUMN "assembly_role",
  DROP COLUMN "committee_eligible";
DROP TYPE "AssemblyRole";
