# Почтовый сервер umnayacrm.ru

Свой почтовый сервер на базе [docker-mailserver](https://github.com/docker-mailserver/docker-mailserver) (Postfix + Dovecot + Rspamd). Без сторонних SMTP-провайдеров (Resend, Sendgrid, Яндекс360 и т.п.) — приложение шлёт письма через локальный SMTP на 465 порту.

## Когда нужен
- Восстановление пароля сотрудников (`/forgot-password`)
- В будущем — счета на оплату подписки, чеки клиентам, напоминания

## Архитектура
- **docker-mailserver** — один контейнер с Postfix + Dovecot + Rspamd + Fail2ban
- **SSL** — Let's Encrypt (отдельный сертификат для `mail.umnayacrm.ru`)
- **Приложение** — отправляет через `nodemailer` на `mail.umnayacrm.ru:465` (см. [app/src/lib/mailer.ts](../app/src/lib/mailer.ts))

---

## Шаг 1. DNS на регистраторе

Домен `umnayacrm.ru`. Добавить **на сервер регистратора** (где управляется зона):

| Тип     | Имя                          | Значение                                                            | Приоритет |
| ------- | ---------------------------- | ------------------------------------------------------------------- | --------- |
| **A**   | `mail`                       | `IP_сервера_с_почтой` *(см. ниже)*                                  | —         |
| **MX**  | `@`                          | `mail.umnayacrm.ru.`  *(точка в конце обязательна)*                 | 10        |
| **TXT** | `@`                          | `v=spf1 ip4:IP_сервера mx -all`                                     | —         |
| **TXT** | `_dmarc`                     | `v=DMARC1; p=quarantine; rua=mailto:postmaster@umnayacrm.ru; fo=1`  | —         |
| **TXT** | `mail._domainkey`            | *(DKIM-ключ — генерируется на шаге 4, добавляется после запуска)*   | —         |

**IP сервера с почтой:**
- **dev / временно:** `65.108.45.153` (текущий Hetzner-сервер)
- **prod:** IP будущего Timeweb Cloud — добавить когда переедем

**Также — PTR-запись (обратная DNS):** настраивается **в панели хостинга** (Hetzner Robot / Timeweb), не у регистратора:
- IP `65.108.45.153` → должен резолвиться в `mail.umnayacrm.ru`
- Без PTR Gmail, Yandex, Mail.ru будут отклонять или класть в спам

---

## Шаг 2. Снять блокировку порта 25 (Hetzner)

Hetzner по умолчанию блокирует **исходящий** трафик на порт 25 (для борьбы со спамом). Без разблокировки сервер не сможет доставлять письма наружу.

1. Зайти в [Hetzner Robot](https://robot.hetzner.com) → нужная VM/сервер
2. Открыть тикет (Support) или использовать форму «unblock port 25»
3. Запросить разблокировку — обычно одобряют за несколько часов

Timeweb Cloud — уточнить аналогичную политику.

---

## Шаг 3. SSL-сертификат для mail.umnayacrm.ru

На сервере (`ssh fesha@65.108.45.153`):

```bash
# Через существующий certbot (если nginx уже работает):
docker compose run --rm certbot certonly --webroot -w /var/www/certbot -d mail.umnayacrm.ru

# ИЛИ standalone (если порт 80 свободен на время выпуска):
# certbot certonly --standalone -d mail.umnayacrm.ru
```

Сертификат окажется в `/etc/letsencrypt/live/mail.umnayacrm.ru/` — путь, который смонтирован read-only в контейнер mailserver.

---

## Шаг 4. Запуск mailserver

```bash
cd /opt/crmka

# Открыть порты в фаерволе
sudo ufw allow 25/tcp
sudo ufw allow 465/tcp
sudo ufw allow 587/tcp
sudo ufw allow 993/tcp

# Создать директорию для конфигурации
mkdir -p mail-config

# Запустить
docker compose -f docker-compose.mail.yml up -d

# Проверить логи
docker logs umnayacrm-mail -f
```

---

## Шаг 5. Создать ящик noreply@umnayacrm.ru

```bash
# Сгенерировать пароль (запомнить — нужен в .env приложения)
openssl rand -base64 24

# Создать ящик
docker exec umnayacrm-mail setup email add noreply@umnayacrm.ru ПАРОЛЬ_ИЗ_ПРЕДЫДУЩЕЙ_КОМАНДЫ

# Проверить список ящиков
docker exec umnayacrm-mail setup email list
```

---

## Шаг 6. DKIM — сгенерировать ключ и добавить в DNS

```bash
# Сгенерировать DKIM-ключ для домена
docker exec umnayacrm-mail setup config dkim keysize 2048 domain umnayacrm.ru

# Вывести публичный ключ (его нужно скопировать в DNS)
docker exec umnayacrm-mail cat /tmp/docker-mailserver/rspamd/dkim/umnayacrm.ru.mail.pub
```

Скопировать выведенное значение (длинная строка `v=DKIM1; k=rsa; p=...`) и добавить в DNS:
- **Тип:** TXT
- **Имя:** `mail._domainkey`
- **Значение:** содержимое из команды выше (одна строка)

---

## Шаг 7. Прописать SMTP в .env приложения

В `/opt/crmka/.env` (на сервере):

```env
SMTP_HOST=mail.umnayacrm.ru
SMTP_PORT=465
SMTP_USER=noreply@umnayacrm.ru
SMTP_PASS=пароль_из_шага_5
MAIL_FROM="Умная CRM <noreply@umnayacrm.ru>"
```

Перезапустить приложение:
```bash
docker compose up -d app
```

Если SMTP_* переменные не заданы — `mailer.ts` логирует линки восстановления в `docker logs umnayacrm-app` (фолбэк для разработки).

---

## Шаг 8. Проверка

```bash
# DNS снаружи
dig MX umnayacrm.ru
dig TXT umnayacrm.ru
dig TXT _dmarc.umnayacrm.ru
dig TXT mail._domainkey.umnayacrm.ru
```

**Онлайн-проверки:**
- [mxtoolbox.com](https://mxtoolbox.com) — введи `umnayacrm.ru`, проверь MX/SPF/DKIM/DMARC
- [mail-tester.com](https://mail-tester.com) — отправь тестовое письмо на сгенерированный адрес, получи оценку доставки (10/10 — идеально)

**Боевой тест:**
1. Открыть `https://dev.umnayacrm.ru/login`
2. «Забыли пароль?» → ввести email владельца
3. Письмо должно прийти. Если нет — `docker logs umnayacrm-app | grep mailer`

---

## Полезные команды

```bash
# Управление ящиками
docker exec umnayacrm-mail setup email add user@umnayacrm.ru password
docker exec umnayacrm-mail setup email update user@umnayacrm.ru newpassword
docker exec umnayacrm-mail setup email del user@umnayacrm.ru
docker exec umnayacrm-mail setup alias add info@umnayacrm.ru noreply@umnayacrm.ru

# Очередь Postfix
docker exec umnayacrm-mail postqueue -p

# Перезапуск
docker compose -f docker-compose.mail.yml restart
```

---

## Переезд на prod (Timeweb Cloud)

Когда появится prod-сервер на Timeweb:

1. Поменять A-запись `mail` на prod-IP
2. Запросить разблокировку порта 25 у Timeweb
3. Запросить PTR `prod-IP → mail.umnayacrm.ru` в панели Timeweb
4. Перенести Docker volume `maildata` (или начать с пустого ящика — для системных писем от приложения это нормально)
5. Регенерировать Let's Encrypt сертификат на новом сервере
6. DKIM можно оставить тот же (ключ в `/tmp/docker-mailserver/rspamd/dkim/`)
