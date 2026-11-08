ALTER TABLE "official_results" ADD COLUMN "approved" BOOLEAN,
ADD COLUMN "registered_at" TIMESTAMP(3),
ADD COLUMN "settled_round_id" UUID;

CREATE UNIQUE INDEX "official_results_settled_round_id_key" ON "official_results"("settled_round_id");

ALTER TABLE "official_results" ADD CONSTRAINT "official_results_settled_round_id_fkey" FOREIGN KEY ("settled_round_id") REFERENCES "rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
