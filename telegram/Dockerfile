# Derleme bağlamı depo köküdür (skill'e erişmek için):
#   docker build -f telegram/Dockerfile -t nexus-telegram .
# ya da telegram/ içinde:  docker compose up -d
FROM node:22-alpine

WORKDIR /app
COPY telegram/package.json telegram/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY telegram/src ./src
COPY .claude/skills/verimli-sohbet ./skill

ENV NODE_ENV=production SKILL_DIR=/app/skill DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node

CMD ["node", "src/main.mjs"]
