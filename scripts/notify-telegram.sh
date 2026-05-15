#!/usr/bin/env bash
# Отправляет сообщение в Telegram. Тихо ничего не делает если TELEGRAM_BOT_TOKEN/CHAT_ID не заданы.
# Использование: notify-telegram.sh "Текст сообщения"
# Читает токен из .env в /opt/crmka (или $CRMKA_ROOT, если задан).

set -euo pipefail

ROOT="${CRMKA_ROOT:-/opt/crmka}"
if [ -f "$ROOT/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$ROOT/.env"; set +a
fi

TOKEN="${TELEGRAM_BOT_TOKEN:-}"
CHAT="${TELEGRAM_CHAT_ID:-}"
MSG="${1:-}"

if [ -z "$TOKEN" ] || [ -z "$CHAT" ] || [ -z "$MSG" ]; then
  exit 0
fi

curl -fsS --max-time 10 \
  -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -d "chat_id=${CHAT}" \
  -d "parse_mode=HTML" \
  --data-urlencode "text=${MSG}" \
  > /dev/null || true
