# Global_Fit_Ulttra - Hardened Production Dockerfile
# Stage 1: Dependency builder
FROM node:20.18.0-alpine3.20 AS builder

WORKDIR /app
COPY backend/package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

# Stage 2: Final Minimal Runtime Image
FROM node:20.18.0-alpine3.20 AS production

# Install tini for reliable PID 1 signal forwarding and zombie reaping
RUN apk add --no-cache tini

ENV NODE_ENV=production
WORKDIR /app

# Create dedicated unprivileged user and group
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy installed production node_modules from builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs backend/package*.json ./

# Copy only production application code (exclude docs, examples, tests, benchmarks)
COPY --chown=nodejs:nodejs backend/src ./src
COPY --chown=nodejs:nodejs backend/server.js ./server.js

# Create runtime directories for logs and RAG uploads outside web root with correct ownership
RUN mkdir -p logs uploads/rag data/financial_documents && \
    chown -R nodejs:nodejs logs uploads data

# Switch to unprivileged runtime user
USER nodejs

# Expose standardized application port (10000 for Render / container runtime)
EXPOSE 10000

# Container healthcheck querying internal loopback
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "const port = process.env.PORT || 10000; import('http').then(h => h.get('http://127.0.0.1:' + port + '/api/v1/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1)))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]