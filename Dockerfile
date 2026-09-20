# AlphaMan 웹사이트 버전 (영구 데이터 볼륨 포함)
FROM node:22-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --omit=dev --no-audit --no-fund
COPY . .
ENV PORT=4100 HOST=0.0.0.0 ALPHAMAN_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 4100
CMD ["node", "apps/server/bin/alphaman-server.js"]
