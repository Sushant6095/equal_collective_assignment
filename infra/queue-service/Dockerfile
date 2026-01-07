FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY infra/queue-service/package.json ./
COPY infra/queue-service/tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY infra/queue-service/src ./src

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 3002

# Start the application
CMD ["node", "dist/index.js"]

