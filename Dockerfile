FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/
COPY services/ ./services/
COPY routes/ ./routes/
COPY utils/ ./utils/

RUN mkdir -p logs && chown -R node:node logs

USER node

EXPOSE 3000

CMD ["node", "src/index.js"]