require('dotenv').config();
const axios = require('axios');

class WahaService {
  constructor() {
    this.baseUrl = process.env.WAHA_URL;
    this.session = process.env.WAHA_SESSION;
  }

  async sendMessage(chatId, text) {
    const response = await axios.post(`${this.baseUrl}/api/sendText`, {
      session: this.session,
      chatId,
      text,
    });
    return response.data;
  }
}

module.exports = new WahaService();
