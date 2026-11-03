-- Nov 3 2026 (#48): the mesa presents the elected officials on the projector, slide by slide.
-- 0 is the cover, 1 the Junta directiva and 2 the Departamentos.
ALTER TABLE "assemblies"
  ADD COLUMN "presentation_active" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "presentation_slide" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "assemblies_presentation_slide_check" CHECK ("presentation_slide" BETWEEN 0 AND 2);
