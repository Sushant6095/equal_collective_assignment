FROM node:20-alpine

WORKDIR /app

# Copy root package files for workspace setup
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./

# Copy shared-types package (dependency)
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-types/tsconfig.json ./packages/shared-types/
COPY packages/shared-types/src ./packages/shared-types/src

# Copy query-api package
COPY services/query-api/package.json ./services/query-api/
COPY services/query-api/tsconfig.json ./services/query-api/
COPY services/query-api/src ./services/query-api/src

# Install dependencies (from root for workspace)
RUN npm ci

# Build shared-types first (dependency)
WORKDIR /app/packages/shared-types
RUN npm run build

# Build TypeScript
WORKDIR /app/services/query-api
RUN npm run build

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
WORKDIR /app/services/query-api
CMD ["npm", "start"]

