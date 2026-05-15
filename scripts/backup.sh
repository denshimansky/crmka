#!/usr/bin/env bash
# pg_dump CRMka postgres в /opt/crmka/backups/<kind>/.
#
# Использование:
#   backup.sh daily    # ежедневный (хранится 7 дней)
#   backup.sh weekly   # еженедельный (хранится 4 недели)
#
# Cron на сервере (от пользователя deploy):
#   15 3 * * *  /opt/crmka/scripts/backup.sh daily   >> /var/log/crmka-backup.log 2>&1
#   30 3 * * 0  /opt/crmka/scripts/backup.sh weekly  >> /var/log/crmka-backup.log 2>&1
#
# Алерты в Telegram идут только при ошибке (успех — молча).

set -euo pipefail

KIND="${1:-daily}"
ROOT="${CRMKA_ROOT:-/opt/crmka}"
BACKUP_DIR="$ROOT/backups/$KIND"
TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
OUT="$BACKUP_DIR/crmka-$TIMESTAMP.sql.gz"

case "$KIND" in
  daily)  RETAIN_DAYS=7 ;;
  weekly) RETAIN_DAYS=28 ;;
  *) echo "Usage: $0 {daily|weekly}" >&2; exit 2 ;;
esac

mkdir -p "$BACKUP_DIR"

notify_fail() {
  local message="$1"
  "$ROOT/scripts/notify-telegram.sh" "<b>BACKUP FAILED</b> ($KIND)
Host: $(hostname)
Error: $message
Time: $(date -Iseconds)"
}

trap 'notify_fail "Скрипт упал на строке $LINENO"' ERR

cd "$ROOT"

# Дамп через docker compose exec в работающий контейнер db
# -T = без TTY (для cron); pg_dump --clean --if-exists для безопасного restore
if ! docker compose exec -T db pg_dump \
       -U "${POSTGRES_USER:-crmka}" \
       -d "${POSTGRES_DB:-crmka}" \
       --clean --if-exists --no-owner \
     | gzip -9 > "$OUT.tmp"; then
  rm -f "$OUT.tmp"
  notify_fail "pg_dump вернул ненулевой код"
  exit 1
fi

# Проверяем, что дамп не пустой (gzip header = 20 байт, минимальный дамп ~1 КБ)
SIZE=$(stat -c%s "$OUT.tmp")
if [ "$SIZE" -lt 1024 ]; then
  rm -f "$OUT.tmp"
  notify_fail "Дамп слишком маленький: $SIZE байт (вероятно, БД пустая или ошибка)"
  exit 1
fi

mv "$OUT.tmp" "$OUT"

# Чистим старые
find "$BACKUP_DIR" -name 'crmka-*.sql.gz' -mtime "+$RETAIN_DAYS" -delete

echo "[$KIND] Backup OK: $OUT ($(du -h "$OUT" | cut -f1))"
