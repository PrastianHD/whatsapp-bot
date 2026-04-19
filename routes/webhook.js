require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const coingeckoService = require('../services/coingecko');
const wahaService = require('../services/waha');
const log = require('../utils/logger');


// Dedup: prevent double-reply when WAHA fires message.any twice for same message
const processedIds = new Set();
function isDuplicate(id) {
  if (!id) return false;
  if (processedIds.has(id)) return true;
  processedIds.add(id);
  if (processedIds.size > 500) processedIds.delete(processedIds.values().next().value);
  return false;
}

const router = express.Router();

const ALLOWED_CHATS = process.env.ALLOWED_CHATS?.split(',').map(id => id.trim()).filter(Boolean) || [];
const HMAC_KEY = process.env.WHATSAPP_HOOK_HMAC_KEY;

function verifyHmac(req) {
  if (!HMAC_KEY) return true;
  const hmac = req.headers['x-webhook-hmac'];
  const timestamp = req.headers['x-webhook-timestamp'];
  if (!hmac || !timestamp) return false;
  const payload = JSON.stringify(req.body);
  const sig = crypto.createHmac('sha512', HMAC_KEY).update(`${timestamp}.${payload}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(sig));
}

function isGroupChat(chatId) {
  return chatId?.includes('@g.us');
}

function isAllowedChat(chatId) {
  if (ALLOWED_CHATS.length === 0) return true;
  return ALLOWED_CHATS.includes(chatId);
}

router.post('/webhook', async (req, res) => {
  try {
    // --- HMAC ---
    if (!verifyHmac(req)) {
      log.warn('WEBHOOK', 'Rejected: invalid HMAC signature');
      return res.sendStatus(401);
    }

    const { event, payload } = req.body;
    log.info('WEBHOOK', `Event received: ${event}`);

    // --- Event filter ---
    // NOWEB sends: 'message.any' (all messages including fromMe)
    // WEBJS sends: 'message' or 'message.created'
    const validEvents = ['message', 'message.any', 'message.created'];
    if (!validEvents.includes(event)) {
      log.debug('WEBHOOK', `Ignored event: ${event}`);
      return res.sendStatus(200);
    }

    // NOWEB: payload IS the message directly
    // Dedup check
    if (isDuplicate(req.body?.payload?.id)) {
      log.debug('WEBHOOK', `Duplicate message ignored: ${req.body?.payload?.id}`);
      return res.sendStatus(200);
    }
    const message = payload;
    const chatId  = message?.from;
    const body    = message?.body || '';
    const sender  = message?._data?.key?.participantAlt || message?.participant || 'unknown';
    const name    = message?._data?.pushName || 'unknown';

    log.info('MSG', `From: ${name} (${sender}) | Chat: ${chatId} | Body: "${body}"`);

    // --- Ignore own messages ---
    if (message?.fromMe) {
      log.debug('WEBHOOK', 'Ignored: fromMe=true');
      return res.sendStatus(200);
    }

    // --- Must start with / ---
    if (!body.startsWith('/')) {
      log.debug('WEBHOOK', `Ignored: not a command`);
      return res.sendStatus(200);
    }

    // --- Group only ---
    if (!isGroupChat(chatId)) {
      log.info('WEBHOOK', `Ignored: DM from ${sender} (group-only mode)`);
      return res.sendStatus(200);
    }

    // --- Allowed chats ---
    if (!isAllowedChat(chatId)) {
      log.warn('WEBHOOK', `Ignored: chat not in allowlist → ${chatId}`);
      return res.sendStatus(200);
    }

    // --- Parse command ---
    const [command, ...args] = body.trim().split(/\s+/);
    const argStr = args.join(' ');

    log.info('CMD', `Command: ${command} | Args: "${argStr}" | Chat: ${chatId}`);

    if (command === '/p' || command === '/price') {
      await handlePriceCommand(chatId, argStr);
    } else if (command === '/calc') {
      await handleCalcCommand(chatId, argStr);
    } else if (command === '/help') {
      await handleHelpCommand(chatId);
    } else if (command === '/tren') {
      await handleTrendingCommand(chatId);
    } else {
      log.debug('CMD', `Unknown command: ${command}`);
    }

    res.sendStatus(200);
  } catch (error) {
    log.error('WEBHOOK', `Unhandled error: ${error.message}`, { stack: error.stack?.split('\n')[1] });
    res.sendStatus(500);
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function toWIB(value) {
  // Supports unix timestamp (number) or ISO string (CoinGecko last_updated)
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  if (isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
}

function formatPercent(value) {
  if (value === null || value === undefined) return 'N/A';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatUSD(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function formatIDR(value) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(value);
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handlePriceCommand(chatId, query) {
  if (!query) {
    log.info('PRICE', 'No query provided, sending usage');
    return wahaService.sendMessage(chatId, 'Usage: /p <coin>\nContoh: /p btc\nContoh: /p 0x2260fac5e5542a773aa44fbcfedf7c193bc2c599');
  }

  log.info('PRICE', `Looking up: "${query}"`);

  try {
    let coinData, isToken = false;

    if (coingeckoService.isAddress(query)) {
      log.debug('PRICE', `Detected ERC-20 address: ${query}`);
      coinData = await coingeckoService.findTokenByAddress(query);
      if (coinData) isToken = true;
    } else {
      const coin = await coingeckoService.findCoin(query);
      if (coin) {
        log.debug('PRICE', `Found coin: ${coin.name} (${coin.id})`);
        coinData = await coingeckoService.getCoinMarketData(coin.id);
      }
    }

    if (!coinData) {
      log.warn('PRICE', `Not found: "${query}"`);
      return wahaService.sendMessage(chatId, `Coin "${query}" tidak ditemukan.`);
    }

    let response;
    if (isToken) {
      const usdPrice = coinData.usd;
      const idrPrice = coinData.idr || usdPrice * 15000;
      log.info('PRICE', `Token: $${usdPrice}`);
      response =
        `💰 *Token ERC-20*\n` +
        `📍 Address: \`${coinData.address}\`\n\n` +
        `🇺🇸 USD: ${formatUSD(usdPrice)}\n` +
        `🇮🇩 IDR: ${formatIDR(idrPrice)}\n\n` +
        `📊 24h: ${formatPercent(coinData.usd_24h_change)}\n` +
        `🏦 Mcap: ${formatUSD(coinData.usd_market_cap)}\n\n` +
        `🕐 Update: ${coinData.last_updated_at ? toWIB(coinData.last_updated_at) : 'N/A'} (WIB)`;
    } else {
      log.info('PRICE', `${coinData.name}: $${coinData.current_price?.usd}`);
      response =
        `💰 *${coinData.name}* (${coinData.symbol.toUpperCase()})\n\n` +
        `🇺🇸 USD: ${formatUSD(coinData.current_price?.usd)}\n` +
        `🇮🇩 IDR: ${formatIDR(coinData.current_price?.idr)}\n\n` +
        `📊 Perubahan Harga:\n` +
        `  1D:  ${formatPercent(coinData.price_change_percentage_24h)}\n` +
        `  7D:  ${formatPercent(coinData.price_change_percentage_7d_in_currency)}\n` +
        `  30D: ${formatPercent(coinData.price_change_percentage_30d_in_currency)}\n\n` +
        `🏦 Market Cap: ${formatUSD(coinData.market_cap?.usd)}\n\n` +
        `🕐 Update: ${toWIB(coinData.last_updated)} (WIB)`;
    }

    await wahaService.sendMessage(chatId, response);
    log.info('PRICE', `Reply sent to ${chatId}`);
  } catch (error) {
    if (error.response?.status === 429) {
      log.warn('PRICE', 'CoinGecko rate limit hit');
      return wahaService.sendMessage(chatId, 'Rate limit exceeded. Silakan coba lagi nanti.');
    }
    log.error('PRICE', error.message, { query });
    wahaService.sendMessage(chatId, 'Terjadi kesalahan saat mengambil harga.');
  }
}

