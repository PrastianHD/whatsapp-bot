FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/
COPY services/ ./services/
COPY routes/ ./routes/

RUN mkdir -p logs

USER node

EXPOSE 3000

CMD ["node", "src/index.js"]
