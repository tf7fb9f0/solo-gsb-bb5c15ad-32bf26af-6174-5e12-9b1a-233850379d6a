# syntax=docker/dockerfile:1

FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies (reproducible, from the lockfile).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Application code.
COPY server.js ./
COPY src ./src

# Run as the unprivileged node user.
USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
