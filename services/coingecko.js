require('dotenv').config();
const axios = require('axios'); // fix: was missing, caused ReferenceError on every API call

class CoinGeckoService {
  constructor() {
    this.priceCache = new Map();
    this.cacheTTL = 60 * 1000;
    this.rateLimitWindow = 60 * 1000;
    this.maxRequests = 30;
    this.requestLog = [];
  }

  checkRateLimit() {
    const now = Date.now();
    this.requestLog = this.requestLog.filter(ts => now - ts < this.rateLimitWindow);
    return this.requestLog.length >= this.maxRequests;
  }

  recordRequest() {
    this.requestLog.push(Date.now());
  }

  async waitForRateLimit() {
    while (this.checkRateLimit()) {
      const oldestRequest = this.requestLog[0];
      const waitTime = this.rateLimitWindow - (Date.now() - oldestRequest) + 100;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  getCached(key) {
    const entry = this.priceCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.priceCache.delete(key);
      return null;
    }
    return entry.data;
  }

  setCache(key, data) {
    this.priceCache.set(key, {
      data,
      expiresAt: Date.now() + this.cacheTTL,
    });
  }

  isAddress(input) {
    return /^0x[a-fA-F0-9]{40}$/.test(input);
  }

  get baseUrl() {
    return process.env.COINGECKO_API_URL || 'https://api.coingecko.com/api/v3';
  }

  get headers() {
    return { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY };
  }

  async findCoin(query) {
    const cacheKey = `search_${query.toLowerCase()}`;
    const cached = this.getCached(cacheKey);
    if (cached !== null) return cached;

    await this.waitForRateLimit();
    this.recordRequest();

    const response = await axios.get(`${this.baseUrl}/search`, {
      headers: this.headers,
      params: { query },
    });

    const coin = response.data.coins?.[0] || null;
    if (coin) this.setCache(cacheKey, coin);
    return coin;
  }

  async findTokenByAddress(address) {
    const cacheKey = `token_${address.toLowerCase()}`;
    const cached = this.getCached(cacheKey);
    if (cached !== null) return cached;

    await this.waitForRateLimit();
    this.recordRequest();

    const response = await axios.get(
      `${this.baseUrl}/simple/token_price/ethereum`,
      {
        headers: this.headers,
        params: {
          contract_addresses: address,
          vs_currencies: 'usd,idr',
          include_market_cap: 'true',
          include_24hr_change: 'true',
          include_last_updated_at: 'true',
        },
      }
    );

    const data = response.data?.[address.toLowerCase()];
    if (data) {
      const result = { ...data, isToken: true, address: address.toLowerCase() };
      this.setCache(cacheKey, result);
      return result;
    }
    return null;
  }

  async getSimplePrice(coinId) {
    const cacheKey = `simple_${coinId}`;
    const cached = this.getCached(cacheKey);
    if (cached !== null) return cached;

    await this.waitForRateLimit();
    this.recordRequest();

    const response = await axios.get(`${this.baseUrl}/simple/price`, {
      headers: this.headers,
      params: {
        ids: coinId,
        vs_currencies: 'usd,idr',
        include_market_cap: 'true',
        include_24hr_change: 'true',
        include_last_updated_at: 'true',
      },
    });

    const data = response.data?.[coinId];
    if (!data) return null;

    this.setCache(cacheKey, data);
    return data;
  }

  async getCoinMarketData(coinId) {
    const cacheKey = `market_${coinId}`;
    const cached = this.getCached(cacheKey);
    if (cached !== null) return cached;

    await this.waitForRateLimit();
    this.recordRequest();

    const response = await axios.get(`${this.baseUrl}/coins/markets`, {
      headers: this.headers,
      params: {
        vs_currency: 'usd',
        ids: coinId,
        price_change_percentage: '24h,7d,30d',
        precision: '2',
      },
    });

    const data = response.data?.[0];
    if (!data) return null;

    // Fetch IDR price separately via simple/price
    const idrData = await this.getSimplePrice(coinId);
    if (idrData) {
      data.current_price = {
        usd: data.current_price,
        idr: idrData.idr,
      };
      data.market_cap = {
        usd: data.market_cap,
      };
    } else {
      data.current_price = { usd: data.current_price, idr: null };
      data.market_cap = { usd: data.market_cap };
    }

    this.setCache(cacheKey, data);
    return data;
  }

  async getTrending() {
    const cacheKey = 'trending';
    const cached = this.getCached(cacheKey);
    if (cached !== null) return cached;

    await this.waitForRateLimit();
    this.recordRequest();

    const response = await axios.get(`${this.baseUrl}/search/trending`, {
      headers: this.headers,
    });

    const coins = response.data.coins?.slice(0, 7).map(item => item.item) || [];
    this.setCache(cacheKey, coins);
    return coins;
  }
}

module.exports = new CoinGeckoService();