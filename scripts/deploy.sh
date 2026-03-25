#!/bin/bash
# Deploy script — called by GitHub Actions or manually
set -e

echo "=== Deploying CRMka ==="

cd /opt/crmka

# Pull latest code
git pull origin main

# Build and restart
docker compose build app
docker compose up -d

# Run database migrations
docker compose exec -T app npx prisma migrate deploy

echo "=== Deploy complete ==="
