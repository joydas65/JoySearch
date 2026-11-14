-- Apply as the migration owner after provisioning the separate joysearch_runtime LOGIN role.
-- This is an operator migration, never a request-time initializer. Enabling the singleton
-- requires a separately recorded $1 allocation from the original local experiment ledger.
BEGIN;

CREATE SCHEMA IF NOT EXISTS joysearch_budget;
REVOKE ALL ON SCHEMA joysearch_budget FROM PUBLIC;

CREATE TABLE IF NOT EXISTS joysearch_budget.budget (
  id smallint PRIMARY KEY CHECK (id = 1),
  cap_micros integer NOT NULL CHECK (cap_micros = 1000000),
  committed_micros integer NOT NULL DEFAULT 0 CHECK (committed_micros >= 0),
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS joysearch_budget.sessions (
  session_key text PRIMARY KEY CHECK (session_key ~ '^[a-f0-9]{64}$'),
  committed_micros integer NOT NULL DEFAULT 0 CHECK (committed_micros >= 0),
  next_search_at timestamptz NOT NULL DEFAULT '-infinity',
  next_answer_at timestamptz NOT NULL DEFAULT '-infinity'
);

CREATE TABLE IF NOT EXISTS joysearch_budget.operations (
  operation_id text PRIMARY KEY CHECK (operation_id ~ '^[a-f0-9]{64}$'),
  session_key text NOT NULL REFERENCES joysearch_budget.sessions(session_key),
  kind text NOT NULL CHECK (kind IN ('search_exa', 'search_brave', 'answer')),
  reserved_micros integer NOT NULL CHECK (reserved_micros IN (5000, 7000, 10000)),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'success', 'provider_error', 'timeout', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metrics) = 'object' AND octet_length(metrics::text) <= 4096)
);

