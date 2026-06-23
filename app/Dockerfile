# Stage 1: Dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production && cp -R node_modules /prod_modules
RUN npm ci

# Stage 2: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# prisma generate тянет query-engine с binaries.prisma.sh. У msk1 интермиттентная
# блокировка до CDN (отвал на 1–2 мин), из-за чего сборка падала (а деплой ложно
# зеленел). Ретраим до 12 раз с паузой 15с (~3 мин окно — переживает типичный блип);
# если так и не вышло — падаем с exit 1, чтобы деплой не считался успешным.
RUN sh -c 'n=0; until npx prisma generate; do n=$((n+1)); if [ "$n" -ge 12 ]; then echo "prisma generate failed after $n attempts"; exit 1; fi; echo "prisma generate failed (attempt $n/12, binaries.prisma.sh flaky), retry in 15s..."; sleep 15; done'
RUN npm run build

# Stage 3: Production
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=deps /prod_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/public ./public

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
