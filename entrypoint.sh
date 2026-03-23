#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set"
  exit 1
fi

# Strip postgresql:// or postgres:// scheme safely (handles special chars in password)
DB_ADDR=$(printf '%s' "$DATABASE_URL" | sed 's|^postgres[a-z]*://||')

echo "DB_ADDR=$DB_ADDR"
echo "Running migrations..."
/nakama/nakama migrate up --database.address "$DB_ADDR"

echo "Starting Nakama..."
exec /nakama/nakama \
  --name nakama1 \
  --database.address "$DB_ADDR" \
  --logger.level INFO \
  --socket.max_message_size_bytes 4096 \
  --runtime.js_entrypoint build/match.js \
  --port 7350 \
  --grpc_port 7349 \
  --console_port 7351
