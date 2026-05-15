# Security & Operations Setup

Дата: 2026-05-15
Что покрыто: фиксы из аудита безопасности 15.05, бэкапы PostgreSQL, Telegram-алерты.

## 1. Код — что изменилось (уже в git)

| Изменение | Файл |
|---|---|
| SQL injection в `withTenant` устранён (set_config с параметризацией + UUID-валидация) | `app/src/lib/db.ts` |
| Fail-fast при weak/missing JWT-секрете в production | `app/src/lib/admin-auth.ts`, `app/src/lib/portal-auth.ts` |
| `POSTGRES_PASSWORD` теперь обязателен (compose упадёт если пусто) | `docker-compose.yml` |
| HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy | `nginx/conf.d/default.conf` |
| Telegram-алерты на deploy success/fail | `.github/workflows/deploy.yml` |
| Скрипты бэкапа и проверки диска | `scripts/backup.sh`, `scripts/disk-check.sh`, `scripts/notify-telegram.sh` |

## 2. Шаги на сервере (65.108.45.153)

### 2.1. Создать Telegram-бота
1. В Telegram написать [@BotFather](https://t.me/BotFather) → `/newbot` → задать имя.
2. Сохранить токен (вид `123456:ABC-DEF...`).
3. Написать **своему боту** любое сообщение.
4. Открыть `https://api.telegram.org/bot<TOKEN>/getUpdates` → найти `"chat":{"id":<число>}`. Это `TELEGRAM_CHAT_ID`.

### 2.2. Прописать токен на сервере
```bash
ssh -p 2280 deploy@65.108.45.153
cd /opt/crmka
nano .env
# добавить:
# TELEGRAM_BOT_TOKEN=123456:ABC...
# TELEGRAM_CHAT_ID=12345678
```

### 2.3. Применить новый docker-compose и nginx
```bash
cd /opt/crmka
git pull origin main
# Сгенерировать strong-секрет, если ещё дефолтный
grep -E '^NEXTAUTH_SECRET=' .env
# Если "change-me..." — заменить:
sed -i.bak "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=\"$(openssl rand -hex 32)\"|" .env
# Перезапустить
docker compose up -d
docker compose restart nginx
```

### 2.4. Сделать скрипты исполняемыми и проверить
```bash
chmod +x /opt/crmka/scripts/*.sh

# Тест Telegram
/opt/crmka/scripts/notify-telegram.sh "Тест связи с сервера"

# Тест бэкапа
/opt/crmka/scripts/backup.sh daily
ls -lh /opt/crmka/backups/daily/
```

### 2.5. Поставить cron
```bash
crontab -e
```
Добавить:
```
# Ежедневный бэкап БД в 03:15 (хранится 7 дней)
15 3 * * *  /opt/crmka/scripts/backup.sh daily   >> /var/log/crmka-backup.log 2>&1

# Еженедельный бэкап в воскресенье 03:30 (хранится 4 недели)
30 3 * * 0  /opt/crmka/scripts/backup.sh weekly  >> /var/log/crmka-backup.log 2>&1

# Проверка диска каждый час
5  * * * *  /opt/crmka/scripts/disk-check.sh
```
Затем `sudo touch /var/log/crmka-backup.log && sudo chown deploy /var/log/crmka-backup.log`.

### 2.6. Проверить security headers
```bash
curl -sI https://dev.umnayacrm.ru | grep -i 'strict-transport\|x-frame\|x-content-type\|referrer-policy\|permissions-policy'
```
Должно вернуть 5 заголовков.

## 3. Шаги в GitHub (репозиторий)

Settings → Secrets and variables → Actions → **New repository secret**, добавить два:
- `TELEGRAM_BOT_TOKEN` — токен из 2.1
- `TELEGRAM_CHAT_ID` — chat_id из 2.1

После этого следующий push в `main` пришлёт уведомление в Telegram.

## 4. Восстановление из бэкапа

```bash
ssh -p 2280 deploy@65.108.45.153
cd /opt/crmka

# Найти дамп
ls -lh backups/daily/

# Восстановить (ВНИМАНИЕ: --clean --if-exists в дампе перетрёт текущую БД)
gunzip -c backups/daily/crmka-2026-05-15_03-15-00.sql.gz | \
  docker compose exec -T db psql -U crmka -d crmka
```

## 5. Что осталось из аудита (не сделано в этой партии)

| # | Проблема | Приоритет | Зачем не сделали сейчас |
|---|---|---|---|
| 5 | Webhook ЮKassa/Т-Банк не верифицируется по HMAC | Средний | Нужен реальный формат webhook от Т-Банка (в коде стоит TODO) |
| — | CSP (Content-Security-Policy) | Средний | Нужен аудит inline-скриптов Next.js — иначе UI сломается |
| 7 | Rate limit на /forgot-password | Низкий | Дописать в следующем проходе |

## 6. Что мониторить

- Лог бэкапов: `/var/log/crmka-backup.log` (если ошибка — придёт в Telegram)
- `df -h /` — диск (алерт при ≥85%, критичный при ≥90%)
- `gh run list --repo denshimansky/crmka --limit 5` — CI
- В CRM: `/admin/login-attempts` — подозрительные IP с брутфорсом
