# X-Ray Dashboard

Minimal Next.js dashboard for debugging X-Ray decision traces.

## Features

- **Runs List**: View all runs with problematic steps highlighted
- **Run Details**: Step timeline with drill-down capability
- **Step Details**: Full decision event breakdown

## Pages

- `/runs` - List all runs (highlights problematic ones)
- `/runs/[id]` - Run detail with step timeline
- `/runs/[id]/steps/[stepId]` - Step detail with decision events

## Highlighting

Steps with elimination ratio > 80% are highlighted in yellow and marked with ⚠.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Configuration

Set `NEXT_PUBLIC_QUERY_API_URL` environment variable to point to query API (default: http://localhost:3001)

## Build

```bash
npm run build
npm start
```

