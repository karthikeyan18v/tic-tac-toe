FROM heroiclabs/nakama:3.22.0
COPY nakama/build/match.js /nakama/data/modules/build/match.js
EXPOSE 7349 7350 7351
ENTRYPOINT ["/bin/sh", "-ecx"]
CMD ["DB=${DATABASE_URL#postgres://}; /nakama/nakama migrate up --database.address $DB && exec /nakama/nakama --name nakama1 --database.address $DB --logger.level INFO --socket.max_message_size_bytes 4096 --runtime.js_entrypoint build/match.js"]
