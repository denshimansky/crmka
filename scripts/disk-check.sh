#!/usr/bin/env bash
# Проверяет диск на сервере и шлёт алерт в Telegram если >85%.
# Запускается из cron каждый час.
#
# Cron (от пользователя deploy):
#   5 * * * *  /opt/crmka/scripts/disk-check.sh
#
# Чтобы не спамить — хранит флаг /tmp/crmka-disk-alerted и шлёт повторно только если уже >90%.

set -euo pipefail

ROOT="${CRMKA_ROOT:-/opt/crmka}"
THRESHOLD_WARN=85
THRESHOLD_CRIT=90
FLAG="/tmp/crmka-disk-alerted"

# Используем корневой раздел (там и docker, и /opt/crmka обычно)
USAGE=$(df --output=pcent / | tail -1 | tr -d ' %')

if [ "$USAGE" -ge "$THRESHOLD_CRIT" ]; then
  "$ROOT/scripts/notify-telegram.sh" "<b>DISK CRITICAL</b>
Host: $(hostname)
Использование /: ${USAGE}% (порог ${THRESHOLD_CRIT}%)
$(df -h / | tail -1)"
  exit 0
fi

if [ "$USAGE" -ge "$THRESHOLD_WARN" ]; then
  if [ ! -f "$FLAG" ]; then
    "$ROOT/scripts/notify-telegram.sh" "<b>DISK WARNING</b>
Host: $(hostname)
Использование /: ${USAGE}% (порог ${THRESHOLD_WARN}%)
$(df -h / | tail -1)"
    touch "$FLAG"
  fi
else
  # Ниже порога — сбрасываем флаг, чтобы при повторном превышении пришёл алерт
  rm -f "$FLAG"
fi
