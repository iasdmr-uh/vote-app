CREATE FUNCTION official_results_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.registered_at IS NOT NULL AND (NEW.registered_at IS DISTINCT FROM OLD.registered_at OR NEW.approved IS DISTINCT FROM OLD.approved) THEN
      RAISE EXCEPTION 'El resultado ya está registrado como oficial';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.registered_at IS NOT NULL AND EXISTS (SELECT 1 FROM rounds WHERE id = OLD.round_id) THEN
    RAISE EXCEPTION 'El resultado ya está registrado como oficial';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER official_results_guard
BEFORE UPDATE OR DELETE ON official_results
FOR EACH ROW EXECUTE FUNCTION official_results_guard();

CREATE FUNCTION official_result_options_guard() RETURNS trigger AS $$
DECLARE
  entry official_result_options;
BEGIN
  IF TG_OP = 'INSERT' THEN entry := NEW; ELSE entry := OLD; END IF;
  IF EXISTS (SELECT 1 FROM official_results WHERE id = entry.official_result_id AND registered_at IS NOT NULL)
    AND (TG_OP = 'INSERT' OR EXISTS (SELECT 1 FROM ballot_options WHERE id = entry.option_id)) THEN
    RAISE EXCEPTION 'El resultado ya está registrado como oficial';
  END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER official_result_options_guard
BEFORE INSERT OR DELETE ON official_result_options
FOR EACH ROW EXECUTE FUNCTION official_result_options_guard();

CREATE FUNCTION rounds_registered_annul_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'annulled' AND OLD.status <> 'annulled' AND EXISTS (
    SELECT 1 FROM official_results WHERE round_id = COALESCE(NEW.committee_root_round_id, NEW.id) AND registered_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'El resultado ya está registrado como oficial';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rounds_registered_annul_guard
BEFORE UPDATE OF status ON rounds
FOR EACH ROW EXECUTE FUNCTION rounds_registered_annul_guard();
