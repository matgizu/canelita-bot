FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

# ffmpeg: transcodifica las notas de voz del panel a OGG/Opus para WhatsApp.
# Usamos el binario del sistema (musl-compatible) vía FFMPEG_PATH en vez del de
# ffmpeg-static, que está compilado para glibc y no corre en Alpine.
RUN apk add --no-cache openssl ffmpeg
ENV FFMPEG_PATH=/usr/bin/ffmpeg

COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY --from=builder /app/dist ./dist
COPY public ./public
COPY bin/start.sh ./bin/start.sh
RUN chmod +x ./bin/start.sh

ENV NODE_ENV=production

CMD ["sh", "bin/start.sh"]
