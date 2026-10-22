FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY . .
# Готовая сборка (сжатый JS по частям), а не режим разработки. vite preview отдаёт её и проксирует /api и WebSocket.
RUN npm run build
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]
