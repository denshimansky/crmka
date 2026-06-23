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
ENV NEXT_TELEMETRY_DISABLED=1
# prisma generate тянет query-engine с binaries.prisma.sh, а у msk1 этот CDN
# флапает по 1–3 мин (блокировка IP). Чтобы НЕ дёргать CDN на каждом деплое,
# кладём перед generate ТОЛЬКО схему: слой кэшируется и пересобирается лишь
# когда меняется prisma/ или зависимости. Коммиты, не трогающие схему (большинство),
# берут готовый слой из кеша — сборка проходит даже при недоступном CDN.
# node_modules в .dockerignore, поэтому `COPY . .` ниже не затирает сгенерированный
# клиент в node_modules/.prisma. Ретрай 12×15с — на случай флапа, когда схема
# реально изменилась и слой пересобирается.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN sh -c 'n=0; until npx prisma generate; do n=$((n+1)); if [ "$n" -ge 12 ]; then echo "prisma generate failed after $n attempts"; exit 1; fi; echo "prisma generate failed (attempt $n/12, binaries.prisma.sh flaky), retry in 15s..."; sleep 15; done'
COPY . .
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
