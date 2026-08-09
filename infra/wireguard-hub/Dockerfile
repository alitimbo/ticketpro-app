FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends wireguard-tools iptables iproute2 procps \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.mjs /app/server.mjs
COPY peer-lifecycle.mjs /app/peer-lifecycle.mjs
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

ENTRYPOINT ["/app/start.sh"]
