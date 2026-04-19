# WhatsApp Crypto Bot

Bot WhatsApp untuk cek harga cryptocurrency dengan integrasi CoinGecko dan WAHA (WhatsApp HTTP API).

## Fitur

- **Cek Harga** (`/p` atau `/price`) - Lihat harga coin dalam USD dan IDR beserta perubahan harga 24h, 7d, 30d
- **Konversi** (`/calc`) - Konversi jumlah crypto ke USD/IDR
- **Trending** (`/tren`) - Lihat 7 coins paling trending
- **Help** (`/help`) - Panduan penggunaan bot

## Teknologi

- **Express.js** - Webhook server untuk menerima events dari WAHA
- **WAHA** - WhatsApp HTTP API untuk mengirim/menerima pesan
- **CoinGecko API** - Data harga crypto
- **Mathjs** - Parser ekspresi matematika untuk kalkulasi
- **Docker** - Mendukung deployment dengan Docker

## Arsitektur

```
WAHA → POST /webhook → routes/webhook.js → command handlers
                                              ↓
                                         coingeckoService (untuk /price, /calc, /tren)
```

## Cara Instalasi

### Prasyarat

- Node.js 18+
- WAHA server (grab dari [waha-grid](https://waha-grid.onrender.com/docs))
- CoinGecko API key (opsional, untuk rate limit yang lebih tinggi)

### Local Development

```bash
# Clone repository
git clone <repo-url>
cd whatsapp-bot

# Install dependencies
npm install

# Salin dan edit environment variables
cp .env.example .env

# Edit .env sesuai konfigurasi WAHA dan CoinGecko
```

### Konfigurasi `.env`

```env
WAHA_URL=https://waha.opsipintar.site
WAHA_SESSION=default
COINGECKO_API_KEY=x-cg-demo-api-key
PORT=3000

# WAHA Engine (default: WEBJS)
WHATSAPP_DEFAULT_ENGINE=WEBJS
WHATSAPP_WEBJS_PUPPETER_ARGS=--no-sandbox

# Security (opsional)
WHATSAPP_HOOK_HMAC_KEY=

# Akses grup (kosongkan untuk publik)
ALLOWED_CHATS=
```

### Menjalankan

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

### Docker

```bash
# Build dan jalankan
docker-compose up -d

# Lihat logs
docker-compose logs -f
```

## Endpoint

| Method | Path | Deskripsi |
|--------|------|-----------|
| POST | `/webhook` | Endpoint webhook dari WAHA |
| GET | `/health` | Health check |

## Command

| Command | Deskripsi |
|---------|-----------|
| `/p <coin>` | Cek harga crypto (contoh: `/p btc`) |
| `/calc <jumlah> <coin> <currency>` | Konversi crypto (contoh: `/calc 1 ETH IDR`) |
| `/tren` | Lihat trending coins |
| `/help` | Tampilkan bantuan |

## License

MIT
