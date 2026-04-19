require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const math = require('mathjs');
const coingeckoService = require('../services/coingecko');
const wahaService = require('../services/waha');

const router = express.Router();

const ALLOWED_CHATS = process.env.ALLOWED_CHATS?.split(',').map(id => id.trim()) || [];
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

function isGroupChat(message) {
  return message.chatId?.includes('@g.us');
}

function isAllowedChat(chatId) {
  if (ALLOWED_CHATS.length === 0) return true;
  return ALLOWED_CHATS.includes(chatId);
}

function buildChatKey(message) {
  return {
    chatId: message.chatId,
    isGroup: isGroupChat(message),
    sender: message.sender?.id,
  };
}

router.post('/webhook', async (req, res) => {
  try {
    if (!verifyHmac(req)) {
      console.warn('Invalid HMAC signature');
      return res.sendStatus(401);
    }

    const { event, payload } = req.body;

    if (event !== 'message.created') {
      return res.sendStatus(200);
    }

    const message = payload?.message;
    if (!message?.body?.startsWith('/')) {
      return res.sendStatus(200);
    }

    const chatKey = buildChatKey(message);

    if (!chatKey.isGroup) {
      return res.sendStatus(200);
    }

    if (!isAllowedChat(chatKey.chatId)) {
      return res.sendStatus(200);
    }

    const chatId = message.chatId;
    const [command, ...args] = message.body.split(' ');

    if (command === '/p' || command === '/price') {
      await handlePriceCommand(chatId, args.join(' '));
    } else if (command === '/calc') {
      await handleCalcCommand(chatId, args.join(' '));
    } else if (command === '/help') {
      await handleHelpCommand(chatId);
    } else if (command === '/tren') {
      await handleTrendingCommand(chatId);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error.message);
    res.sendStatus(500);
  }
});

function toWIB(unixTimestamp) {
  const date = new Date(unixTimestamp * 1000);
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

async function handlePriceCommand(chatId, query) {
  if (!query) {
    return wahaService.sendMessage(chatId, 'Usage: /p <coin>\nContoh: /p btc\nContoh: /p 0x2260fac5e5542a773aa44fbcfedf7c193bc2c599');
  }

  try {
    let coinData;
    let isToken = false;

    if (coingeckoService.isAddress(query)) {
      coinData = await coingeckoService.findTokenByAddress(query);
      if (coinData) isToken = true;
    } else {
      const coin = await coingeckoService.findCoin(query);
      if (coin) {
        coinData = await coingeckoService.getCoinMarketData(coin.id);
      }
    }

    if (!coinData) {
      return wahaService.sendMessage(chatId, `Coin "${query}" tidak ditemukan.`);
    }

    let response;
    if (isToken) {
      const usdPrice = coinData.usd;
      const idrPrice = coinData.idr || usdPrice * 15000;
      response = `💰 *Token ERC-20*\n` +
        `📍 Address: \`${coinData.address}\`\n\n` +
        `🇺🇸 USD: ${formatUSD(usdPrice)}\n` +
        `🇮🇩 IDR: ${formatIDR(idrPrice)}\n\n` +
        `📊 24h: ${formatPercent(coinData.usd_24h_change)}\n` +
        `🏦 Mcap: ${formatUSD(coinData.usd_market_cap)}\n\n` +
        `🕐 Update: ${coinData.last_updated_at ? toWIB(coinData.last_updated_at) : 'N/A'} (WIB)`;
    } else {
      response = `💰 *${coinData.name}* (${coinData.symbol.toUpperCase()})\n\n` +
        `🇺🇸 USD: ${formatUSD(coinData.current_price.usd)}\n` +
        `🇮🇩 IDR: ${formatIDR(coinData.current_price.idr)}\n\n` +
        `📊 Perubahan Harga:\n` +
        `  1D:  ${formatPercent(coinData.price_change_percentage_24h)}\n` +
        `  7D:  ${formatPercent(coinData.price_change_percentage_7d_in_currency)}\n` +
        `  30D: ${formatPercent(coinData.price_change_percentage_30d_in_currency)}\n\n` +
        `🏦 Market Cap: ${formatUSD(coinData.market_cap.usd)}\n\n` +
        `🕐 Update: ${toWIB(coinData.last_updated_at)} (WIB)`;
    }

    await wahaService.sendMessage(chatId, response);
  } catch (error) {
    if (error.response?.status === 429) {
      return wahaService.sendMessage(chatId, 'Rate limit exceeded. Silakan coba lagi nanti.');
    }
    console.error('Price error:', error.message);
    wahaService.sendMessage(chatId, 'Terjadi kesalahan saat mengambil harga.');
  }
}

async function handleCalcCommand(chatId, expression) {
  if (!expression) {
    return wahaService.sendMessage(chatId, 'Usage: /calc <jumlah> <coin> <currency>\nContoh: /calc 1 ETH IDR\nContoh: /calc 0.5 BTC USD\nContoh: /calc 1 0x2260... USD');
  }

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

    const response = `💱 *Konversi ${amount} ${symbol}*\n\n` +
      `🇺🇸 USD: ${formatUSD(totalUsd)}\n` +
      `🇮🇩 IDR: ${formatIDR(totalIdr)}\n\n` +
      `📌 Rate: 1 ${symbol} = ${formatUSD(usdPrice)} / ${formatIDR(idrPrice)}\n\n` +
      `🕐 Update: ${lastUpdated} (WIB)`;

    await wahaService.sendMessage(chatId, response);
  } catch (error) {
    if (error.response?.status === 429) {
      return wahaService.sendMessage(chatId, 'Rate limit exceeded. Silakan coba lagi nanti.');
    }
    console.error('Calc error:', error.message);
    wahaService.sendMessage(chatId, 'Terjadi kesalahan saat konversi.');
  }
}

