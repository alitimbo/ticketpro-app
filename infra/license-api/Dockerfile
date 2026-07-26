FROM node:22-bookworm-slim
WORKDIR /app
COPY server.mjs ./server.mjs
COPY backup-db.mjs ./backup-db.mjs
RUN mkdir -p /data
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "--experimental-sqlite", "server.mjs"]
