require('dotenv').config();

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

  getCached(cacheMap, key) {
    const entry = cacheMap.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      cacheMap.delete(key);
      return null;
    }
    return entry.data;
  }

  setCache(cacheMap, key, data) {
    cacheMap.set(key, {
      data,
      expiresAt: Date.now() + this.cacheTTL,
    });
  }

  isAddress(input) {
    return /^0x[a-fA-F0-9]{40}$/.test(input);
  }

  async findCoin(query) {
    const cacheKey = `search_${query.toLowerCase()}`;
    const cached = this.getCached(this.priceCache, cacheKey);
    if (cached !== null) return cached;

    await this.waitForRateLimit();
    this.recordRequest();

    const response = await axios.get(
      `${process.env.COINGECKO_API_URL || 'https://api.coingecko.com/api/v3'}/search`,
      {
        headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY },
        params: { query },
      }
    );

    const coin = response.data.coins?.[0] || null;
    if (coin) {
      this.setCache(this.priceCache, cacheKey, coin);
    }
    return coin;
  }

  async findTokenByAddress(address) {
    const cacheKey = `token_${address.toLowerCase()}`;
    const cached = this.getCached(this.priceCache, cacheKey);
    if (cached !== null) return cached;

    await this.waitForRateLimit();
    this.recordRequest();

    const params = new URLSearchParams({
      contract_addresses: address,
      vs_currencies: 'usd,idr',
      include_market_cap: 'true',
      include_24hr_change: 'true',
    });

    const response = await axios.get(
      `${process.env.COINGECKO_API_URL || 'https://api.coingecko.com/api/v3'}/simple/token_price/ethereum?${params}`,
      { headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } }
    );

    const data = response.data?.[address.toLowerCase()];
    if (data) {
      this.setCache(this.priceCache, cacheKey, { ...data, isToken: true, address: address.toLowerCase() });
      return this.priceCache.get(cacheKey).data;
    }
    return null;
  }

  async getSimplePrice(coinId) {
    const cacheKey = `simple_${coinId}`;
    const cached = this.getCached(this.priceCache, cacheKey);
    if (cached !== null) return cached;

    await this.waitForRateLimit();
    this.recordRequest();

    const params = new URLSearchParams({
      vs_currencies: 'usd,idr',
      ids: coinId,
      include_market_cap: 'true',
      include_24hr_change: 'true',
    });

    const response = await axios.get(
      `${process.env.COINGECKO_API_URL || 'https://api.coingecko.com/api/v3'}/simple/price?${params}`,
      { headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } }
    );

    if (!response.data?.[coinId]) {
      return null;
    }

    this.setCache(this.priceCache, cacheKey, response.data[coinId]);
    return response.data[coinId];
  }

  async getCoinMarketData(coinId) {
    const cacheKey = `market_${coinId}`;
    const cached = this.getCached(this.priceCache, cacheKey);
    if (cached !== null) return cached;

    await this.waitForRateLimit();
    this.recordRequest();

    const params = new URLSearchParams({
      vs_currency: 'usd,idr',
      ids: coinId,
      price_change_percentage: '24h,7d,30d',
      precision: '2',
    });

    const response = await axios.get(
      `${process.env.COINGECKO_API_URL || 'https://api.coingecko.com/api/v3'}/coins/markets?${params}`,
      { headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } }
    );

    if (!response.data?.[0]) {
      return null;
    }

    const data = response.data[0];
    this.setCache(this.priceCache, cacheKey, data);
    return data;
  }

  async getTrending() {
    const cacheKey = 'trending';
    const cached = this.getCached(this.priceCache, cacheKey);
    if (cached !== null) return cached;

    await this.waitForRateLimit();
    this.recordRequest();

    const response = await axios.get(
      `${process.env.COINGECKO_API_URL || 'https://api.coingecko.com/api/v3'}/search/trending`,
      { headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } }
    );

    const coins = response.data.coins?.slice(0, 7).map(item => item.item) || [];
    this.setCache(this.priceCache, cacheKey, coins);
    return coins;
  }
}

module.exports = new CoinGeckoService();