async function handleHelpCommand(chatId) {
  const helpText = `🤖 *Panduan Bot*\n\n` +
    `📌 *Command:*\n\n` +
    `💰 /p <coin>\n   Cek harga coin (USD & IDR)\n   Contoh: /p btc\n   Contoh: /p bitcoin\n   Contoh: /p 0x2260fac5e5542a773aa44fbcfedf7c193bc2c599\n\n` +
    `💱 /calc <jumlah> <coin> <currency>\n   Konversi crypto ke USD/IDR\n   Contoh: /calc 1 ETH IDR\n   Contoh: /calc 0.5 BTC USD\n   Contoh: /calc 1 0x2260... USD\n\n` +
    `🔥 /tren\n   Lihat 7 coins paling trending\n\n` +
    `🆘 /help\n   Tampilkan bantuan ini`;

  await wahaService.sendMessage(chatId, helpText);
}

async function handleTrendingCommand(chatId) {
  try {
    const trending = await coingeckoService.getTrending();
    if (!trending || trending.length === 0) {
      return wahaService.sendMessage(chatId, 'Tidak ada data trending.');
    }

    const list = trending.map((coin, i) => {
      const price = coin.price_change_percentage_24h;
      const change = formatPercent(price);
      return `${i + 1}. ${coin.name} (${coin.symbol?.toUpperCase() || 'N/A'})\n   ${change}`;
    }).join('\n\n');

    const response = `🔥 *Trending Coins*\n\n${list}\n\n🕐 Update: ${toWIB(Math.floor(Date.now() / 1000))} (WIB)`;
    await wahaService.sendMessage(chatId, response);
  } catch (error) {
    if (error.response?.status === 429) {
      return wahaService.sendMessage(chatId, 'Rate limit exceeded. Silakan coba lagi nanti.');
    }
    console.error('Trending error:', error.message);
    wahaService.sendMessage(chatId, 'Terjadi kesalahan saat mengambil data trending.');
  }
}

module.exports = router;
