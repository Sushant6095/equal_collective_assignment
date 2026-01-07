# Quick Start Guide

## Setup Steps

### 1. Install Dependencies (from root)
```powershell
# From project root directory
npm install
```

**Important**: Always install from the root. The `demo` folder is part of the workspace, so dependencies are managed at the root level.

### 2. Start Infrastructure
```powershell
cd infra
docker-compose up -d
```

Wait ~30 seconds for services to start. Check status:
```powershell
docker-compose ps
```

### 3. Run Demo Pipeline
```powershell
# From root directory
cd demo

# Set ingestion API URL
$env:INGESTION_API_URL = "http://localhost:3000"

# Run the bad pipeline
npm run bad-pipeline
```

### 4. View Dashboard
```powershell
# From root directory
cd apps/dashboard
npm install
npm run dev
```

Open: http://localhost:3000/runs

## Common Issues Fixed

### ❌ "Cannot find module '@xray/sdk-core'"
**Fix**: Install from root, not from demo folder:
```powershell
# ✅ Correct
cd C:\Users\KIIT\Downloads\equal-collective-sample
npm install

# ❌ Wrong
cd demo
npm install
```

### ❌ "docker-compose: no configuration file provided"
**Fix**: Run docker-compose from `infra/` folder:
```powershell
# ✅ Correct
cd infra
docker-compose up -d

# ❌ Wrong
cd demo
docker-compose up -d
```

### ✅ Workspace Setup
The `demo` folder is now part of the npm workspace. Dependencies are resolved automatically when you install from the root.

## Verification

Check if everything is working:

1. **Infrastructure**: `docker-compose ps` (in `infra/` folder)
2. **Ingestion API**: `curl http://localhost:3000/health`
3. **Query API**: `curl http://localhost:3001/health`
4. **Demo**: Run `npm run bad-pipeline` in `demo/` folder
5. **Dashboard**: Open http://localhost:3000/runs

## File Structure

```
equal-collective-sample/
├── packages/          # Shared packages (workspace)
│   ├── sdk-core/      # X-Ray SDK
│   └── shared-types/  # Type definitions
├── services/          # Backend services (workspace)
│   ├── ingestion-api/
│   ├── processor-worker/
│   └── query-api/
├── apps/              # Frontend apps (workspace)
│   └── dashboard/
├── demo/              # Demo pipelines (workspace) ✅
├── infra/             # Docker compose
└── package.json       # Root workspace config
```


