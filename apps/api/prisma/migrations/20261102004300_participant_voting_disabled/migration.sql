-- Nov 2 2026: the mesa can inhabilitar a delegate who leaves mid-assembly. They stay in the room and in
-- the majority base of every ballot, but the server rejects their vote until the mesa habilita them again.
ALTER TABLE "participant_sessions" ADD COLUMN "voting_disabled" BOOLEAN NOT NULL DEFAULT false;
