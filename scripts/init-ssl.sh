#!/bin/bash
# Initial SSL setup — run once on the server
set -e

DOMAIN="dev.umnayacrm.ru"
EMAIL="denis@umnayacrm.ru"

echo "=== Setting up SSL for $DOMAIN ==="

# Use initial config (HTTP only) for certbot challenge
cp nginx/conf.d/default-initial.conf nginx/conf.d/default.conf.bak
cp nginx/conf.d/default-initial.conf nginx/conf.d/default.conf

# Start nginx and app
docker compose up -d nginx app db

# Wait for nginx
sleep 5

# Get certificate
docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

# Restore full config with SSL
cp nginx/conf.d/default.conf.bak nginx/conf.d/default.conf
rm nginx/conf.d/default.conf.bak

# Reload nginx with SSL
docker compose exec nginx nginx -s reload

echo "=== SSL setup complete for $DOMAIN ==="
