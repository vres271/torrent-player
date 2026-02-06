FROM node:20-slim
WORKDIR /app
COPY app/package.json app/package-lock.json* ./
RUN npm install --omit=dev
COPY app/server.js ./
CMD ["node", "server.js"]