-- Rerunning the migration neither resets commitments nor re-enables the demo.
INSERT INTO joysearch_budget.budget(id, cap_micros, enabled)
VALUES (1, 1000000, false) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION joysearch_budget.reserve(p_operation_id text, p_session_key text, p_kind text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  v_budget joysearch_budget.budget%ROWTYPE;
  v_session joysearch_budget.sessions%ROWTYPE;
  v_operation joysearch_budget.operations%ROWTYPE;
  v_amount integer;
  v_now timestamptz;
  v_next timestamptz;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id !~ '^[a-f0-9]{64}$'
      OR p_session_key IS NULL OR p_session_key !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object('accepted', false, 'code', 'invalid_request');
  END IF;
  v_amount := CASE p_kind WHEN 'search_exa' THEN 7000 WHEN 'search_brave' THEN 5000 WHEN 'answer' THEN 10000 ELSE NULL END;
  IF v_amount IS NULL THEN RETURN jsonb_build_object('accepted', false, 'code', 'invalid_request'); END IF;

  -- Every mutation locks the same singleton first; independent instances cannot oversubscribe it.
  SELECT * INTO v_budget FROM joysearch_budget.budget WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('accepted', false, 'code', 'unavailable'); END IF;
  IF NOT v_budget.enabled THEN RETURN jsonb_build_object('accepted', false, 'code', 'disabled'); END IF;
  v_now := clock_timestamp();

  SELECT * INTO v_operation FROM joysearch_budget.operations WHERE operation_id = p_operation_id;
  IF FOUND THEN
    RETURN jsonb_build_object('accepted', false, 'code', CASE WHEN v_operation.session_key = p_session_key AND v_operation.kind = p_kind THEN 'duplicate' ELSE 'operation_conflict' END);
  END IF;
  IF v_budget.committed_micros + v_amount > v_budget.cap_micros THEN
    RETURN jsonb_build_object('accepted', false, 'code', 'budget_exhausted');
  END IF;

  SELECT * INTO v_session FROM joysearch_budget.sessions WHERE session_key = p_session_key;
  IF FOUND THEN
    IF v_session.committed_micros + v_amount > 50000 THEN
      RETURN jsonb_build_object('accepted', false, 'code', 'session_exhausted');
    END IF;
    v_next := CASE WHEN p_kind = 'answer' THEN v_session.next_answer_at ELSE v_session.next_search_at END;
    IF v_next > v_now THEN
      RETURN jsonb_build_object('accepted', false, 'code', 'rate_limited', 'retryAfterSeconds', ceil(extract(epoch FROM v_next - v_now))::integer);
    END IF;
  ELSE
    INSERT INTO joysearch_budget.sessions(session_key) VALUES (p_session_key);
  END IF;

  INSERT INTO joysearch_budget.operations(operation_id, session_key, kind, reserved_micros, created_at)
  VALUES (p_operation_id, p_session_key, p_kind, v_amount, v_now);
  UPDATE joysearch_budget.sessions SET
    committed_micros = committed_micros + v_amount,
    next_search_at = CASE WHEN p_kind <> 'answer' THEN v_now + interval '5 seconds' ELSE next_search_at END,
    next_answer_at = CASE WHEN p_kind = 'answer' THEN v_now + interval '10 seconds' ELSE next_answer_at END
    WHERE session_key = p_session_key;
  UPDATE joysearch_budget.budget SET committed_micros = committed_micros + v_amount WHERE id = 1;
  RETURN jsonb_build_object('accepted', true, 'operationId', p_operation_id, 'reservedMicros', v_amount,
    'committedMicros', v_budget.committed_micros + v_amount, 'capMicros', v_budget.cap_micros);
END;
$$;

CREATE OR REPLACE FUNCTION joysearch_budget.settle(p_operation_id text, p_status text, p_metrics jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  v_operation joysearch_budget.operations%ROWTYPE;
  v_reported integer;
  v_key text;
  v_value jsonb;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id !~ '^[a-f0-9]{64}$'
      OR p_status IS NULL OR p_status NOT IN ('success', 'provider_error', 'timeout', 'cancelled')
      OR p_metrics IS NULL OR jsonb_typeof(p_metrics) <> 'object' OR octet_length(p_metrics::text) > 4096 THEN
    RETURN jsonb_build_object('accepted', false, 'code', 'invalid_request');
  END IF;
  -- Store bounded operational metadata only: no query, passage, response body, or credentials.
  FOR v_key, v_value IN SELECT * FROM jsonb_each(p_metrics) LOOP
    IF v_key IN ('inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens', 'callCount', 'resultCount', 'reportedCostMicros', 'elapsedMs') THEN
      IF jsonb_typeof(v_value) <> 'number' OR v_value::text !~ '^[0-9]+$' OR (v_value::text)::numeric > 1000000000 THEN
        RETURN jsonb_build_object('accepted', false, 'code', 'invalid_request');
      END IF;
      IF v_key = 'callCount' AND (v_value::text)::integer > 2 THEN
        RETURN jsonb_build_object('accepted', false, 'code', 'invalid_request');
      END IF;
    ELSIF v_key = 'usageComplete' THEN
      IF jsonb_typeof(v_value) <> 'boolean' THEN RETURN jsonb_build_object('accepted', false, 'code', 'invalid_request'); END IF;
    ELSIF v_key = 'providerRequestIds' THEN
      IF jsonb_typeof(v_value) <> 'array' THEN RETURN jsonb_build_object('accepted', false, 'code', 'invalid_request'); END IF;
      IF jsonb_array_length(v_value) > 2 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_value) AS item(value)
        WHERE jsonb_typeof(item.value) <> 'string' OR (item.value #>> '{}') !~ '^[a-zA-Z0-9_:-]{1,160}$'
      ) THEN RETURN jsonb_build_object('accepted', false, 'code', 'invalid_request'); END IF;
    ELSE RETURN jsonb_build_object('accepted', false, 'code', 'invalid_request');
    END IF;
  END LOOP;

  PERFORM 1 FROM joysearch_budget.budget WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('accepted', false, 'code', 'unavailable'); END IF;
  SELECT * INTO v_operation FROM joysearch_budget.operations WHERE operation_id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('accepted', false, 'code', 'unknown_operation'); END IF;
  IF v_operation.status <> 'reserved' THEN RETURN jsonb_build_object('accepted', true, 'alreadySettled', true); END IF;

  UPDATE joysearch_budget.operations SET status = p_status, metrics = p_metrics, settled_at = clock_timestamp()
    WHERE operation_id = p_operation_id;
  -- A changed provider price is an anomaly: retain the larger known cost and disable further work.
  v_reported := coalesce((p_metrics ->> 'reportedCostMicros')::integer, 0);
  IF v_reported > v_operation.reserved_micros THEN
    UPDATE joysearch_budget.budget SET enabled = false,
      committed_micros = committed_micros + v_reported - v_operation.reserved_micros WHERE id = 1;
    UPDATE joysearch_budget.sessions SET committed_micros = committed_micros + v_reported - v_operation.reserved_micros
      WHERE session_key = v_operation.session_key;
  END IF;
  RETURN jsonb_build_object('accepted', true, 'alreadySettled', false);
END;
$$;

CREATE OR REPLACE FUNCTION joysearch_budget.status()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT coalesce((SELECT jsonb_build_object('available', true, 'enabled', enabled,
    'capMicros', cap_micros, 'committedMicros', committed_micros,
    'remainingMicros', greatest(0, cap_micros - committed_micros))
    FROM joysearch_budget.budget WHERE id = 1), jsonb_build_object('available', false, 'enabled', false));
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA joysearch_budget FROM PUBLIC, joysearch_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA joysearch_budget FROM PUBLIC, joysearch_runtime;
REVOKE ALL ON SCHEMA joysearch_budget FROM joysearch_runtime;
GRANT USAGE ON SCHEMA joysearch_budget TO joysearch_runtime;
GRANT EXECUTE ON FUNCTION joysearch_budget.reserve(text, text, text),
  joysearch_budget.settle(text, text, jsonb), joysearch_budget.status() TO joysearch_runtime;

COMMIT;
