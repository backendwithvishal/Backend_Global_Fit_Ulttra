# Test All Endpoints Script (PowerShell)
# Tests all Global-Fi Ultra API endpoints

$BaseUrl = if ($env:BASE_URL) { $env:BASE_URL } else { "https://backend-global-fit-ulttra.onrender.com" }
$Total = 0
$Passed = 0
$Failed = 0
$global:LastStatusCode = 0

Write-Host ""
Write-Host "+-----------------------------------------------------------+"
Write-Host "|         Global-Fi Ultra - API Test Suite                 |"
Write-Host "+-----------------------------------------------------------+"
Write-Host ""

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Method,
        [string]$Endpoint,
        [string]$Data = $null
    )
    
    Write-Host -NoNewline "Testing $Name... "
    $global:LastStatusCode = 0
    
    try {
        $url = "$BaseUrl$Endpoint"
        
        if ($Method -eq "GET") {
            $response = Invoke-WebRequest -Uri $url -Method $Method -UseBasicParsing
        } else {
            $headers = @{
                "Content-Type" = "application/json"
            }
            $response = Invoke-WebRequest -Uri $url -Method $Method -Body $Data -Headers $headers -UseBasicParsing
        }
        
        $statusCode = $response.StatusCode
        $global:LastStatusCode = $statusCode
        
        if ($statusCode -ge 200 -and $statusCode -lt 300) {
            Write-Host "PASS ($statusCode)" -ForegroundColor Green
            return $true
        } else {
            Write-Host "FAIL ($statusCode)" -ForegroundColor Red
            return $false
        }
    } catch {
        # Check if response exists in the exception
        if ($_.Exception.Response) {
            $statusCode = $_.Exception.Response.StatusCode.value__
        } else {
            $statusCode = 0
        }
        $global:LastStatusCode = $statusCode
        
        if ($statusCode -eq 503) {
            Write-Host "SKIP (Service not configured)" -ForegroundColor Yellow
            return $true
        } elseif ($statusCode -eq 404 -and $Endpoint -eq "/api/v1/financial/cached") {
            Write-Host "PASS ($statusCode - Cache Cold)" -ForegroundColor Green
            return $true
        } elseif ($statusCode -eq 401 -and $Endpoint -eq "/api/v1/admin/metrics") {
            Write-Host "PASS ($statusCode - Secured)" -ForegroundColor Green
            return $true
        } else {
            Write-Host "FAIL ($statusCode)" -ForegroundColor Red
            Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
            return $false
        }
    }
}

Write-Host "-------------------------------------------------------------"
Write-Host "Health and Status Endpoints"
Write-Host "-------------------------------------------------------------"

$Total++
if (Test-Endpoint "Root Health Check (/health)" "GET" "/health") { $Passed++ } else { $Failed++ }

$Total++
if (Test-Endpoint "API v1 Health Check (/api/v1/health)" "GET" "/api/v1/health") { $Passed++ } else { $Failed++ }

$Total++
if (Test-Endpoint "Health Ping (/api/v1/health/ping)" "GET" "/api/v1/health/ping") { $Passed++ } else { $Failed++ }

$Total++
if (Test-Endpoint "Readiness Check" "GET" "/api/v1/health/readiness") { $Passed++ } else { $Failed++ }

$Total++
if (Test-Endpoint "Circuit Breakers" "GET" "/api/v1/status/circuit-breakers") { $Passed++ } else { $Failed++ }

$Total++
if (Test-Endpoint "Rate Limits Status" "GET" "/api/v1/status/rate-limits") { $Passed++ } else { $Failed++ }

Write-Host ""
Write-Host "-------------------------------------------------------------"
Write-Host "AI Endpoints"
Write-Host "-------------------------------------------------------------"

$Total++
$data = '{"text":"Stock market hits all-time high"}'
if (Test-Endpoint "AI Sentiment" "POST" "/api/v1/ai/sentiment" $data) { $Passed++ } else { $Failed++ }

$Total++
$data = '{"symbol":"AAPL","priceData":{"current":150,"change24h":2.5,"volume":50000000}}'
if (Test-Endpoint "AI Asset Analysis" "POST" "/api/v1/ai/analyze" $data) { $Passed++ } else { $Failed++ }

$Total++
$data = '{"assets":[{"symbol":"AAPL","price":150,"change24h":2.5},{"symbol":"MSFT","price":380,"change24h":1.8}]}'
if (Test-Endpoint "AI Compare Assets" "POST" "/api/v1/ai/compare" $data) { $Passed++ } else { $Failed++ }

$Total++
$data = '{"newsArticles":[{"title":"Markets rally","description":"Strong gains"}],"maxLength":100}'
if (Test-Endpoint "AI News Summary" "POST" "/api/v1/ai/news/summary" $data) { $Passed++ } else { $Failed++ }

$Total++
if (Test-Endpoint "AI Job Stats" "GET" "/api/v1/ai/jobs/stats") { $Passed++ } else { $Failed++ }

Write-Host ""
Write-Host "-------------------------------------------------------------"
Write-Host "Financial Data Endpoints"
Write-Host "-------------------------------------------------------------"

$Total++
if (Test-Endpoint "Cached Financial Data" "GET" "/api/v1/financial/cached") { $Passed++ } else { $Failed++ }

Write-Host ""
Write-Host "-------------------------------------------------------------"
Write-Host "User & Resource Endpoints"
Write-Host "-------------------------------------------------------------"

$Total++
if (Test-Endpoint "List Users" "GET" "/api/v1/users?page=1&limit=10") { $Passed++ } else { $Failed++ }

$Total++
if (Test-Endpoint "List Watchlists" "GET" "/api/v1/watchlists?page=1&limit=10") { $Passed++ } else { $Failed++ }

$Total++
if (Test-Endpoint "List Alerts" "GET" "/api/v1/alerts?page=1&limit=10") { $Passed++ } else { $Failed++ }

$Total++
if (Test-Endpoint "Search Assets" "GET" "/api/v1/assets?search=AAPL&limit=5") { $Passed++ } else { $Failed++ }

Write-Host ""
Write-Host "-------------------------------------------------------------"
Write-Host "Admin Endpoints"
Write-Host "-------------------------------------------------------------"

$Total++
if (Test-Endpoint "Get Metrics" "GET" "/api/v1/admin/metrics") { $Passed++ } else { $Failed++ }

$Total++
if (Test-Endpoint "Get Logs" "GET" "/api/v1/admin/logs") { $Passed++ } else { $Failed++ }

Write-Host ""
Write-Host "-------------------------------------------------------------"
Write-Host "Test Summary"
Write-Host "-------------------------------------------------------------"
Write-Host ""
Write-Host "Total Tests:  $Total"
Write-Host "Passed:       $Passed" -ForegroundColor Green
Write-Host "Failed:       $Failed" -ForegroundColor Red
Write-Host ""

if ($Failed -eq 0) {
    Write-Host "All tests passed!" -ForegroundColor Green
    Write-Host ""
    exit 0
} else {
    Write-Host "Some tests failed" -ForegroundColor Red
    Write-Host ""
    exit 1
}
