-- Nov 3 2026: the org chart of Unión Hondureña (junta directiva and departamentos). A cargo names the
-- box its elected fills, so the acta and the projector place each elected; the Asamblea records its period.
CREATE TYPE "PositionGroup" AS ENUM ('board', 'department');

ALTER TABLE "assemblies" ADD COLUMN "period" TEXT;

CREATE TABLE "positions" (
    "id" UUID NOT NULL,
    "assembly_id" UUID NOT NULL,
    "group" "PositionGroup" NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "custom" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "positions_assembly_id_label_key" ON "positions"("assembly_id", "label");
CREATE INDEX "positions_assembly_id_group_sort_order_idx" ON "positions"("assembly_id", "group", "sort_order");

ALTER TABLE "positions" ADD CONSTRAINT "positions_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rounds" ADD COLUMN "position_id" UUID;
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
