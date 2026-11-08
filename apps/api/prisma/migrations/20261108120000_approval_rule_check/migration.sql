ALTER TABLE "rounds" ADD CONSTRAINT "rounds_approval_rule_check" CHECK ("approval_rule" IN ('simple', 'three_quarters', 'two_thirds'));
