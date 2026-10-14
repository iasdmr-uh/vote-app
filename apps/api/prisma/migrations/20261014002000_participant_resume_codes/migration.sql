-- One-time, short-lived codes that let the moderator move a delegate's session to a new device.
ALTER TABLE "participant_sessions" ADD COLUMN "resume_code_hash" CHAR(64);
ALTER TABLE "participant_sessions" ADD COLUMN "resume_expires_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "participant_sessions_resume_code_hash_key" ON "participant_sessions"("resume_code_hash");