async function handleCalcCommand(chatId, expression) {
  if (!expression) {
    return wahaService.sendMessage(chatId, 'Usage: /calc <jumlah> <coin> <currency>\nContoh: /calc 1 ETH IDR\nContoh: /calc 0.5 BTC USD');
  }

  log.info('CALC', `Expression: "${expression}"`);

  try {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 3) {
      return wahaService.sendMessage(chatId, 'Format salah. Gunakan: /calc <jumlah> <coin> <currency>\nContoh: /calc 1 ETH IDR');
    }

    const [amountStr, coinInput, targetCurrency] = parts;
    const amount = parseFloat(amountStr);

    if (isNaN(amount) || amount <= 0) {
      return wahaService.sendMessage(chatId, 'Jumlah harus angka positif.');
    }

    if (!['IDR', 'USD'].includes(targetCurrency.toUpperCase())) {
      return wahaService.sendMessage(chatId, 'Currency harus IDR atau USD.');
    }

    let priceData, symbol;

    if (coingeckoService.isAddress(coinInput)) {
      priceData = await coingeckoService.findTokenByAddress(coinInput);
      symbol = 'TOKEN';
    } else {
      const coin = await coingeckoService.findCoin(coinInput);
      if (!coin) {
        log.warn('CALC', `Coin not found: "${coinInput}"`);
        return wahaService.sendMessage(chatId, `Coin "${coinInput}" tidak ditemukan.`);
      }
      priceData = await coingeckoService.getSimplePrice(coin.id);
      symbol = coin.symbol.toUpperCase();
    }

    if (!priceData) {
      return wahaService.sendMessage(chatId, `Harga untuk "${coinInput}" tidak tersedia.`);
    }

    const usdPrice = priceData.usd;
    const idrPrice = priceData.idr || usdPrice * 15000;
    const totalUsd = amount * usdPrice;
    const totalIdr = amount * idrPrice;
    const lastUpdated = priceData.last_updated_at ? toWIB(priceData.last_updated_at) : 'N/A';

    log.info('CALC', `${amount} ${symbol} = $${totalUsd.toFixed(2)} / Rp${totalIdr.toFixed(0)}`);

    const response =
      `💱 *Konversi ${amount} ${symbol}*\n\n` +
      `📌 Rate: 1 ${symbol} = ${formatUSD(usdPrice)} / ${formatIDR(idrPrice)}\n\n` +
      `🇺🇸 USD: ${formatUSD(totalUsd)}\n` +
      `🇮🇩 IDR: ${formatIDR(totalIdr)}\n\n` +
      `🕐 Update: ${lastUpdated} (WIB)`;

    await wahaService.sendMessage(chatId, response);
    log.info('CALC', `Reply sent to ${chatId}`);
  } catch (error) {
    if (error.response?.status === 429) {
      log.warn('CALC', 'CoinGecko rate limit hit');
      return wahaService.sendMessage(chatId, 'Rate limit exceeded. Silakan coba lagi nanti.');
    }
    log.error('CALC', error.message, { expression });
    wahaService.sendMessage(chatId, 'Terjadi kesalahan saat konversi.');
  }
}

