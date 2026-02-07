# ── Stage 1: Build ──
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source and config
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

# Build (compile TS, copy schema.sql, add shebang)
RUN node scripts/build.js

# Populate the database
RUN node dist/scrapers/scrape-modules.js

# ── Stage 2: Production ──
FROM node:20-slim AS runtime

WORKDIR /app

# Install only production deps (better-sqlite3 needs rebuild on linux)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled code and pre-built database from builder
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/data/ ./data/
COPY --from=builder /app/src/database/schema.sql ./src/database/schema.sql
COPY bin/ ./bin/

# Non-root user for security
RUN addgroup --system mcp && adduser --system --ingroup mcp mcp
RUN chown -R mcp:mcp /app
USER mcp

# Environment defaults
ENV LOG_LEVEL=error
ENV NODE_ENV=production

# Entry point — stdio transport for MCP
ENTRYPOINT ["node", "dist/mcp/server.js"]
