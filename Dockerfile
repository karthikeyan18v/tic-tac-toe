FROM heroiclabs/nakama:3.22.0
COPY nakama/build/match.js /nakama/data/modules/build/match.js
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 7350
ENTRYPOINT ["/entrypoint.sh"]
