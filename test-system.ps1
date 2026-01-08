# PowerShell System Verification Script

Write-Host "🔍 X-Ray System Verification" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

# Check if services are running
Write-Host "1. Checking Docker services..." -ForegroundColor Yellow
$ingestion = docker ps --filter "name=xray-ingestion-api" --format "{{.Names}}"
$query = docker ps --filter "name=xray-query-api" --format "{{.Names}}"
$worker = docker ps --filter "name=xray-processor-worker" --format "{{.Names}}"

if ($ingestion) {
    Write-Host "✅ Ingestion API is running" -ForegroundColor Green
} else {
    Write-Host "❌ Ingestion API is not running" -ForegroundColor Red
    Write-Host "   Run: cd infra; docker-compose up -d" -ForegroundColor Yellow
    exit 1
}

if ($query) {
    Write-Host "✅ Query API is running" -ForegroundColor Green
} else {
    Write-Host "❌ Query API is not running" -ForegroundColor Red
}

if ($worker) {
    Write-Host "✅ Processor Worker is running" -ForegroundColor Green
} else {
    Write-Host "⚠️  Processor Worker is not running (may be starting)" -ForegroundColor Yellow
}

Write-Host ""

# Test Ingestion API
Write-Host "2. Testing Ingestion API..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000/health" -Method GET -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Ingestion API health check: OK" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Ingestion API health check failed" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
}

# Test Query API
Write-Host "3. Testing Query API..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/health" -Method GET -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Query API health check: OK" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Query API health check failed" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
}

# Test sending an event
Write-Host "4. Testing event ingestion..." -ForegroundColor Yellow
$testRun = @{
    type = "run"
    data = @{
        id = "test-run-verification"
        pipelineId = "test-pipeline"
        status = "completed"
        input = @{ test = "data" }
        output = @{ result = "ok" }
        startedAt = "2024-01-01T00:00:00Z"
        completedAt = "2024-01-01T00:05:00Z"
        error = $null
    }
} | ConvertTo-Json -Depth 10

try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000/ingest" -Method POST `
        -Body $testRun -ContentType "application/json" -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Event ingestion: OK" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Event ingestion failed" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "5. Waiting 5 seconds for processing..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Test querying
Write-Host "6. Testing query API..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/runs" -Method GET -UseBasicParsing -TimeoutSec 5
    $content = $response.Content | ConvertFrom-Json
    if ($content.success) {
        Write-Host "✅ Query API: OK" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Query API failed" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "==============================" -ForegroundColor Cyan
Write-Host "Verification complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Run demo pipeline: cd demo; npm run bad-pipeline"
Write-Host "2. View dashboard: cd apps/dashboard; npm run dev"
Write-Host "3. Open http://localhost:3000/runs in browser"






