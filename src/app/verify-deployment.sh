#!/bin/bash

# Contndr Deployment Verification Script
# Run this after deploying to verify everything works

set -e

PROJECT_REF="zylftkvcasvznhkmyzfj"
BASE_URL="https://${PROJECT_REF}.supabase.co/functions/v1/make-server-a8b2511f"

echo "🔍 Contndr Deployment Verification"
echo "=================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Ping endpoint
echo "1️⃣  Testing /ping endpoint..."
PING_RESPONSE=$(curl -s "${BASE_URL}/ping")
PING_STATUS=$(echo $PING_RESPONSE | grep -o '"ok":true' || echo "")

if [ -n "$PING_STATUS" ]; then
    echo -e "${GREEN}✅ Ping successful${NC}"
    echo "   Response: $PING_RESPONSE"
else
    echo -e "${RED}❌ Ping failed${NC}"
    echo "   Response: $PING_RESPONSE"
    exit 1
fi
echo ""

# Test 2: AI test endpoint
echo "2️⃣  Testing /test-ai endpoint..."
AI_RESPONSE=$(curl -s "${BASE_URL}/test-ai")
AI_MODEL=$(echo $AI_RESPONSE | grep -o '"model":"[^"]*"' || echo "")

if echo "$AI_MODEL" | grep -q "gemini-2.0-flash"; then
    echo -e "${GREEN}✅ AI test successful - Using gemini-2.0-flash${NC}"
    echo "   Model: $AI_MODEL"
elif echo "$AI_MODEL" | grep -q "gemini-2.5-flash-preview"; then
    echo -e "${RED}❌ Still using old model!${NC}"
    echo "   Model: $AI_MODEL"
    echo -e "${YELLOW}⚠️  The deployment may not have taken effect yet.${NC}"
    echo "   Try redeploying or check Supabase Functions dashboard."
    exit 1
else
    echo -e "${YELLOW}⚠️  AI test returned unexpected response${NC}"
    echo "   Full response: $AI_RESPONSE"
    
    # Check if it's an error
    if echo "$AI_RESPONSE" | grep -q '"status":"error"'; then
        echo -e "${RED}❌ AI provider error detected${NC}"
        ERROR_MSG=$(echo $AI_RESPONSE | grep -o '"error":"[^"]*"' || echo "Unknown error")
        echo "   Error: $ERROR_MSG"
        
        # Check if GEMINI_API_KEY is set
        KEY_SET=$(echo $AI_RESPONSE | grep -o '"gemini_key_set":[^,}]*' || echo "")
        echo "   $KEY_SET"
    fi
    exit 1
fi
echo ""

# Test 3: Check latency
LATENCY=$(echo $AI_RESPONSE | grep -o '"latency_ms":[0-9]*' | grep -o '[0-9]*')
if [ -n "$LATENCY" ]; then
    if [ "$LATENCY" -lt 2000 ]; then
        echo -e "${GREEN}✅ Latency good: ${LATENCY}ms${NC}"
    elif [ "$LATENCY" -lt 5000 ]; then
        echo -e "${YELLOW}⚠️  Latency acceptable: ${LATENCY}ms${NC}"
    else
        echo -e "${RED}⚠️  Latency high: ${LATENCY}ms${NC}"
        echo "   Function may be cold-starting"
    fi
else
    echo -e "${YELLOW}⚠️  Could not determine latency${NC}"
fi
echo ""

# Summary
echo "=================================="
echo -e "${GREEN}✅ All tests passed!${NC}"
echo ""
echo "Next steps:"
echo "1. Test the app in browser"
echo "2. Create a campaign to verify AI features"
echo "3. Monitor server logs for any errors"
echo ""
echo "If users report module import errors, tell them to:"
echo "  - Hard refresh: Ctrl+Shift+R (or Cmd+Shift+R on Mac)"
echo "  - Clear browser cache"
echo ""
