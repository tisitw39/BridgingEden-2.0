-- For an existing Postgres where the Docker init script did not run.
-- Connect as a superuser. Passwords come from psql variables, not from this file.
--
--   psql "postgresql://SUPERUSER@127.0.0.1:5432/postgres" \
--     -v owner_password="$BRIDGINGEDEN_OWNER_PASSWORD" \
--     -v app_password="$BRIDGINGEDEN_APP_PASSWORD" \
--     -f docker/bootstrap-roles.sql
--   psql "postgresql://SUPERUSER@127.0.0.1:5432/bridgingeden" \
--     -v owner_password="$BRIDGINGEDEN_OWNER_PASSWORD" \
--     -v app_password="$BRIDGINGEDEN_APP_PASSWORD" \
--     -f docker/bootstrap-roles.sql
--   psql "postgresql://SUPERUSER@127.0.0.1:5432/bridgingeden_test" \
--     -v owner_password="$BRIDGINGEDEN_OWNER_PASSWORD" \
--     -v app_password="$BRIDGINGEDEN_APP_PASSWORD" \
--     -f docker/bootstrap-roles.sql
--
-- Use long random passwords. Values equal to the role names are refused.
-- After this script, bridgingeden_owner has neither CREATEDB nor CREATEROLE.

\if :{?owner_password}
\else
  \warn owner_password is required. Pass -v owner_password=... -v app_password=...
  \quit 1
\endif
\if :{?app_password}
\else
  \warn app_password is required. Pass -v owner_password=... -v app_password=...
  \quit 1
\endif

SELECT set_config('bridgingeden.owner_password', :'owner_password', false);
SELECT set_config('bridgingeden.app_password', :'app_password', false);

DO $$
BEGIN
  IF current_setting('bridgingeden.owner_password') = ''
     OR current_setting('bridgingeden.app_password') = ''
     OR current_setting('bridgingeden.owner_password') = 'bridgingeden_owner'
     OR current_setting('bridgingeden.app_password') = 'bridgingeden_app' THEN
    RAISE EXCEPTION 'owner_password and app_password must be set and must not equal the role names';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridgingeden_owner') THEN
    EXECUTE format(
      'CREATE ROLE bridgingeden_owner LOGIN PASSWORD %L NOSUPERUSER CREATEDB CREATEROLE NOREPLICATION',
      current_setting('bridgingeden.owner_password')
    );
  ELSE
    EXECUTE format('ALTER ROLE bridgingeden_owner PASSWORD %L', current_setting('bridgingeden.owner_password'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridgingeden_app') THEN
    EXECUTE format(
      'CREATE ROLE bridgingeden_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
      current_setting('bridgingeden.app_password')
    );
  ELSE
    EXECUTE format('ALTER ROLE bridgingeden_app PASSWORD %L', current_setting('bridgingeden.app_password'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = 'bridgingeden') THEN
    EXECUTE 'ALTER DATABASE bridgingeden OWNER TO bridgingeden_owner';
    EXECUTE 'GRANT CONNECT ON DATABASE bridgingeden TO bridgingeden_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = 'bridgingeden_test') THEN
    EXECUTE 'ALTER DATABASE bridgingeden_test OWNER TO bridgingeden_owner';
    EXECUTE 'GRANT CONNECT ON DATABASE bridgingeden_test TO bridgingeden_app';
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS btree_gist;
GRANT USAGE ON SCHEMA public TO bridgingeden_owner, bridgingeden_app;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO bridgingeden_owner', r.tablename);
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO bridgingeden_owner', r.sequencename);
  END LOOP;
  FOR r IN
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'
  LOOP
    EXECUTE format('ALTER TYPE public.%I OWNER TO bridgingeden_owner', r.typname);
  END LOOP;
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) OWNER TO bridgingeden_owner', r.proname, r.args);
  END LOOP;
END $$;

ALTER ROLE bridgingeden_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE bridgingeden_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
