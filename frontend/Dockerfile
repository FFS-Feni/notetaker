FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY . .
CMD ["npx", "vite", "--host", "0.0.0.0"]
