FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
# Root server modules (avoid missing new *.js on deploy)
COPY *.js ./
COPY public ./public
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
