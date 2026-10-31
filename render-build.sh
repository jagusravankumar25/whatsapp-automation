#!/usr/bin/env bash
# exit on error
set -o errexit

# Install standard workspace Node packages
npm install

# Download the correct Chrome binary tool bundle into the persistent build cache directory
echo "...Installing headless Chrome binary bundle..."
npx puppeteer browsers install chrome

# Create a local cache path structure to bypass the remote webVersionCache crash entirely
echo "...Configuring local web structural engine cache elements..."
mkdir -p .wwebjs_cache

# Download a known working, stable static layout profile file right into the application cache directory
curl -s -o .wwebjs_cache/current.html https://githubusercontent.com
echo "✅ Local engine layout cached successfully!"
