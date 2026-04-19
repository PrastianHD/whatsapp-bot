# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start        # Start production server (node src/index.js)
npm run dev      # Development with auto-reload (node --watch src/index.js)
```

## Architecture

Express.js webhook server. Routes (`routes/webhook.js`) handles incoming WAHA events and dispatches to command handlers. Services layer (`services/coingecko.js`, `services/waha.js`) encapsulates external API calls.

### Request Flow
```
WAHA → POST /webhook → routes/webhook.js → command handlers → wahaService.sendMessage()
                                              ↓
                                         coingeckoService (for /price)
```

### Key Implementation Details

**WAHA Integration:**
- Webhook event: `message.created` (not `message`)
- Send message endpoint: `POST {WAHA_URL}/api/sendText` with body `{ session, chatId, text }`
- Session name from `WAHA_SESSION` env var (e.g., "default")
- Default engine: WEBJS (WhatsApp Web via Puppeteer - real browser to avoid blocking)
- Engine config: `WHATSAPP_DEFAULT_ENGINE=WEBJS`, `WHATSAPP_WEBJS_PUPPETER_ARGS=--no-sandbox`

**CoinGecko Rate Limiting:**
- Sliding window: 30 requests per minute tracked via `requestLog[]`
- `waitForRateLimit()` blocks when limit reached until oldest request expires
- Separate caches: `priceCache` and `searchCache` (60s TTL)
- API key via `x-cg-demo-api-key` header (not query param)

**Mathjs Security:**
- Use `math.parse(expression).evaluate()` pattern (not `math.evaluate()` directly)
- Wrap in `Promise.race()` with 1-second timeout to prevent CPU-blocking expressions
