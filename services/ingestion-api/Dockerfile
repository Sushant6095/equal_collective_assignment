FROM node:20-alpine

WORKDIR /app

# Copy root package files for workspace setup
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./

# Copy shared-types package (dependency)
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-types/tsconfig.json ./packages/shared-types/
COPY packages/shared-types/src ./packages/shared-types/src

# Copy ingestion-api package
COPY services/ingestion-api/package.json ./services/ingestion-api/
COPY services/ingestion-api/tsconfig.json ./services/ingestion-api/
COPY services/ingestion-api/src ./services/ingestion-api/src

# Install dependencies (from root for workspace)
RUN npm ci

# Build shared-types first (dependency)
WORKDIR /app/packages/shared-types
RUN npm run build

# Build TypeScript
WORKDIR /app/services/ingestion-api
RUN npm run build

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
WORKDIR /app/services/ingestion-api
CMD ["npm", "start"]

