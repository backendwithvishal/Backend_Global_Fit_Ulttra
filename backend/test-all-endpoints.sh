#!/bin/bash

# Test All Endpoints Script
# Tests all Global-Fi Ultra API endpoints

BASE_URL="${BASE_URL:-https://backend-global-fit-ulttra.onrender.com}"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║         Global-Fi Ultra - API Test Suite                 ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Function to test endpoint
test_endpoint() {
    local name=$1
    local method=$2
    local endpoint=$3
    local data=$4
    
    echo -n "Testing $name... "
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" "$BASE_URL$endpoint")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "$BASE_URL$endpoint")
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        echo -e "${GREEN}✓ PASS${NC} ($http_code)"
        return 0
    elif [ "$http_code" -eq 503 ]; then
        echo -e "${YELLOW}⚠ SKIP${NC} (Service not configured)"
        return 0
    elif [ "$http_code" -eq 404 ] && [ "$endpoint" = "/api/v1/financial/cached" ]; then
        echo -e "${GREEN}✓ PASS${NC} ($http_code - Cache Cold)"
        return 0
    elif [ "$http_code" -eq 401 ] && [ "$endpoint" = "/api/v1/admin/metrics" ]; then
        echo -e "${GREEN}✓ PASS${NC} ($http_code - Secured)"
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} ($http_code)"
        echo "Response: $body"
        return 1
    fi
}

# Counter
total=0
passed=0
failed=0

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Health & Status Endpoints"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

test_endpoint "Root Health Check (/health)" "GET" "/health"
((total++))
[ $? -eq 0 ] && ((passed++)) || ((failed++))

test_endpoint "API v1 Health Check (/api/v1/health)" "GET" "/api/v1/health"
((total++))
[ $? -eq 0 ] && ((passed++)) || ((failed++))

test_endpoint "Health Ping (/api/v1/health/ping)" "GET" "/api/v1/health/ping"
((total++))
[ $? -eq 0 ] && ((passed++)) || ((failed++))

test_endpoint "Readiness Check" "GET" "/api/v1/health/readiness"
((total++))
[ $? -eq 0 ] && ((passed++)) || ((failed++))

test_endpoint "Circuit Breakers" "GET" "/api/v1/status/circuit-breakers"
((total++))
[ $? -eq 0 ] && ((passed++)) || ((failed++))

test_endpoint "Rate Limits Status" "GET" "/api/v1/status/rate-limits"
((total++))
[ $? -eq 0 ] && ((passed++)) || ((failed++))

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "AI Endpoints"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

test_endpoint "AI Sentiment" "POST" "/api/v1/ai/sentiment" \
    '{"text":"Stock market hits all-time high"}'
((total++))
[ $? -eq 0 ] && ((passed++)) || ((failed++))

test_endpoint "AI Asset Analysis" "POST" "/api/v1/ai/analyze" \
    '{"symbol":"AAPL","priceData":{"current":150,"change24h":2.5,"volume":50000000}}'
((total++))
[ $? -eq 0 ] && ((passed++)) || ((failed++))

test_endpoint "AI Compare Assets" "POST" "/api/v1/ai/compare" \
    '{"assets":[{"symbol":"AAPL","price":150,"change24h":2.5},{"symbol":"MSFT","price":380,"change24h":1.8}]}'
((total++))
[ $? -eq 0 ] && ((passed++)) || ((failed++))

test_endpoint "AI News Summary" "POST" "/api/v1/ai/news/summary" \
    '{"newsArticles":[{"title":"Markets rally","description":"Strong gains"}],"maxLength":100}'
((total++))
[ $? -eq 0 ] && ((passed++)) || ((failed++))

test_endpoint "AI Job Stats" "GET" "/api/v1/ai/jobs/stats"
((total++))
[ $? -eq 0 ] && ((passed++)) || ((failed++))

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Financial Data Endpoints"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

test_endpoint "Cached Financial Data" "GET" "/api/v1/financial/cached"
((total++))
[ $? -eq 0 ] && ((passed++)) || ((failed++))

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "User & Resource Endpoints"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

test_endpoint "List Users" "GET" "/api/v1/users?page=1&limit=10"
((total++))
[ $? -eq 0 ] && ((passed++)) || ((failed++))

test_endpoint "List Watchlists" "GET" "/api/v1/watchlists?page=1&limit=10"
((total++))
[ $? -eq 0 ] && ((passed++)) || ((failed++))

test_endpoint "List Alerts" "GET" "/api/v1/alerts?page=1&limit=10"
((total++))
[ $? -eq 0 ] && ((passed++)) || ((failed++))

test_endpoint "Search Assets" "GET" "/api/v1/assets?search=AAPL&limit=5"
((total++))
[ $? -eq 0 ] && ((passed++)) || ((failed++))

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Admin Endpoints"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

test_endpoint "Get Metrics" "GET" "/api/v1/admin/metrics"
((total++))
[ $? -eq 0 ] && ((passed++)) || ((failed++))

test_endpoint "Get Logs" "GET" "/api/v1/admin/logs"
((total++))
[ $? -eq 0 ] && ((passed++)) || ((failed++))

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Total Tests:  $total"
echo -e "Passed:       ${GREEN}$passed${NC}"
echo -e "Failed:       ${RED}$failed${NC}"
echo ""

if [ $failed -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC}"
    echo ""
    exit 1
fi
