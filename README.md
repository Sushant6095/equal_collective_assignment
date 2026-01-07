# X-Ray Monorepo

TypeScript monorepo for the X-Ray Decision Observability System using npm workspaces.

## Structure

```
xray-monorepo/
├── packages/
│   ├── sdk-core/          # Core SDK library
│   └── shared-types/       # Shared TypeScript types
├── services/
│   ├── ingestion-api/     # Ingestion API service
│   ├── processor-worker/  # Processor worker service
│   └── query-api/         # Query API service
├── apps/
│   └── dashboard/         # Dashboard application
└── infra/                 # Infrastructure configurations
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Installation

```bash
npm install
```

This will install all dependencies for all workspaces.

### Building

Build all packages and services:

```bash
npm run build
```

Build specific workspace types:

```bash
npm run build:packages
npm run build:services
npm run build:apps
```

### Development

Each package/service can be run independently:

```bash
# From root
npm run dev --workspace=@xray/ingestion-api

# Or from the package directory
cd services/ingestion-api
npm run dev
```

## Workspace Dependencies

Packages can depend on each other using workspace protocol:

```json
{
  "dependencies": {
    "@xray/shared-types": "*"
  }
}
```

## TypeScript Project References

The monorepo uses TypeScript project references for efficient compilation:

- `tsconfig.base.json` - Base configuration shared by all packages
- Each package has its own `tsconfig.json` extending the base
- Project references enable incremental builds and type checking across packages

## Scripts

- `npm run build` - Build all workspaces
- `npm run clean` - Clean all build artifacts
- `npm run lint` - Lint all workspaces
- `npm run test` - Run tests in all workspaces
