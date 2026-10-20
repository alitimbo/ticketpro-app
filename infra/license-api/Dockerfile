FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./server.mjs
COPY subscription-notification-policy.mjs ./subscription-notification-policy.mjs
COPY organization-device-limit.mjs ./organization-device-limit.mjs
COPY billing-invoices.mjs ./billing-invoices.mjs
COPY backup-db.mjs ./backup-db.mjs
RUN mkdir -p /data
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "--experimental-sqlite", "server.mjs"]
