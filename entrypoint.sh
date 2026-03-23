#!/bin/sh
set -e

# Build DB address from individual PG variables (Railway provides these automatically)
# Format Nakama expects: user:password@host:port/dbname
if [ -n "$PGHOST" ] && [ -n "$PGUSER" ] && [ -n "$PGPASSWORD" ] && [ -n "$PGDATABASE" ]; then
  PORT="${PGPORT:-5432}"
  DB_ADDR="${PGUSER}:${PGPASSWORD}@${PGHOST}:${PORT}/${PGDATABASE}"
elif [ -n "$DATABASE_URL" ]; then
  # Strip postgres:// or postgresql:// scheme
  DB_ADDR="${DATABASE_URL#*://}"
else
  echo "ERROR: No database configuration found. Set PGHOST/PGUSER/PGPASSWORD/PGDATABASE or DATABASE_URL"
  exit 1
fi

echo "Connecting to: ${PGHOST:-unknown host}"
echo "Starting migrations..."
/nakama/nakama migrate up --database.address "$DB_ADDR"

echo "Starting Nakama server..."
exec /nakama/nakama \
  --name nakama1 \
  --database.address "$DB_ADDR" \
  --logger.level INFO \
  --socket.max_message_size_bytes 4096 \
  --runtime.js_entrypoint build/match.js \
  --socket.port 7350 \
  --console.port 7351
