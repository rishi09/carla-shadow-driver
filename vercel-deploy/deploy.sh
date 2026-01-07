#!/bin/bash
# Quick deploy script for Vercel

set -e

echo "🚀 CARLA Shadow Driver - Vercel Deployment"
echo "=========================================="
echo ""

# Check if we're in the right directory
if [ ! -f "index.html" ]; then
    echo "❌ Error: Must run from vercel-deploy directory"
    echo "Run: cd vercel-deploy && bash deploy.sh"
    exit 1
fi

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "📦 Initializing git repository..."
    git init
    git add .
    git commit -m "Initial commit: CARLA Shadow Driver demo"
    echo "✅ Git initialized"
    echo ""
fi

# Check if vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "📥 Vercel CLI not found. Installing..."
    npm install -g vercel
    echo "✅ Vercel CLI installed"
    echo ""
fi

# Deploy
echo "🚀 Deploying to Vercel..."
echo ""
echo "Follow the prompts:"
echo "  - Set up and deploy? Yes"
echo "  - Project name: carla-shadow-driver-demo (or your choice)"
echo "  - Directory: ./"
echo "  - Override settings? No"
echo ""

vercel

echo ""
echo "=========================================="
echo "✅ Deployment complete!"
echo ""
echo "To deploy to production:"
echo "  vercel --prod"
echo ""
echo "To set custom subdomain (carla-sim.vercel.app):"
echo "  1. Go to your Vercel dashboard"
echo "  2. Click on your project"
echo "  3. Settings → Domains"
echo "  4. Add: carla-sim.vercel.app"
echo ""