async function handleHelpCommand(chatId) {
  log.info('HELP', `Sending help to ${chatId}`);
  const helpText =
    `🤖 *Panduan Bot*\n\n` +
    `📌 *Command:*\n\n` +
    `💰 /p <coin>\n   Cek harga coin (USD & IDR)\n   Contoh: /p btc\n   Contoh: /p bitcoin\n   Contoh: /p 0x2260fac5e5542a773aa44fbcfedf7c193bc2c599\n\n` +
    `💱 /calc <jumlah> <coin> <currency>\n   Konversi crypto ke USD/IDR\n   Contoh: /calc 1 ETH IDR\n   Contoh: /calc 0.5 BTC USD\n\n` +
    `🔥 /tren\n   Lihat 7 coins paling trending\n\n` +
    `🆘 /help\n   Tampilkan bantuan ini`;
  await wahaService.sendMessage(chatId, helpText);
}

async function handleTrendingCommand(chatId) {
  log.info('TREN', `Fetching trending for ${chatId}`);
  try {
    const trending = await coingeckoService.getTrending();
    if (!trending || trending.length === 0) {
      return wahaService.sendMessage(chatId, 'Tidak ada data trending.');
    }

    const list = trending.map((coin, i) => {
      const change = formatPercent(coin.price_change_percentage_24h);
      return `${i + 1}. ${coin.name} (${coin.symbol?.toUpperCase() || 'N/A'})\n   ${change}`;
    }).join('\n\n');

    log.info('TREN', `Returning ${trending.length} trending coins`);
    const response = `🔥 *Trending Coins*\n\n${list}\n\n🕐 Update: ${toWIB(Math.floor(Date.now() / 1000))} (WIB)`;
    await wahaService.sendMessage(chatId, response);
  } catch (error) {
    if (error.response?.status === 429) {
      log.warn('TREN', 'CoinGecko rate limit hit');
      return wahaService.sendMessage(chatId, 'Rate limit exceeded. Silakan coba lagi nanti.');
    }
    log.error('TREN', error.message);
    wahaService.sendMessage(chatId, 'Terjadi kesalahan saat mengambil data trending.');
  }
}

module.exports = router;