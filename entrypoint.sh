#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set"
  exit 1
fi

# Strip scheme (postgres:// or postgresql://) using pure shell — no sed needed
DB_ADDR="${DATABASE_URL#*://}"

echo "Starting migrations..."
/nakama/nakama migrate up --database.address "$DB_ADDR"

echo "Starting Nakama server..."
exec /nakama/nakama \
  --name nakama1 \
  --database.address "$DB_ADDR" \
  --logger.level INFO \
  --socket.max_message_size_bytes 4096 \
  --runtime.js_entrypoint build/match.js \
  --port 7350 \
  --grpc_port 7349 \
  --console_port 7351
