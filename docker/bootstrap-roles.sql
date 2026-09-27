-- For an existing Postgres where the Docker init script did not run.
-- Connect as a superuser, then run this file twice: once against `postgres`
-- is enough for the roles, and once against each application database for ownership.
-- Example:
--   psql "postgresql://SUPERUSER@127.0.0.1:5432/postgres" -f docker/bootstrap-roles.sql
--   psql "postgresql://SUPERUSER@127.0.0.1:5432/bridgingeden" -f docker/bootstrap-roles.sql
--   psql "postgresql://SUPERUSER@127.0.0.1:5432/bridgingeden_test" -f docker/bootstrap-roles.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridgingeden_owner') THEN
    CREATE ROLE bridgingeden_owner LOGIN PASSWORD 'bridgingeden_owner'
      NOSUPERUSER CREATEDB CREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridgingeden_app') THEN
    CREATE ROLE bridgingeden_app LOGIN PASSWORD 'bridgingeden_app'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;

ALTER ROLE bridgingeden_owner NOSUPERUSER CREATEDB CREATEROLE NOREPLICATION;
ALTER ROLE bridgingeden_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

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
