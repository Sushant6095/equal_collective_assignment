#!/bin/bash
# System Verification Script

echo "🔍 X-Ray System Verification"
echo "=============================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if services are running
echo "1. Checking Docker services..."
if docker ps | grep -q "xray-ingestion-api"; then
    echo -e "${GREEN}✅ Ingestion API is running${NC}"
else
    echo -e "${RED}❌ Ingestion API is not running${NC}"
    echo "   Run: cd infra && docker-compose up -d"
    exit 1
fi

if docker ps | grep -q "xray-query-api"; then
    echo -e "${GREEN}✅ Query API is running${NC}"
else
    echo -e "${RED}❌ Query API is not running${NC}"
fi

if docker ps | grep -q "xray-processor-worker"; then
    echo -e "${GREEN}✅ Processor Worker is running${NC}"
else
    echo -e "${YELLOW}⚠️  Processor Worker is not running (may be starting)${NC}"
fi

echo ""

# Test Ingestion API
echo "2. Testing Ingestion API..."
INGESTION_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health)
if [ "$INGESTION_HEALTH" = "200" ]; then
    echo -e "${GREEN}✅ Ingestion API health check: OK${NC}"
else
    echo -e "${RED}❌ Ingestion API health check failed (HTTP $INGESTION_HEALTH)${NC}"
fi

# Test Query API
echo "3. Testing Query API..."
QUERY_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/health)
if [ "$QUERY_HEALTH" = "200" ]; then
    echo -e "${GREEN}✅ Query API health check: OK${NC}"
else
    echo -e "${RED}❌ Query API health check failed (HTTP $QUERY_HEALTH)${NC}"
fi

# Test sending an event
echo "4. Testing event ingestion..."
TEST_RUN=$(curl -s -X POST http://localhost:3000/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "type": "run",
    "data": {
      "id": "test-run-verification",
      "pipelineId": "test-pipeline",
      "status": "completed",
      "input": {"test": "data"},
      "output": {"result": "ok"},
      "startedAt": "2024-01-01T00:00:00Z",
      "completedAt": "2024-01-01T00:05:00Z",
      "error": null
    }
  }')

if echo "$TEST_RUN" | grep -q "success"; then
    echo -e "${GREEN}✅ Event ingestion: OK${NC}"
else
    echo -e "${RED}❌ Event ingestion failed${NC}"
    echo "   Response: $TEST_RUN"
fi

echo ""
echo "5. Waiting 5 seconds for processing..."
sleep 5

# Test querying
echo "6. Testing query API..."
RUNS=$(curl -s http://localhost:3001/runs)
if echo "$RUNS" | grep -q "test-run-verification"; then
    echo -e "${GREEN}✅ Query API: OK (found test run)${NC}"
elif echo "$RUNS" | grep -q "success"; then
    echo -e "${YELLOW}⚠️  Query API: OK (but test run not found yet - may need more time)${NC}"
else
    echo -e "${RED}❌ Query API failed${NC}"
    echo "   Response: $RUNS"
fi

echo ""
echo "=============================="
echo -e "${GREEN}Verification complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Run demo pipeline: cd demo && npm run bad-pipeline"
echo "2. View dashboard: cd apps/dashboard && npm run dev"
echo "3. Open http://localhost:3000/runs in browser"






