FROM node:20-slim

RUN apt-get update && \
    apt-get install -y curl iproute2 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --only=production
COPY normal-app.js vpn-app.js ./

CMD ["sh", "-c", "echo 'Waiting for VPN...' && sleep 5 && node normal-app.js & node vpn-app.js"]
