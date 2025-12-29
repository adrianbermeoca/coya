# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Coya** is a web scraping application that aggregates real-time USD/PEN exchange rates from multiple currency exchange providers in Peru. It provides a modern web interface with historical data, trends, and a REST API.

## Commands

### Development
```bash
npm start          # Start production server (default port 3006)
npm run dev        # Start development server
```

### Database
The database is automatically initialized on first run at `./data/exchange_rates.db` (SQLite).

### Debugging Individual Scrapers
Each scraper has a dedicated debug script for isolated testing:

```bash
node debug-scraper.js          # Debug SUNAT scraper (Puppeteer)
node debug-kambista.js         # Debug Kambista scraper
node debug-bloomberg.js        # Debug Bloomberg scraper
node debug-all-sources.js      # Debug all scrapers sequentially
node test-sunat-selenium.js    # Test SUNAT with Selenium
node test-sunat-methods.js     # Test different SUNAT extraction methods
node test-bloomberg.js         # Test Bloomberg scraper
```

These scripts are critical for development - when a scraper breaks due to website changes, use the corresponding debug script to investigate and fix the extraction logic.

## Architecture

### Server Architecture (server.js)

The server uses a **progressive scraping** pattern where scrapers run independently in parallel:

1. **Parallel Execution**: All scrapers launch simultaneously using Promise-based concurrency
2. **Progressive Updates**: Results update `exchangeRates` in real-time as each scraper completes
3. **Background Completion**: Server starts after 30 seconds or when 2+ sources complete, but scrapers continue running
4. **Non-blocking**: Browser closes only after ALL scrapers finish (not when server starts)

**Key Functions:**
- `scrapeExchangeRates()`: Main orchestrator with retry logic (3 retries, exponential backoff)
- `addRateWhenReady()`: Helper that updates rates in real-time as scrapers complete
- Individual scraper functions: `scrapeKambista()`, `scrapeTkambio()`, `scrapeTucambista()`, `scrapeRextie()`, `scrapeBloomberg()`, `scrapeSunat()`

**Cron Jobs:**
- Scraping: Every N minutes (default: 5, configurable via `SCRAPE_INTERVAL_MINUTES`)
- Cleanup: Daily at 3 AM (keeps last 30 days of data)

### Scraping Strategy (3-Tier Fallback)

Each scraper attempts multiple extraction methods in order of reliability:

1. **Primary - JSON Extraction**:
   - `window.__NEXT_DATA__` for Next.js sites (CuantoEstaElDolar)
   - `self.__next_f` arrays for newer Next.js (Tucambista)
   - `window.Fusion.globalContent` for custom frameworks (Bloomberg)

2. **Secondary - DOM Patterns**:
   - Regex patterns in `document.body.innerText`
   - Contextual line-by-line analysis for "Compra"/"Venta" labels
   - Input fields (e.g., `input[name="compra"]`)

3. **Tertiary - Heuristic Fallback**:
   - Pattern matching for numbers in valid range (3.0-4.0)
   - Element proximity search
   - First valid number pairs

### Special Scraper Notes

