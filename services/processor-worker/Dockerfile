FROM node:20-alpine

WORKDIR /app

# Copy root package files for workspace setup
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./

# Copy shared-types package (dependency)
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-types/tsconfig.json ./packages/shared-types/
COPY packages/shared-types/src ./packages/shared-types/src

# Copy processor-worker package
COPY services/processor-worker/package.json ./services/processor-worker/
COPY services/processor-worker/tsconfig.json ./services/processor-worker/
COPY services/processor-worker/src ./services/processor-worker/src

# Install dependencies (from root for workspace)
RUN npm ci

# Build shared-types first (dependency)
WORKDIR /app/packages/shared-types
RUN npm run build

# Build TypeScript
WORKDIR /app/services/processor-worker
RUN npm run build

# Start the application
WORKDIR /app/services/processor-worker
CMD ["npm", "start"]

