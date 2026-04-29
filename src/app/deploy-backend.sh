#!/bin/bash

# Contndr Backend Deployment Script
# This script deploys the Supabase Edge Function backend

set -e

echo "Contndr Backend Deployment"
echo "============================"
echo ""

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "Supabase CLI is not installed."
    echo "Run with: npx supabase functions deploy"
    exit 1
fi

echo "Supabase CLI found"
echo ""

# Project details
PROJECT_REF="${SUPABASE_PROJECT_REF:-zylftkvcasvznhkmyzfj}"
FUNCTION_NAME="${SUPABASE_FUNCTION_NAME:-make-server-a8b2511f}"

echo "📋 Project: $PROJECT_REF"
echo "📦 Function: $FUNCTION_NAME"
echo ""

# Check if we need to restructure files
if [ ! -d "supabase/functions/$FUNCTION_NAME" ]; then
    echo "📁 Restructuring files for Supabase CLI..."
    mkdir -p "supabase/functions/$FUNCTION_NAME"
    
    # Copy all files from server directory
    if [ -d "supabase/functions/server" ]; then
        cp -r supabase/functions/server/* "supabase/functions/$FUNCTION_NAME/"
        if [ -f "supabase/functions/$FUNCTION_NAME/index.tsx" ]; then
            cp "supabase/functions/$FUNCTION_NAME/index.tsx" "supabase/functions/$FUNCTION_NAME/index.ts"
        fi
        echo "✅ Files copied to supabase/functions/$FUNCTION_NAME/"
    else
        echo "❌ Source directory supabase/functions/server not found!"
        exit 1
    fi
fi

echo ""
echo "🔗 Linking to Supabase project..."
supabase link --project-ref $PROJECT_REF

echo ""
echo "🚀 Deploying Edge Function..."
supabase functions deploy $FUNCTION_NAME --project-ref $PROJECT_REF --no-verify-jwt --use-api

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📋 Next steps:"
echo "1. Set environment variables in Supabase Dashboard → Edge Functions → $FUNCTION_NAME → Settings"
echo "2. Or use: supabase secrets set KEY=VALUE"
echo ""
echo "Required environment variables:"
echo "  - SUPABASE_URL"
echo "  - SUPABASE_SERVICE_ROLE_KEY"
echo "  - SUPABASE_ANON_KEY"
echo "  - OPENAI_API_KEY"
echo "  - RESEND_API_KEY"
echo "  - TELNYX_API_KEY"
echo "  - ELEVENLABS_API_KEY"
echo "  - CALENDLY_API_KEY"
echo "  - FINDYMAIL_API_KEY"
echo "  - STRIPE_SECRET_KEY"
echo ""
echo "3. Test the endpoint:"
echo "   curl https://$PROJECT_REF.supabase.co/functions/v1/$FUNCTION_NAME/leads/count \\"
echo "     -H 'Authorization: Bearer YOUR_ANON_KEY'"
echo ""
