require('dotenv').config();
const axios = require('axios');
const log = require('../utils/logger');

class WahaService {
  constructor() {
    this.baseUrl = process.env.WAHA_URL;
    this.session = process.env.WAHA_SESSION || 'default';
    this.apiKey  = process.env.WAHA_API_KEY || '';
  }

  get headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['X-Api-Key'] = this.apiKey;
    return h;
  }

  async sendMessage(chatId, text) {
    try {
      log.debug('WAHA', `Sending to ${chatId}: "${text.slice(0, 60)}..."`);
      const response = await axios.post(
        `${this.baseUrl}/api/sendText`,
        { session: this.session, chatId, text },
        { headers: this.headers }
      );
      log.debug('WAHA', `Send OK — status ${response.status}`);
      return response.data;
    } catch (err) {
      log.error('WAHA', `sendMessage failed: ${err.response?.status} ${err.response?.statusText || err.message}`);
      throw err;
    }
  }
}

module.exports = new WahaService();