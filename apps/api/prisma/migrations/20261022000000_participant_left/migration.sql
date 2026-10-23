-- Oct 22 2026: a delegate who taps "Salir" ends their own session. It is kept apart from "removed",
-- which is the mesa expelling someone, and still counts in the percentage base of the ballots they voted in.
ALTER TYPE "ParticipantStatus" ADD VALUE 'left';
