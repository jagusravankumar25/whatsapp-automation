#!/usr/bin/env bash
# exit on error
set -o errexit

# Install standard workspace Node packages
npm install

# Download the correct Chrome binary tool bundle into the persistent build cache directory
echo "...Installing headless Chrome binary bundle..."
npx puppeteer browsers install chrome
