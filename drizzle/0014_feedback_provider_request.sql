-- Earlier PR Preview databases already contain this exact table; retain rows and budget.
CREATE TABLE IF NOT EXISTS feedback_provider_request (
  request_id uuid PRIMARY KEY,
  confirmation_id uuid NOT NULL,
  fingerprint text NOT NULL,
  model text NOT NULL,
  rules_version text NOT NULL,
  reserved_tokens integer NOT NULL CHECK (reserved_tokens > 0),
  observed_tokens integer CHECK (observed_tokens >= 0),
  provider_id text,
  state text NOT NULL DEFAULT 'unknown' CHECK (state IN ('unknown', 'responded')),
  started_at timestamptz NOT NULL DEFAULT now(),
  deadline timestamptz NOT NULL
);
