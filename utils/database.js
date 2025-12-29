const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

class ExchangeRateDB {
  constructor(dbPath = './data/exchange_rates.db') {
    // Crear directorio data si no existe
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.initDatabase();
  }

  initDatabase() {
    // Crear tabla de historial de tasas
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS exchange_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_name TEXT NOT NULL,
        buy_rate REAL NOT NULL,
        sell_rate REAL NOT NULL,
        spread REAL NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_timestamp ON exchange_rates(timestamp);
      CREATE INDEX IF NOT EXISTS idx_provider ON exchange_rates(provider_name);
      CREATE INDEX IF NOT EXISTS idx_provider_timestamp ON exchange_rates(provider_name, timestamp);
    `);

    console.log('✅ Base de datos inicializada');
  }

  // Guardar tasas actuales
  saveRates(rates) {
    const insert = this.db.prepare(`
      INSERT INTO exchange_rates (provider_name, buy_rate, sell_rate, spread, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((rates) => {
      for (const rate of rates) {
        const spread = rate.venta - rate.compra;
        insert.run(
          rate.name,
          rate.compra,
          rate.venta,
          spread,
          rate.timestamp || new Date().toISOString()
        );
      }
    });

    try {
      insertMany(rates);
      console.log(`💾 Guardadas ${rates.length} tasas en la base de datos`);
      return true;
    } catch (error) {
      console.error('❌ Error guardando tasas:', error);
      return false;
    }
  }

  // Obtener últimas tasas (mismo timestamp)
  getLatestRates() {
    const query = `
      SELECT provider_name, buy_rate, sell_rate, spread, timestamp
      FROM exchange_rates
      WHERE timestamp = (SELECT MAX(timestamp) FROM exchange_rates)
      ORDER BY provider_name
    `;

    return this.db.prepare(query).all();
  }

  // Obtener la tasa más reciente de CADA proveedor (timestamps pueden variar)
  getLatestRatePerProvider() {
    const query = `
      WITH ranked_rates AS (
        SELECT
          provider_name,
          buy_rate,
          sell_rate,
          spread,
          timestamp,
          ROW_NUMBER() OVER (PARTITION BY provider_name ORDER BY timestamp DESC) as rn
        FROM exchange_rates
      )
      SELECT
        provider_name,
        buy_rate,
        sell_rate,
        spread,
        timestamp
      FROM ranked_rates
      WHERE rn = 1
      ORDER BY provider_name
    `;

    return this.db.prepare(query).all();
  }

  // Obtener historial de un proveedor específico
  getProviderHistory(providerName, hours = 24) {
    const query = `
      SELECT provider_name, buy_rate, sell_rate, spread, timestamp
      FROM exchange_rates
      WHERE provider_name = ?
        AND timestamp >= datetime('now', '-' || ? || ' hours')
      ORDER BY timestamp ASC
    `;

    return this.db.prepare(query).all(providerName, hours);
  }

  // Obtener estadísticas de un proveedor
  getProviderStats(providerName, days = 7) {
    const query = `
      SELECT
        provider_name,
        MIN(buy_rate) as min_buy,
        MAX(buy_rate) as max_buy,
        AVG(buy_rate) as avg_buy,
        MIN(sell_rate) as min_sell,
        MAX(sell_rate) as max_sell,
        AVG(sell_rate) as avg_sell,
        MIN(spread) as min_spread,
        MAX(spread) as max_spread,
        AVG(spread) as avg_spread,
        COUNT(*) as total_records
      FROM exchange_rates
      WHERE provider_name = ?
        AND timestamp >= datetime('now', '-' || ? || ' days')
      GROUP BY provider_name
    `;

    return this.db.prepare(query).get(providerName, days);
  }

  // Obtener mejores tasas en un período
  getBestRatesInPeriod(hours = 24) {
    const query = `
      WITH recent_rates AS (
        SELECT provider_name, buy_rate, sell_rate, spread, timestamp
        FROM exchange_rates
        WHERE timestamp >= datetime('now', '-' || ? || ' hours')
      )
      SELECT
        'Mejor Compra' as type,
        provider_name,
        buy_rate as rate,
        timestamp
      FROM recent_rates
      WHERE buy_rate = (SELECT MAX(buy_rate) FROM recent_rates)
      LIMIT 1

      UNION ALL

      SELECT
        'Mejor Venta' as type,
        provider_name,
        sell_rate as rate,
        timestamp
      FROM recent_rates
      WHERE sell_rate = (SELECT MIN(sell_rate) FROM recent_rates)
      LIMIT 1
    `;

    return this.db.prepare(query).all(hours);
  }

  // Obtener tendencia general (últimas N horas)
  getTrend(hours = 24, interval = 1) {
    const query = `
      SELECT
        datetime(timestamp, '-' || (strftime('%M', timestamp) % ?) || ' minutes') as time_bucket,
        AVG(buy_rate) as avg_buy,
        AVG(sell_rate) as avg_sell,
        MIN(buy_rate) as min_buy,
        MAX(buy_rate) as max_buy,
        MIN(sell_rate) as min_sell,
        MAX(sell_rate) as max_sell,
        COUNT(DISTINCT provider_name) as provider_count
      FROM exchange_rates
      WHERE timestamp >= datetime('now', '-' || ? || ' hours')
      GROUP BY time_bucket
      ORDER BY time_bucket ASC
    `;

    return this.db.prepare(query).all(interval * 60, hours);
  }

  // Obtener lista de todos los proveedores
  getAllProviders() {
    const query = `
      SELECT DISTINCT provider_name
      FROM exchange_rates
      ORDER BY provider_name
    `;

    return this.db.prepare(query).all().map(row => row.provider_name);
  }

  // Limpiar registros antiguos (mantener solo últimos N días)
  cleanOldRecords(daysToKeep = 30) {
    const query = `
      DELETE FROM exchange_rates
      WHERE timestamp < datetime('now', '-' || ? || ' days')
    `;

    const result = this.db.prepare(query).run(daysToKeep);
    console.log(`🧹 Limpiados ${result.changes} registros antiguos`);
    return result.changes;
  }

  // Obtener estadísticas generales de la base de datos
  getDatabaseStats() {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total_records,
        COUNT(DISTINCT provider_name) as total_providers,
        MIN(timestamp) as oldest_record,
        MAX(timestamp) as newest_record
      FROM exchange_rates
    `).get();

    return stats;
  }

  close() {
    this.db.close();
  }
}

module.exports = ExchangeRateDB;
