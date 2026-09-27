#!/bin/sh
# Runs once, as the Docker superuser, on a new data volume.
# Passwords come from the container environment. They must not equal the role names.
# After the databases exist, CREATEDB and CREATEROLE are taken off the owner.
set -eu

if [ -z "${BRIDGINGEDEN_OWNER_PASSWORD:-}" ] || [ -z "${BRIDGINGEDEN_APP_PASSWORD:-}" ]; then
  echo "Set BRIDGINGEDEN_OWNER_PASSWORD and BRIDGINGEDEN_APP_PASSWORD before starting Postgres." >&2
  exit 1
fi
if [ "$BRIDGINGEDEN_OWNER_PASSWORD" = "bridgingeden_owner" ] || [ "$BRIDGINGEDEN_APP_PASSWORD" = "bridgingeden_app" ]; then
  echo "Role passwords must not equal the role names." >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_password="$BRIDGINGEDEN_OWNER_PASSWORD" \
  -v app_password="$BRIDGINGEDEN_APP_PASSWORD" <<'SQL'
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
    EXECUTE format(
      'ALTER ROLE bridgingeden_owner PASSWORD %L',
      current_setting('bridgingeden.owner_password')
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridgingeden_app') THEN
    EXECUTE format(
      'CREATE ROLE bridgingeden_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
      current_setting('bridgingeden.app_password')
    );
  ELSE
    EXECUTE format(
      'ALTER ROLE bridgingeden_app PASSWORD %L',
      current_setting('bridgingeden.app_password')
    );
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

-- Bootstrap is finished. The owner keeps table ownership and nothing else.
ALTER ROLE bridgingeden_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE bridgingeden_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
SQL
