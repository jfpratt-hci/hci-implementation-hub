FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
ENV PORT=3000 HUB_DATA_DIR=/data/hub HUB_UPLOAD_DIR=/data/uploads
EXPOSE 3000
CMD ["node", "server.js"]
