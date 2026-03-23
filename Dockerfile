FROM heroiclabs/nakama:3.22.0
COPY nakama/build/match.js /nakama/data/modules/build/match.js
EXPOSE 7350
ENTRYPOINT ["/bin/sh", "-ecx"]
CMD ["DB=${DATABASE_URL#postgres://}; DB=${DB#postgresql://}; /nakama/nakama migrate up --database.address $DB && exec /nakama/nakama --name nakama1 --database.address $DB --logger.level INFO --socket.max_message_size_bytes 4096 --runtime.js_entrypoint build/match.js --port 7350 --grpc_port 7349 --console_port 7351"]
