-- Committee members keep the order they were elected in, because that order is shown to the assembly.
-- Existing results rank earlier votes first, then most votes, then ballot order.
ALTER TABLE "official_result_options" ADD COLUMN "seat_order" INTEGER;

UPDATE "official_result_options" AS seat
SET "seat_order" = ranked."place"
FROM (
  SELECT
    result_option."official_result_id",
    result_option."option_id",
    row_number() OVER (
      PARTITION BY result_option."official_result_id"
      ORDER BY
        round."created_at",
        (SELECT count(*) FROM "anonymous_votes" AS vote WHERE vote."option_id" = option."id") DESC,
        option."order"
    ) - 1 AS "place"
  FROM "official_result_options" AS result_option
  JOIN "ballot_options" AS option ON option."id" = result_option."option_id"
  JOIN "rounds" AS round ON round."id" = option."round_id"
) AS ranked
WHERE seat."official_result_id" = ranked."official_result_id"
  AND seat."option_id" = ranked."option_id";

ALTER TABLE "official_result_options" ALTER COLUMN "seat_order" SET NOT NULL;
