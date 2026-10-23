# Overheard: Node.js 22.13+ (yerleşik node:sqlite). Tek (isteğe bağlı) çalışma zamanı bağımlılığı
# yapay zekâ denetimi için Anthropic SDK'sıdır; ANTHROPIC_API_KEY yoksa hiç yüklenmez.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8787 \
    OVERHEARD_DB=/data/overheard.db \
    OVERHEARD_DEMO=0 \
    OVERHEARD_SECURE_COOKIES=1

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public

# Veritabanı kalıcı birimde durur; uygulama yetkisiz kullanıcıyla çalışır.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
