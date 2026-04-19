require('dotenv').config();
const express = require('express');
const webhookRouter = require('../routes/webhook');
const log = require('../utils/logger');

const app = express();
app.use(express.json());
app.use(webhookRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  log.info('STARTUP', '================================================');
  log.info('STARTUP', '   WhatsApp Crypto Bot - Started');
  log.info('STARTUP', '================================================');
  log.info('STARTUP', `Port          : ${PORT}`);
  log.info('STARTUP', `WAHA URL      : ${process.env.WAHA_URL || '(not set!)'}`);
  log.info('STARTUP', `WAHA Session  : ${process.env.WAHA_SESSION || 'default'}`);
  log.info('STARTUP', `Bot Number    : 6285863565986@c.us`);
  log.info('STARTUP', `HMAC Auth     : ${process.env.WHATSAPP_HOOK_HMAC_KEY ? 'ENABLED' : 'disabled (no key set)'}`);
  log.info('STARTUP', `Allowed Chats : ${process.env.ALLOWED_CHATS || 'ALL GROUPS (no restriction)'}`);
  log.info('STARTUP', `CoinGecko Key : ${process.env.COINGECKO_API_KEY ? 'set ✓' : 'NOT SET - price commands will fail!'}`);
  log.info('STARTUP', '------------------------------------------------');
  log.info('STARTUP', 'Webhook endpoint : POST /webhook');
  log.info('STARTUP', 'Health endpoint  : GET  /health');
  log.info('STARTUP', '================================================');
});