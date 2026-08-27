# Сайдкар-планировщик кронов CRMka на supercronic.
# Надёжная замена ненадёжному GitHub Actions schedule: живёт на нашей инфре, едет с
# приложением через CI на оба сервера, расписание (crontab) — в git. GitHub-воркфлоу
# остаются резервом (кроны идемпотентны — двойной запуск дублей не создаёт).
FROM alpine:3.20

# curl — для вызова эндпоинтов; tzdata/ca-certificates — TLS и корректная TZ.
RUN apk add --no-cache curl tzdata ca-certificates
ENV TZ=UTC

# supercronic — cron для контейнеров (внятные логи, не глотает stderr).
# amd64: оба сервера (Hetzner, Timeweb) — x86_64. Скачиваем через RUN curl (а не ADD),
# чтобы загрузка шла через build.network:host — иначе на msk1 сборка не резолвит DNS.
ARG SUPERCRONIC_VERSION=v0.2.33
RUN curl -fsSL "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64" \
      -o /usr/local/bin/supercronic \
 && chmod +x /usr/local/bin/supercronic

COPY crontab /etc/crontab

# -passthrough-logs — вывод curl виден в `docker logs` крон-сайдкара.
CMD ["supercronic", "-passthrough-logs", "/etc/crontab"]
