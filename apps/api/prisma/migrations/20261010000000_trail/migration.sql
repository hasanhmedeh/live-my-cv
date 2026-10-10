-- The Rally Trail, a buggy time trial outside the park's south fence, takes tickets like every other
-- attraction. (A new enum value can't be used in the migration that adds it, which Postgres runs in
-- one transaction: its settings row and its leaderboard come in the next one.)
ALTER TYPE "attraction" ADD VALUE 'trail' AFTER 'speedway';
