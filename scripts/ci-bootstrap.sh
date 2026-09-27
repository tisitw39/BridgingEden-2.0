#!/bin/sh
# Bootstrap a fresh Postgres for CI.
#
# docker/bootstrap-roles.sql creates the roles and then removes CREATEDB from
# bridgingeden_owner. It does not create databases. This script therefore:
#   1. runs the SQL on the maintenance database to create the roles
#   2. creates bridgingeden and bridgingeden_test as the superuser
#   3. runs the SQL again on each database for btree_gist and the grants
#
# Passwords are generated here. On GitHub Actions each secret is registered with
# ::add-mask:: before it is written to GITHUB_ENV, so the run log redacts it.
# Locally the values are written to /tmp/ci-database.env and are not printed.
set -eu

OWNER_PW="$(openssl rand -hex 24)"
APP_PW="$(openssl rand -hex 24)"
HMAC_KEY="$(openssl rand -hex 32)"
AUTH_SECRET_VALUE="$(openssl rand -hex 32)"

if [ "$OWNER_PW" = "bridgingeden_owner" ] || [ "$APP_PW" = "bridgingeden_app" ]; then
  echo "Refusing generated passwords that equal the role names." >&2
  exit 1
fi

if [ -n "${GITHUB_ENV:-}" ]; then
  # Mask before any later step can print a URL or env dump that contains them.
  printf '%s\n' "::add-mask::${OWNER_PW}"
  printf '%s\n' "::add-mask::${APP_PW}"
  printf '%s\n' "::add-mask::${HMAC_KEY}"
  printf '%s\n' "::add-mask::${AUTH_SECRET_VALUE}"
fi

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:?Set PGPASSWORD to the bootstrap superuser password.}"

psql_q() {
  # stdout is discarded so set_config does not print the role passwords.
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -q "$@" >/tmp/ci-bootstrap.out
}

echo "Creating roles with docker/bootstrap-roles.sql"
psql_q -d postgres \
  -v owner_password="$OWNER_PW" \
  -v app_password="$APP_PW" \
  -f docker/bootstrap-roles.sql

echo "Creating databases as the superuser (the owner no longer has CREATEDB)"
psql_q -d postgres <<SQL
CREATE DATABASE bridgingeden OWNER bridgingeden_owner;
CREATE DATABASE bridgingeden_test OWNER bridgingeden_owner;
SQL

echo "Granting on bridgingeden and bridgingeden_test"
psql_q -d bridgingeden \
  -v owner_password="$OWNER_PW" \
  -v app_password="$APP_PW" \
  -f docker/bootstrap-roles.sql
psql_q -d bridgingeden_test \
  -v owner_password="$OWNER_PW" \
  -v app_password="$APP_PW" \
  -f docker/bootstrap-roles.sql

ENV_BODY=$(cat <<EOF
BRIDGINGEDEN_OWNER_PASSWORD=${OWNER_PW}
BRIDGINGEDEN_APP_PASSWORD=${APP_PW}
AUDIT_EMAIL_HMAC_KEY=${HMAC_KEY}
AUTH_SECRET=${AUTH_SECRET_VALUE}
AUTH_URL=http://localhost:3000
DATABASE_URL=postgresql://bridgingeden_app:${APP_PW}@${PGHOST}:${PGPORT}/bridgingeden?schema=public
DIRECT_URL=postgresql://bridgingeden_owner:${OWNER_PW}@${PGHOST}:${PGPORT}/bridgingeden?schema=public
TEST_DATABASE_URL=postgresql://bridgingeden_app:${APP_PW}@${PGHOST}:${PGPORT}/bridgingeden_test?schema=public
TEST_DIRECT_URL=postgresql://bridgingeden_owner:${OWNER_PW}@${PGHOST}:${PGPORT}/bridgingeden_test?schema=public
EOF
)

if [ -n "${GITHUB_ENV:-}" ]; then
  printf '%s\n' "$ENV_BODY" >> "$GITHUB_ENV"
else
  umask 077
  printf '%s\n' "$ENV_BODY" > /tmp/ci-database.env
  echo "Wrote database URLs to /tmp/ci-database.env"
fi

echo "Bootstrap finished. Databases: bridgingeden, bridgingeden_test."
