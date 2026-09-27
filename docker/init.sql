-- Runs once, as the Docker superuser, on a new data volume.
-- The application never uses this superuser. Migrations use bridgingeden_owner.
-- The Next.js app uses bridgingeden_app.

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

CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER DATABASE bridgingeden OWNER TO bridgingeden_owner;
GRANT CONNECT ON DATABASE bridgingeden TO bridgingeden_app;

SELECT 'CREATE DATABASE bridgingeden_test OWNER bridgingeden_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'bridgingeden_test')\gexec

\c bridgingeden_test
CREATE EXTENSION IF NOT EXISTS btree_gist;
GRANT CONNECT ON DATABASE bridgingeden_test TO bridgingeden_app;
GRANT USAGE ON SCHEMA public TO bridgingeden_owner, bridgingeden_app;

\c bridgingeden
GRANT USAGE ON SCHEMA public TO bridgingeden_owner, bridgingeden_app;