**SUNAT** (`scrapeSunat()`):
- Uses **Selenium WebDriver** instead of Puppeteer (more reliable for SUNAT's security)
- Has very long timeouts (30s page load, 20s for table, 5s additional wait)
- Currently DISABLED in production (`server.js:931`) due to performance impact
- When enabled, runs with 45s timeout wrapper

**Tucambista** (`scrapeTucambista()`):
- Requires `waitUntil: 'networkidle0'` (90s timeout)
- Searches `self.__next_f` array for `"entity":"tucambista"` JSON pattern
- Needs 8s additional wait for JavaScript execution

**Bloomberg** (`scrapeBloomberg()`):
- Returns SPOT price (interbancario), not separate buy/sell rates
- Simulates spread (±0.005) from spot price for consistency
- Rate object includes `isSpot: true` flag

### Database Layer (database.js)

`ExchangeRateDB` class wraps better-sqlite3 with transaction support:

**Schema:**
```sql
CREATE TABLE exchange_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_name TEXT NOT NULL,
  buy_rate REAL NOT NULL,
  sell_rate REAL NOT NULL,
  spread REAL NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Key Methods:**
- `saveRates(rates)`: Transactional bulk insert
- `getProviderHistory(provider, hours)`: Time-series data for charts
- `getProviderStats(provider, days)`: Aggregated min/max/avg
- `getTrend(hours, interval)`: Bucketed time-series averages
- `cleanOldRecords(days)`: Maintenance cleanup

**Indexes:** Compound index on `(provider_name, timestamp)` for efficient queries.

### Frontend (public/)

- **index.html**: Static HTML with glassmorphism design
- **app.js**: Vanilla JS client that polls `/api/rates` and renders with Chart.js
- **styles.css**: CSS custom properties for theming, responsive breakpoints

No build step required - pure static files served by Express.

## API Endpoints

All endpoints return JSON. CORS is enabled.

| Endpoint | Description |
|----------|-------------|
| `GET /api/rates` | Current rates from all providers |
| `GET /api/refresh` | Force immediate scraping update |
| `GET /api/best-rates` | Best buy/sell rates across providers |
| `GET /api/trend?hours=24&interval=1` | Historical trend data |
| `GET /api/history/:provider?hours=24` | Provider-specific history |
| `GET /api/stats/:provider?days=7` | Provider statistics (min/max/avg) |
| `GET /api/providers` | List of all providers in database |
| `GET /api/db-stats` | Database metadata (record count, date range) |
| `GET /api/health` | Health check with status |

## Development Patterns

### Adding a New Scraper

1. Create scraper function in `server.js`:
   ```javascript
   async function scrapeNewProvider(browser) {
     const page = await browser.newPage();
     // Extraction logic with 3-tier fallback
     return [{ name: 'Provider', compra: X, venta: Y, timestamp: ISO }];
   }
   ```

2. Add to parallel execution in `scrapeExchangeRates()`:
   ```javascript
   const scrapePromises = [
     // ... existing scrapers
     addRateWhenReady('NewProvider', scrapeNewProvider(browser))
   ];
   ```

3. Create debug script `debug-newprovider.js` for isolated testing

### Debugging Scraper Failures

When a scraper stops working:

1. Run its debug script: `node debug-<provider>.js`
2. Set `PUPPETEER_HEADLESS=false` in `.env` to see browser
3. Check extraction logic against current website structure
4. Update JSON paths or DOM selectors as needed
5. Consider adding new extraction method tier

### Testing Changes

No automated test suite. Manual testing:
1. Start server: `npm start`
2. Watch logs for scraper success/failure
3. Check `http://localhost:3006/api/rates` for data
4. Monitor frontend at `http://localhost:3006`

## Environment Variables

Required in `.env` file:

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | HTTP server port | `3006` |
| `SCRAPE_INTERVAL_MINUTES` | Auto-scrape frequency | `5` |
| `PUPPETEER_HEADLESS` | Run browser visible (`false`) or hidden (`true`) | `true` |
| `DB_PATH` | SQLite database location | `./data/exchange_rates.db` |
| `NODE_ENV` | Environment identifier | `development` |

## Common Issues

**Scraper returns empty array:** Website structure changed. Use debug script to investigate DOM changes.

**SUNAT timeout:** Normal - SUNAT has aggressive bot protection. Selenium helps but is slow (disabled by default).

**Database locked:** better-sqlite3 doesn't support concurrent writes. The app uses transactions to prevent this.

**Tucambista fails:** Increase wait time or check if `self.__next_f` structure changed.

## File Organization

```
coya/
├── server.js              # Main Express server + all scrapers
├── database.js            # SQLite database wrapper class
├── public/
│   ├── index.html        # Frontend UI
│   ├── app.js            # Client-side JavaScript
│   └── styles.css        # Styling
├── debug-*.js            # Individual scraper debug scripts
├── test-*.js             # Alternative test implementations
├── data/                 # SQLite database (gitignored)
│   └── exchange_rates.db
└── .env                  # Environment configuration (gitignored)
```

## Technology Stack

- **Runtime:** Node.js with Express 5
- **Scraping:** Puppeteer (headless Chrome) + Selenium WebDriver (SUNAT only)
- **Database:** better-sqlite3 (synchronous SQLite)
- **Scheduling:** node-cron
- **Frontend:** Vanilla JS + Chart.js 4

## Notes for Future Work

- SUNAT scraper is functional but disabled due to 45s+ execution time
- Bloomberg returns simulated spread from spot price
- All scrapers run independently; partial failures don't block server startup
- Database cleanup retains 30 days; adjust `cleanOldRecords()` parameter if needed
