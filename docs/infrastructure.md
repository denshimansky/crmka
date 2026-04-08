# Инфраструктура и среды разработки

Решение принято: 08.04.2026

## Среды

### dev.umnayacrm.ru (разработка)
- **Сервер:** Hetzner, Proxmox VM (Ubuntu 24.04, 2 vCPU, 8GB RAM, 60GB SSD)
- **IP:** 65.108.45.153, SSH порт 2280, пользователь deploy
- **Назначение:** разработка, тестирование, seed-данные, эксперименты
- **БД:** можно ресетить, заливать seed, ломать
- **Деплой:** автоматический на push в ветку `main` (GitHub Actions)
- **Кто пользуется:** разработчик + AI-агент

### app.umnayacrm.ru (продакшн)
- **Сервер:** Hetzner (тот же, что и dev — временно, до переезда на Timeweb Cloud)
- **IP:** 65.108.45.153, SSH порт 2280, пользователь deploy
- **Директория:** /opt/crmka-prod (отдельный клон репозитория, ветка `production`)
- **Docker Compose:** docker-compose.prod.yml (контейнеры: crmka-prod-app, crmka-prod-db)
- **Сеть:** shared-proxy (внешняя Docker network, общая с dev nginx)
- **Назначение:** реальные клиенты, реальные данные
- **БД:** только `prisma migrate deploy`, НИКАКИХ reset/seed. `ALLOW_DESTRUCTIVE_API=false`
- **Деплой:** автоматический на push в ветку `production` (GitHub Actions → deploy-prod.yml)
- **Бэкапы:** pg_dump каждые 6 часов → /opt/backups/, хранение 30 дней, бэкап перед каждым деплоем
- **Кто пользуется:** партнёры (владельцы ДЦ) и их клиенты (родители)
- **Nginx:** конфиг в /opt/crmka/nginx/conf.d/app-prod.conf (обслуживается dev-nginx)
- **SSL:** Let's Encrypt, отдельный сертификат для app.umnayacrm.ru

### QA (на текущем этапе — процесс, не сервер)
- PR в GitHub → автоматические Playwright-тесты в CI
- Ручная проверка на dev.umnayacrm.ru перед merge в production
- Отдельный staging-сервер добавим при масштабировании (3+ разработчика или 100+ партнёров)

## Git-flow

```
feature/xxx  →  PR  →  main  →  dev.umnayacrm.ru
                         ↓
                    production  →  app.umnayacrm.ru
```

- `main` — основная ветка разработки, автодеплой на dev
- `production` — стабильная ветка, автодеплой на прод
- `feature/*` — фичи, через PR в main
- `hotfix/*` — срочные фиксы, через PR в production + cherry-pick в main

### Правила merge в production
1. Все Playwright-тесты проходят (CI блокирует merge при падении)
2. Проверено на dev вручную (разработчик или Анна)
3. Миграции БД проверены (нет деструктивных изменений без плана)
4. Нет изменений в seed.ts (seed не запускается на проде)

## Бэкапы (прод)

- **PostgreSQL:** `pg_dump` каждые 6 часов → /opt/backups/crmka-prod-YYYYMMDD-HHMM.sql.gz
- **Перед миграцией:** обязательный бэкап перед `prisma migrate deploy` (в deploy-prod.yml)
- **Хранение:** /opt/backups/ на сервере, ротация 30 дней
- **Скрипт:** /opt/crmka-prod/backup.sh
- **Cron:** `0 */6 * * *` (пользователь deploy)

## CI/CD (GitHub Actions)

### На push в main:
1. TypeScript type-check (`tsc --noEmit`)
2. Playwright тесты (headless)
3. Docker build + push
4. SSH deploy на dev.umnayacrm.ru

### На push в production:
1. TypeScript type-check
2. Playwright тесты
3. Бэкап БД на проде
4. Docker build + push
5. `prisma migrate deploy`
6. SSH deploy на app.umnayacrm.ru
7. Health-check (curl /api/auth/me)

## Переменные окружения

Отдельные `.env` для каждой среды:
- `.env.development` — dev-сервер (seed-данные, тестовые ключи)
- `.env.production` — прод (реальные ключи ЮKassa, SMTP и т.д.)

Ключи НЕ хранятся в git. Передаются через GitHub Secrets → docker compose.

## Мониторинг (прод)

- Uptime: проверка /api/auth/me каждые 5 минут
- Логи: docker compose logs, ротация logrotate
- Алерты: при даунтайме > 5 мин — уведомление в Telegram
- Диск: предупреждение при > 85% заполнении

## Масштабирование (когда)

| Триггер | Действие |
|---------|----------|
| 3+ разработчика | Добавить staging.umnayacrm.ru |
| 100+ партнёров | Вертикальное масштабирование (RAM/CPU) |
| 500+ партнёров | Горизонтальное (read replicas, CDN) |
| Нагрузка > 1000 RPS | Kubernetes / managed PostgreSQL |

## Архитектура dev + prod на одном сервере

```
                        ┌─────────────────────────────────┐
                        │         Hetzner VM              │
                        │                                 │
  80/443 ──────────────►│  nginx (crmka-nginx-1)          │
                        │    ├─ dev.umnayacrm.ru → app:3000 (dev)
                        │    └─ app.umnayacrm.ru → crmka-prod-app:3000 (prod)
                        │                                 │
                        │  Docker networks:               │
                        │    internal (dev) ── app, db, nginx
                        │    internal (prod) ── prod-app, prod-db
                        │    shared-proxy ── nginx + prod-app
                        │                                 │
                        │  /opt/crmka      → dev (main)   │
                        │  /opt/crmka-prod → prod (production) │
                        │  /opt/backups    → pg_dump      │
                        └─────────────────────────────────┘
```

### Запуск prod (после настройки DNS)
```bash
# 1. Направить DNS app.umnayacrm.ru → 65.108.45.153
# 2. Получить SSL-сертификат
cd /opt/crmka-prod && ./init-ssl.sh
# 3. Запустить prod
docker compose -f docker-compose.prod.yml up -d
# 4. Применить миграции
docker compose -f docker-compose.prod.yml exec -T app npx prisma migrate deploy
```
