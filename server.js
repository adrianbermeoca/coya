require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const path = require('path');
const ExchangeRateDB = require('./utils/database');
const {
  validateQueryParams,
  validateProviderParam,
  VALID_PROVIDERS
} = require('./utils/security');

const app = express();
const PORT = process.env.PORT || 3006;
const db = new ExchangeRateDB(process.env.DB_PATH);

// ============================================
// SECURITY MIDDLEWARE
// ============================================

// 0. Trust proxy - Necesario para Render.com y rate limiting
app.set('trust proxy', 1);

// 1. Helmet - Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:", "cdn.jsdelivr.net"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// 2. CORS - Configuración restrictiva por entorno
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3006', 'http://127.0.0.1:3006'];

const corsOptions = {
  origin: function (origin, callback) {
    // Permitir requests sin origin (como mobile apps o curl)
    if (!origin) return callback(null, true);

    // En desarrollo, permitir todos los orígenes
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    // En producción, verificar lista blanca
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  optionsSuccessStatus: 200,
  credentials: true
};

app.use(cors(corsOptions));

// 3. Rate Limiting - Protección contra abuso
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests por IP
  message: { error: 'Demasiadas solicitudes desde esta IP. Intenta nuevamente en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // No limitar en desarrollo
    return process.env.NODE_ENV !== 'production';
  }
});

// Rate limit más estricto para endpoints sensibles
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // Solo 10 requests por IP
  message: { error: 'Límite de solicitudes excedido para este endpoint.' },
  skip: (req) => process.env.NODE_ENV !== 'production'
});

// 4. Body parsing con límites
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 5. Servir archivos estáticos
app.use(express.static('public'));

// Manejar favicon para evitar error 404
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Almacenamiento en memoria de las tasas
let exchangeRates = {
  lastUpdate: null,
  rates: [],
  error: null
};

// Función para scraping de Kambista.com
async function scrapeKambista(browser) {
  console.log('📍 Scraping Kambista.com...');

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Navegar a Kambista
    await page.goto('https://kambista.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000  // Aumentado para Render
    });

    // Espera mínima - las tasas están en HTML inicial
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Extraer tasas de cambio
    const rate = await page.evaluate(() => {
      // Método 1: Buscar por texto en el body
      const bodyText = document.body.innerText;
      const compraMatch = bodyText.match(/Compra[:\s]*(\d+\.\d+)/i);
      const ventaMatch = bodyText.match(/Venta[:\s]*(\d+\.\d+)/i);

      if (compraMatch && ventaMatch) {
        return {
          name: 'Kambista',
          compra: parseFloat(compraMatch[1]),
          venta: parseFloat(ventaMatch[1]),
          timestamp: new Date().toISOString()
        };
      }

      // Método 2: Buscar inputs de calculadora
      const compraInput = document.querySelector('input[name="compra"]');
      const ventaInput = document.querySelector('input[name="venta"]');

      if (compraInput && ventaInput && compraInput.value && ventaInput.value) {
        return {
          name: 'Kambista',
          compra: parseFloat(compraInput.value),
          venta: parseFloat(ventaInput.value),
          timestamp: new Date().toISOString()
        };
      }

      return null;
    });

    await page.close();

    if (rate && rate.compra > 0 && rate.venta > 0) {
      console.log('✅ Kambista extraído:', rate);
      return [rate];
    } else {
      console.log('⚠️ No se pudo extraer tasas de Kambista');
      return [];
    }

  } catch (error) {
    console.error('❌ Error scraping Kambista:', error.message);
    return [];
  }
}

// Función para scraping de Banco de la Nación
async function scrapeBancoDeLaNacion(browser) {
  console.log('📍 Scraping Banco de la Nación...');

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Navegar a Banco de la Nación
    await page.goto('https://bancaporinternet.bn.com.pe/TCWeb/', {
      waitUntil: 'domcontentloaded',
      timeout: 40000
    });

    // Esperar más tiempo para la verificación de seguridad
    console.log('⏳ Esperando verificación de seguridad del Banco de la Nación...');
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Extraer tasas de cambio
    const rate = await page.evaluate(() => {
      // Método 1: Buscar en tablas
      const tables = document.querySelectorAll('table');
      for (const table of tables) {
        const text = table.innerText;

        // Buscar patrón "Compra" y "Venta"
        const compraMatch = text.match(/Compra[:\s]*(\d+\.\d+)/i);
        const ventaMatch = text.match(/Venta[:\s]*(\d+\.\d+)/i);

        if (compraMatch && ventaMatch) {
          return {
            name: 'Banco de la Nación',
            compra: parseFloat(compraMatch[1]),
            venta: parseFloat(ventaMatch[1]),
            timestamp: new Date().toISOString()
          };
        }
      }

      // Método 2: Buscar en todo el body
      const bodyText = document.body.innerText;

      // Buscar formato común: "Compra: X.XXX" "Venta: X.XXX"
      const compraMatch = bodyText.match(/Compra[:\s]*(\d+\.\d+)/i);
      const ventaMatch = bodyText.match(/Venta[:\s]*(\d+\.\d+)/i);

      if (compraMatch && ventaMatch) {
        return {
          name: 'Banco de la Nación',
          compra: parseFloat(compraMatch[1]),
          venta: parseFloat(ventaMatch[1]),
          timestamp: new Date().toISOString()
        };
      }

      // Método 3: Buscar formato alternativo "TC Compra" "TC Venta"
      const tcCompraMatch = bodyText.match(/TC[:\s]*Compra[:\s]*(\d+\.\d+)/i);
      const tcVentaMatch = bodyText.match(/TC[:\s]*Venta[:\s]*(\d+\.\d+)/i);

      if (tcCompraMatch && tcVentaMatch) {
        return {
          name: 'Banco de la Nación',
          compra: parseFloat(tcCompraMatch[1]),
          venta: parseFloat(tcVentaMatch[1]),
          timestamp: new Date().toISOString()
        };
      }

      // Método 4: Buscar dos números consecutivos que parezcan tasas
      const numbers = bodyText.match(/\b3\.\d{3}\b/g);
      if (numbers && numbers.length >= 2) {
        const rates = numbers.map(n => parseFloat(n)).filter(r => r > 0);
        if (rates.length >= 2) {
          return {
            name: 'Banco de la Nación',
            compra: Math.min(rates[0], rates[1]),
            venta: Math.max(rates[0], rates[1]),
            timestamp: new Date().toISOString()
          };
        }
      }

      return null;
    });

    await page.close();

    if (rate && rate.compra > 0 && rate.venta > 0) {
      console.log('✅ Banco de la Nación extraído:', rate);
      return [rate];
    } else {
      console.log('⚠️ No se pudo extraer tasas del Banco de la Nación');
      return [];
    }

  } catch (error) {
    console.error('❌ Error scraping Banco de la Nación:', error.message);
    return [];
  }
}

// Función para scraping de SUNAT usando Selenium
async function scrapeSunat(browser) {
  console.log('📍 Scraping SUNAT con Selenium...');

  const { Builder, By, until } = require('selenium-webdriver');
  const chrome = require('selenium-webdriver/chrome');

  let driver;

  try {
    // Configurar opciones de Chrome
    const options = new chrome.Options();
    options.addArguments('--headless=new');
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');
    options.addArguments('--disable-gpu');
    options.addArguments('--window-size=1920,1080');
    options.addArguments('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    // Crear driver de Selenium con timeout
    console.log('🚀 Iniciando Chrome con Selenium...');
    driver = await new Builder()
      .forBrowser('chrome')
      .setChromeOptions(options)
      .build();

    // Establecer timeouts del driver
    await driver.manage().setTimeouts({
      implicit: 10000,
      pageLoad: 30000,
      script: 30000
    });

    console.log('🌐 Navegando a SUNAT...');
    await driver.get('https://e-consulta.sunat.gob.pe/cl-at-ittipcam/tcS01Alias');

    console.log('⏳ Esperando tabla...');
    await driver.wait(until.elementLocated(By.css('table')), 20000);

    console.log('⏳ Esperando 5 segundos adicionales...');
    await driver.sleep(5000);

    console.log('📄 Extrayendo texto...');
    const bodyText = await driver.findElement(By.tagName('body')).getText();

    // Buscar tasas con regex simple (método que funcionó en el test)
    const compraMatch = bodyText.match(/Compra[:\s]*[S\/]?\s*(\d+\.\d{3,4})/i);
    const ventaMatch = bodyText.match(/Venta[:\s]*[S\/]?\s*(\d+\.\d{3,4})/i);

    await driver.quit();

    if (compraMatch && ventaMatch) {
      const rate = {
        name: 'SUNAT',
        compra: parseFloat(compraMatch[1]),
        venta: parseFloat(ventaMatch[1]),
        timestamp: new Date().toISOString()
      };
      console.log('✅ SUNAT extraído con Selenium:', rate);
      return [rate];
    } else {
      console.log('⚠️ No se pudieron extraer tasas de SUNAT');
      return [];
    }

  } catch (error) {
    console.error('❌ Error scraping SUNAT con Selenium:', error.message);
    if (driver) {
      try {
        await driver.quit();
      } catch (quitError) {
        console.error('Error cerrando driver:', quitError.message);
      }
    }
    return [];
  }
}

// Función para scraping de Rextie.com
async function scrapeRextie(browser) {
  console.log('📍 Scraping Rextie.com...');

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Navegar a Rextie
    await page.goto('https://www.rextie.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000  // Aumentado para Render
    });

    // Espera mínima - tasas en HTML inicial
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Extraer tasas de cambio
    const rate = await page.evaluate(() => {
      // Método 1: Buscar sección "REXTIE BUSINESS" o tasas principales
      const bodyText = document.body.innerText;

      // Dividir en líneas para análisis contextual
      const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l);

      let compra = null;
      let venta = null;
      let foundRextieSection = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineLower = line.toLowerCase();

        // Marcar cuando encontramos la sección de Rextie
        if (lineLower.includes('rextie') && !lineLower.includes('sunat') && !lineLower.includes('banco')) {
          foundRextieSection = true;
        }

        // Si estamos en la sección Rextie o en las primeras líneas
        if (foundRextieSection || i < 50) {
          // Buscar "Compra:" seguido de número en líneas cercanas
          if (lineLower === 'compra:' || lineLower.includes('compra')) {
            // Buscar número en esta línea o las siguientes 3
            for (let j = i; j < Math.min(i + 4, lines.length); j++) {
              const match = lines[j].match(/s\/?\s*(\d+\.\d{3,4})/);
              if (match && !compra) {
                const val = parseFloat(match[1]);
                if (val > 3 && val < 4) { // Rango válido
                  compra = val;
                  break;
                }
              }
            }
          }

          // Buscar "Venta:" seguido de número en líneas cercanas
          if (lineLower === 'venta:' || lineLower.includes('venta')) {
            // Buscar número en esta línea o las siguientes 3
            for (let j = i; j < Math.min(i + 4, lines.length); j++) {
              const match = lines[j].match(/s\/?\s*(\d+\.\d{3,4})/);
              if (match && !venta && compra) { // Solo si ya tenemos compra
                const val = parseFloat(match[1]);
                if (val > 3 && val < 4 && val !== compra) { // Diferente a compra
                  venta = val;
                  break;
                }
              }
            }
          }

          // Si ya tenemos ambas, salir
          if (compra && venta) break;

          // Si encontramos SUNAT o Bancos, detener
          if (lineLower.includes('sunat') || lineLower.includes('banco')) {
            if (compra && venta) break;
          }
        }
      }

      if (compra && venta && compra > 0 && venta > 0 && compra !== venta) {
        return {
          name: 'Rextie',
          compra,
          venta,
          timestamp: new Date().toISOString()
        };
      }

      // Método 2: Buscar primer par de números válidos (fallback)
      const allNumbers = bodyText.match(/s\/?\s*(\d+\.\d{3,4})/gi);
      if (allNumbers && allNumbers.length >= 2) {
        const rates = allNumbers
          .map(m => parseFloat(m.replace(/s\/?\s*/i, '')))
          .filter(r => !isNaN(r) && r > 3.2 && r < 3.5); // Rango más específico

        if (rates.length >= 2) {
          // Tomar los dos primeros números diferentes
          const uniqueRates = [...new Set(rates)];
          if (uniqueRates.length >= 2) {
            return {
              name: 'Rextie',
              compra: Math.min(uniqueRates[0], uniqueRates[1]),
              venta: Math.max(uniqueRates[0], uniqueRates[1]),
              timestamp: new Date().toISOString()
            };
          }
        }
      }

      return null;
    });

    await page.close();

    if (rate && rate.compra > 0 && rate.venta > 0) {
      console.log('✅ Rextie extraído:', rate);
      return [rate];
    } else {
      console.log('⚠️ No se pudo extraer tasas de Rextie');
      return [];
    }

  } catch (error) {
    console.error('❌ Error scraping Rextie:', error.message);
    return [];
  }
}

// Función para scraping de Tucambista.pe
async function scrapeTucambista(browser) {
  console.log('📍 Scraping Tucambista.pe (Puppeteer con espera larga)...');

  try {
    const page = await browser.newPage();

    // Configurar user agent realista
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // Navegar con timeout muy largo
    console.log('🌐 Navegando a Tucambista (puede tardar hasta 2 minutos)...');
    await page.goto('https://tucambista.pe/', {
      waitUntil: 'domcontentloaded',  // Cambiado para ser más rápido en Render
      timeout: 120000  // 120 segundos (2 minutos)
    });

    console.log('⏳ Esperando 8 segundos para que carguen datos...');
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Extraer tasas
    const rate = await page.evaluate(() => {
      // Buscar en self.__next_f
      if (typeof self !== 'undefined' && self.__next_f && Array.isArray(self.__next_f)) {
        const fullData = JSON.stringify(self.__next_f);

        // Patrón para tucambista
        const pattern = /"entity"\s*:\s*"tucambista"[^}]*"buyExchangeRate"\s*:\s*"?([\d.]+)"?[^}]*"sellExchangeRate"\s*:\s*"?([\d.]+)"?/i;
        const match = fullData.match(pattern);

        if (match) {
          const compra = parseFloat(match[1]);
          const venta = parseFloat(match[2]);

          if (compra > 0 && venta > 0 && compra >= 3 && compra <= 4) {
            return {
              name: 'Tucambista',
              compra,
              venta,
              timestamp: new Date().toISOString()
            };
          }
        }
      }

      // Fallback: buscar en texto visible
      const bodyText = document.body.innerText;
      const compraMatch = bodyText.match(/compra[:\s]*(3\.\d{1,4})/i);
      const ventaMatch = bodyText.match(/venta[:\s]*(3\.\d{1,4})/i);

      if (compraMatch && ventaMatch) {
        return {
          name: 'Tucambista',
          compra: parseFloat(compraMatch[1]),
          venta: parseFloat(ventaMatch[1]),
          timestamp: new Date().toISOString()
        };
      }

      return null;
    });

    await page.close();

    if (rate && rate.compra > 0 && rate.venta > 0) {
      console.log('✅ Tucambista extraído:', rate);
      return [rate];
    } else {
      console.log('⚠️ No se pudo extraer tasas de Tucambista');
      return [];
    }

  } catch (error) {
    console.error('❌ Error scraping Tucambista:', error.message);
    return [];
  }
}

// Función para scraping de Tkambio.com
async function scrapeTkambio(browser) {
  console.log('📍 Scraping Tkambio.com...');

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Navegar a Tkambio
    await page.goto('https://tkambio.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000  // Aumentado para Render
    });

    // Espera para JavaScript dinámico
    await new Promise(resolve => setTimeout(resolve, 2500));

    // Extraer tasas de cambio
    const rate = await page.evaluate(() => {
      // Método 1: Buscar por texto en el body
      const bodyText = document.body.innerText;
      const compraMatch = bodyText.match(/Compra[:\s]*(\d+\.\d+)/i);
      const ventaMatch = bodyText.match(/Venta[:\s]*(\d+\.\d+)/i);

      if (compraMatch && ventaMatch) {
        return {
          name: 'Tkambio',
          compra: parseFloat(compraMatch[1]),
          venta: parseFloat(ventaMatch[1]),
          timestamp: new Date().toISOString()
        };
      }

      // Método 2: Buscar elementos con texto que contenga tasas
      const allElements = Array.from(document.querySelectorAll('*'));
      const rateElements = allElements.filter(el => {
        const text = el.textContent || '';
        return text.match(/3\.\d{2,4}/) && text.length < 50;
      });

      if (rateElements.length >= 2) {
        const rates = rateElements
          .map(el => parseFloat(el.textContent.match(/3\.\d{2,4}/)?.[0]))
          .filter(r => !isNaN(r) && r > 0)
          .slice(0, 2);

        if (rates.length === 2) {
          return {
            name: 'Tkambio',
            compra: Math.min(...rates),
            venta: Math.max(...rates),
            timestamp: new Date().toISOString()
          };
        }
      }

      return null;
    });

    await page.close();

    if (rate && rate.compra > 0 && rate.venta > 0) {
      console.log('✅ Tkambio extraído:', rate);
      return [rate];
    } else {
      console.log('⚠️ No se pudo extraer tasas de Tkambio');
      return [];
    }

  } catch (error) {
    console.error('❌ Error scraping Tkambio:', error.message);
    return [];
  }
}

// Función para scraping de CuantoEstaElDolar.pe
async function scrapeCuantoEstaElDolar(browser) {
  console.log('📍 Scraping CuantoEstaElDolar.pe...');

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Capturar console.log del navegador
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('DEBUG')) {
        console.log('🌐 BROWSER:', text);
      }
    });

    // Navegar a la página comparadora
    await page.goto('https://cuantoestaeldolar.pe/', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Esperar un poco más para que carguen los datos dinámicos
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Extraer las tasas de cambio - Método mejorado
    const rates = await page.evaluate(() => {
      const results = [];

      // Método 1: Extraer JSON de Next.js (más robusto)
      try {
        // Next.js embebe los datos en __NEXT_DATA__
        if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props) {
          const pageProps = window.__NEXT_DATA__.props.pageProps;

          // Buscar datos de casas de cambio
          const exchangeHouses = pageProps.exchangeHouses || [];

          console.log('🔍 DEBUG: exchangeHouses encontrados:', exchangeHouses.length);
          console.log('🔍 DEBUG: Primer exchangeHouse:', JSON.stringify(exchangeHouses[0], null, 2));

          if (exchangeHouses && exchangeHouses.length > 0) {
            exchangeHouses.forEach(house => {
              console.log('🔍 DEBUG: Procesando house:', {
                title: house.title,
                hasRates: !!house.rates,
                hasBuy: !!(house.rates && house.rates.buy),
                hasSale: !!(house.rates && house.rates.sale)
              });

              // Validar que tenga los datos necesarios
              if (house.title && house.rates && house.rates.buy && house.rates.sale) {
                const buyRate = parseFloat(house.rates.buy.cost);
                const sellRate = parseFloat(house.rates.sale.cost);

                console.log('🔍 DEBUG: Rates extraídas:', {
                  name: house.title,
                  buyRate,
                  sellRate
                });

                // Validar que las tasas sean números válidos
                if (!isNaN(buyRate) && !isNaN(sellRate) && buyRate > 0 && sellRate > 0) {
                  results.push({
                    name: house.title.trim(),
                    compra: buyRate,
                    venta: sellRate,
                    timestamp: new Date().toISOString()
                  });
                }
              }
            });

            if (results.length > 0) {
              console.log(`✅ Método JSON Next.js: ${results.length} casas encontradas`);
              console.log('🔍 DEBUG: Results completos:', JSON.stringify(results, null, 2));
              return results;
            }
          }
        }
      } catch (e) {
        console.error('Error en método JSON Next.js:', e.message);
      }

      // Método 2: Buscar scripts JSON embebidos (fallback)
      try {
        const scripts = Array.from(document.querySelectorAll('script[type="application/json"]'));

        for (const script of scripts) {
          try {
            const data = JSON.parse(script.textContent);

            // Buscar recursivamente arrays que parezcan datos de casas de cambio
            const findExchangeData = (obj) => {
              if (Array.isArray(obj)) {
                obj.forEach(item => {
                  if (item && typeof item === 'object') {
                    if ((item.title || item.name) && item.rates) {
                      results.push({
                        name: item.title || item.name,
                        compra: parseFloat(item.rates.buy?.cost || item.rates.buy),
                        venta: parseFloat(item.rates.sale?.cost || item.rates.sale),
                        timestamp: new Date().toISOString()
                      });
                    }
                    findExchangeData(item);
                  }
                });
              } else if (obj && typeof obj === 'object') {
                Object.values(obj).forEach(findExchangeData);
              }
            };

            findExchangeData(data);

            if (results.length > 0) {
              console.log(`✅ Método scripts JSON: ${results.length} casas encontradas`);
              return results;
            }
          } catch (e) {
            // Continuar con el siguiente script
          }
        }
      } catch (e) {
        console.error('Error en método scripts JSON:', e.message);
      }

      // Método 3: Búsqueda por DOM (fallback legacy)
      try {
        const allElements = Array.from(document.querySelectorAll('*'));
        const casasDeCambio = [
          'rextie', 'cambia', 'dollar', 'chapa', 'dichi', 'money',
          'mercado', 'inti', 'chaski', 'peru', 'dolarex', 'securex',
          'tkambio', 'tucambista', 'cuanto'
        ];

        const rows = [];

        for (let i = 0; i < allElements.length; i++) {
          const el = allElements[i];
          const text = (el.textContent || '').toLowerCase().trim();

          for (const casa of casasDeCambio) {
            if (text.includes(casa) && text.length < 100) {
              const nearbyNumbers = [];
              const searchRadius = 10;

              for (let j = Math.max(0, i - searchRadius); j < Math.min(allElements.length, i + searchRadius); j++) {
                const nearEl = allElements[j];
                const nearText = nearEl.textContent || '';
                const matches = nearText.match(/\b3\.\d{3,4}\b/g);
                if (matches) {
                  nearbyNumbers.push(...matches);
                }
              }

              if (nearbyNumbers.length >= 2) {
                const uniqueNumbers = [...new Set(nearbyNumbers)].map(n => parseFloat(n));
                if (uniqueNumbers.length >= 2) {
                  rows.push({
                    name: el.textContent.trim(),
                    numbers: uniqueNumbers.slice(0, 2)
                  });
                  break;
                }
              }
            }
          }
        }

        for (const row of rows) {
          const [num1, num2] = row.numbers;
          results.push({
            name: row.name,
            compra: Math.min(num1, num2),
            venta: Math.max(num1, num2),
            timestamp: new Date().toISOString()
          });
        }

        if (results.length > 0) {
          console.log(`⚠️ Método DOM legacy: ${results.length} casas encontradas`);
        }

      } catch (e) {
        console.error('Error en método DOM:', e.message);
      }

      return results;
    });

    await page.close();

    console.log(`✅ CuantoEstaElDolar: ${rates.length} casas encontradas`);
    return rates;

  } catch (error) {
    console.error('❌ Error scraping CuantoEstaElDolar:', error.message);
    return [];
  }
}

// Función para scraping de Bloomberg Línea
async function scrapeBloomberg(browser) {
  console.log('📍 Scraping Bloomberg Línea...');

  try {
    const page = await browser.newPage();

    // Configurar user agent realista
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // Navegar a Bloomberg Línea
    await page.goto('https://www.bloomberglinea.com/quote/USDPEN:CUR/', {
      waitUntil: 'domcontentloaded',  // Cambiado para ser más rápido
      timeout: 90000  // Aumentado para Render
    });

    // Esperar a que cargue el contenido dinámico
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Extraer tasa de cambio
    const rate = await page.evaluate(() => {
      // Método 1: Extraer de window.Fusion.globalContent (más confiable)
      if (window.Fusion && window.Fusion.globalContent) {
        const data = window.Fusion.globalContent;

        // PX_LAST contiene el precio spot actual
        if (data.PX_LAST) {
          const spotPrice = parseFloat(data.PX_LAST);

          if (spotPrice > 0 && spotPrice >= 3 && spotPrice <= 5) {
            // Bloomberg muestra precio spot (interbancario), no tiene compra/venta separados
            // Usamos el mismo valor para ambos con un spread mínimo simulado
            const spread = 0.005; // 0.5 centavos de spread típico

            return {
              name: 'Bloomberg Línea (Spot)',
              compra: spotPrice - spread,
              venta: spotPrice + spread,
              timestamp: new Date().toISOString(),
              isSpot: true
            };
          }
        }
      }

      // Método 2 (fallback): Buscar elementos con clase data-value
      const dataValueElements = document.querySelectorAll('.data-value.font_sm.font_medium');
      if (dataValueElements.length > 0) {
        const firstValue = dataValueElements[0].textContent.trim();
        const spotPrice = parseFloat(firstValue);

        if (spotPrice > 0 && spotPrice >= 3 && spotPrice <= 5) {
          const spread = 0.005;

          return {
            name: 'Bloomberg Línea (Spot)',
            compra: spotPrice - spread,
            venta: spotPrice + spread,
            timestamp: new Date().toISOString(),
            isSpot: true
          };
        }
      }

      // Método 3 (fallback final): Buscar patrón numérico en texto
      const bodyText = document.body.innerText;
      const priceMatch = bodyText.match(/([3-4]\.\d{2,4})\s*PEN/);

      if (priceMatch) {
        const spotPrice = parseFloat(priceMatch[1]);

        if (spotPrice > 0 && spotPrice >= 3 && spotPrice <= 5) {
          const spread = 0.005;

          return {
            name: 'Bloomberg Línea (Spot)',
            compra: spotPrice - spread,
            venta: spotPrice + spread,
            timestamp: new Date().toISOString(),
            isSpot: true
          };
        }
      }

      return null;
    });

    await page.close();

    if (rate && rate.compra > 0 && rate.venta > 0) {
      console.log('✅ Bloomberg extraído:', rate);
      return [rate];
    } else {
      console.log('⚠️ No se pudo extraer tasa de Bloomberg');
      return [];
    }

  } catch (error) {
    console.error('❌ Error scraping Bloomberg:', error.message);
    return [];
  }
}

// Función para scraping de Western Union Peru
async function scrapeWesternUnion(browser) {
  console.log('📍 Scraping Western Union Peru...');

  try {
    const page = await browser.newPage();

    // Configurar user agent realista
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // Navegar a Western Union Peru
    await page.goto('https://www.westernunionperu.pe/cambiodemoneda', {
      waitUntil: 'domcontentloaded',  // Cambiado para ser más rápido
      timeout: 90000  // Aumentado para Render
    });

    // Esperar a que cargue el contenido dinámico
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Extraer tasa de cambio
    const rate = await page.evaluate(() => {
      // Método 1: Buscar directamente en el texto visible con regex
      const bodyText = document.body.innerText;
      const compraMatch = bodyText.match(/Compra[:\s]*([\d.]+)/i);
      const ventaMatch = bodyText.match(/Venta[:\s]*([\d.]+)/i);

      if (compraMatch && ventaMatch) {
        const compra = parseFloat(compraMatch[1]);
        const venta = parseFloat(ventaMatch[1]);

        // Validar que las tasas sean razonables
        if (compra > 0 && venta > 0 && compra >= 3.0 && compra <= 4.0 && venta > compra) {
          return {
            name: 'Western Union Peru',
            compra,
            venta,
            timestamp: new Date().toISOString()
          };
        }
      }

      // Método 2 (fallback): Buscar en inputs de la calculadora
      const inputs = document.querySelectorAll('input[type="text"]');
      const numbers = [];

      for (const input of inputs) {
        const value = input.value?.replace(/,/g, '');
        const num = parseFloat(value);
        if (!isNaN(num) && num >= 3.0 && num <= 4.0) {
          numbers.push(num);
        }
      }

      if (numbers.length >= 2) {
        return {
          name: 'Western Union Peru',
          compra: Math.min(numbers[0], numbers[1]),
          venta: Math.max(numbers[0], numbers[1]),
          timestamp: new Date().toISOString()
        };
      }

      return null;
    });

    await page.close();

    if (rate && rate.compra > 0 && rate.venta > 0) {
      console.log('✅ Western Union extraído:', rate);
      return [rate];
    } else {
      console.log('⚠️ No se pudo extraer tasa de Western Union');
      return [];
    }

  } catch (error) {
    console.error('❌ Error scraping Western Union:', error.message);
    return [];
  }
}

// Función principal de scraping con reintentos
async function scrapeExchangeRates(retryCount = 0, maxRetries = 3) {
  const attempt = retryCount + 1;
  console.log(`🔄 Iniciando scraping de tasas de cambio... (Intento ${attempt}/${maxRetries + 1})`);
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: process.env.PUPPETEER_HEADLESS !== 'false',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ],
      timeout: 90000  // Aumentado para Render
    });

    // Sistema de carga progresiva - cada fuente es independiente
    console.log('🌐 Iniciando scraping progresivo de 6 fuentes...');

    const allRates = [];
    const seen = new Set();
    let completedSources = 0;
    const totalSources = 6;

    // Función helper para añadir tasas conforme completan
    const addRateWhenReady = async (sourceName, scrapePromise) => {
      try {
        const rates = await scrapePromise;
        if (rates && rates.length > 0) {
          for (const rate of rates) {
            if (!seen.has(rate.name) && rate.compra > 0 && rate.venta > 0) {
              seen.add(rate.name);
              allRates.push(rate);

              // Actualizar en tiempo real
              exchangeRates = {
                lastUpdate: new Date().toISOString(),
                rates: [...allRates],
                error: null
              };

              console.log(`✅ ${sourceName} añadida - Total ahora: ${allRates.length} casas`);
            }
          }
        }
      } catch (error) {
        console.error(`❌ Error en ${sourceName}:`, error.message);
      } finally {
        completedSources++;
        console.log(`📊 Progreso: ${completedSources}/${totalSources} fuentes completadas`);
      }
    };

    // Helper para añadir timeout a una promesa
    const withTimeout = (promise, timeoutMs, sourceName) => {
      return Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout de ${timeoutMs / 1000}s excedido para ${sourceName}`)), timeoutMs)
        )
      ]);
    };

    // Lanzar todas las fuentes en paralelo de forma independiente
    const scrapePromises = [
      addRateWhenReady('Kambista', scrapeKambista(browser)),
      addRateWhenReady('Tkambio', scrapeTkambio(browser)),
      addRateWhenReady('Tucambista', scrapeTucambista(browser)),
      addRateWhenReady('Rextie', scrapeRextie(browser)),
      addRateWhenReady('Bloomberg', scrapeBloomberg(browser)),
      addRateWhenReady('Western Union', scrapeWesternUnion(browser))
      // addRateWhenReady('SUNAT', withTimeout(scrapeSunat(browser), 45000, 'SUNAT')) // DESHABILITADA: Selenium demora mucho
    ];

    // Esperar un máximo de 30 segundos o hasta que tengamos al menos 2 fuentes
    console.log('⏳ Esperando primeras fuentes (máximo 30 segundos)...');
    const startTime = Date.now();

    while ((Date.now() - startTime) < 30000 && allRates.length < 2) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`📊 Scraping inicial completado: ${allRates.length} casas disponibles`);
    console.log(`⏳ Fuentes restantes continuarán en segundo plano`);

    // Las promesas restantes continuarán ejecutándose en background
    Promise.all(scrapePromises).then(() => {
      console.log(`✅ TODAS las fuentes completadas: ${allRates.length} casas de cambio`);

      // Actualización final
      exchangeRates = {
        lastUpdate: new Date().toISOString(),
        rates: allRates,
        error: allRates.length === 0 ? 'No se obtuvieron tasas de ninguna fuente' : null
      };

      // Guardar en base de datos
      if (allRates.length > 0) {
        db.saveRates(allRates);
      }

      // Cerrar browser DESPUÉS de que todos los scrapers completen
      if (browser) {
        browser.close().catch(e => console.error('Error cerrando browser:', e.message));
      }
    }).catch(error => {
      console.error('❌ Error en scraping en background:', error.message);
      // Cerrar browser incluso si hay error
      if (browser) {
        browser.close().catch(e => console.error('Error cerrando browser:', e.message));
      }
    });

    // Validar que tengamos al menos algunas tasas para continuar
    if (allRates.length === 0) {
      console.error('⚠️ ADVERTENCIA: No se obtuvieron tasas en los primeros 30 segundos');
      console.error('⚠️ El servidor iniciará de todas formas y las tasas se añadirán cuando completen');

      exchangeRates = {
        lastUpdate: new Date().toISOString(),
        rates: [],
        error: 'Esperando tasas de cambio...'
      };
    } else {
      // Guardar las tasas iniciales en base de datos
      db.saveRates(allRates);
    }

    return true;

  } catch (error) {
    console.error(`❌ Error en scraping (Intento ${attempt}/${maxRetries + 1}):`, error.message);

    // Cerrar browser si hay error crítico
    if (browser) {
      browser.close().catch(e => console.error('Error cerrando browser:', e.message));
    }

    // Intentar reintentar si no hemos alcanzado el máximo
    if (retryCount < maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff
      console.log(`⏳ Reintentando en ${delay / 1000} segundos...`);

      await new Promise(resolve => setTimeout(resolve, delay));
      return scrapeExchangeRates(retryCount + 1, maxRetries);
    } else {
      // Guardar error después de agotar reintentos
      exchangeRates.error = `Error después de ${maxRetries + 1} intentos: ${error.message}`;
      console.error(`❌ Scraping fallido después de ${maxRetries + 1} intentos`);
      return false;
    }
  }
  // Nota: El browser se cierra en el Promise.all() después de que todos los scrapers completen
}

// ============================================
// API ENDPOINTS CON SEGURIDAD
// ============================================

// Aplicar rate limiting a todas las rutas /api/*
app.use('/api/', apiLimiter);

// Endpoint público - Obtener tasas actuales
app.get('/api/rates', (req, res) => {
  console.log('🔍 DEBUG API: /api/rates llamado');

  try {
    // SIEMPRE obtener las tasas más recientes de CADA proveedor desde la DB
    const dbRates = db.getLatestRatePerProvider();
    console.log(`📦 Tasas desde DB (sin filtrar): ${dbRates.length} proveedores`);

    // Convertir a formato esperado por el frontend y FILTRAR solo proveedores válidos
    const dbRatesFormatted = dbRates
      .filter(rate => VALID_PROVIDERS.includes(rate.provider_name))
      .map(rate => ({
        name: rate.provider_name,
        compra: rate.buy_rate,
        venta: rate.sell_rate,
        timestamp: rate.timestamp
      }));

    console.log(`📦 Tasas desde DB (filtradas): ${dbRatesFormatted.length} proveedores`);

    // Crear un mapa de proveedores con sus datos más recientes
    const providerMap = new Map();

    // Primero, agregar todos los datos de la DB (backup)
    dbRatesFormatted.forEach(rate => {
      providerMap.set(rate.name, rate);
    });

    // Luego, sobrescribir con datos frescos si existen (también filtrar)
    exchangeRates.rates
      .filter(rate => VALID_PROVIDERS.includes(rate.name))
      .forEach(rate => {
        providerMap.set(rate.name, rate);
      });

    // Convertir el mapa de vuelta a array
    const mergedRates = Array.from(providerMap.values());

    console.log(`✅ Tasas combinadas: ${mergedRates.length} proveedores`);
    console.log(`   - Desde memoria (frescos): ${exchangeRates.rates.filter(r => VALID_PROVIDERS.includes(r.name)).length}`);
    console.log(`   - Desde DB (backup): ${dbRatesFormatted.length}`);
    console.log(`   - Total únicos: ${mergedRates.length}`);

    // Determinar el timestamp más reciente
    const mostRecentTimestamp = mergedRates.reduce((latest, rate) => {
      const rateTime = new Date(rate.timestamp);
      return rateTime > new Date(latest) ? rate.timestamp : latest;
    }, mergedRates[0]?.timestamp || new Date().toISOString());

    res.json({
      lastUpdate: mostRecentTimestamp,
      rates: mergedRates,
      error: null
    });
  } catch (error) {
    console.error('❌ Error en /api/rates:', error);

    // Fallback: devolver lo que hay en memoria (filtrado)
    const filteredRates = exchangeRates.rates.filter(rate => VALID_PROVIDERS.includes(rate.name));
    res.json({
      ...exchangeRates,
      rates: filteredRates
    });
  }
});

// Endpoint protegido - Forzar actualización de tasas
app.get('/api/refresh', strictLimiter, async (req, res) => {
  try {
    // Verificar API key si está configurada
    if (process.env.ADMIN_API_KEY) {
      const apiKey = req.header('X-API-Key');
      if (apiKey !== process.env.ADMIN_API_KEY) {
        return res.status(403).json({
          error: 'No autorizado. Se requiere API key válida.'
        });
      }
    }

    await scrapeExchangeRates();
    res.json({
      message: 'Tasas actualizadas correctamente',
      timestamp: new Date().toISOString(),
      rates: exchangeRates.rates.length
    });
  } catch (error) {
    res.status(500).json({
      error: 'Error al actualizar tasas',
      details: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
});

// Endpoint público - Mejores tasas
app.get('/api/best-rates', (req, res) => {
  try {
    if (exchangeRates.rates.length === 0) {
      return res.json({ error: 'No hay datos disponibles' });
    }

    const bestBuy = exchangeRates.rates.reduce((best, current) =>
      current.compra > best.compra ? current : best
    );

    const bestSell = exchangeRates.rates.reduce((best, current) =>
      current.venta < best.venta ? current : best
    );

    res.json({
      mejorCompra: bestBuy,
      mejorVenta: bestSell,
      lastUpdate: exchangeRates.lastUpdate
    });
  } catch (error) {
    res.status(500).json({
      error: 'Error al obtener mejores tasas',
      details: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
});

// Endpoint con validación - Historial de proveedor
app.get('/api/history/:provider', validateProviderParam, validateQueryParams, (req, res) => {
  try {
    const { provider } = req.params;
    const hours = req.query.hours || 24; // Ya validado por middleware
    const history = db.getProviderHistory(provider, hours);
    res.json({ provider, hours, data: history });
  } catch (error) {
    res.status(500).json({
      error: 'Error al obtener historial',
      details: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
});

// Endpoint con validación - Estadísticas de proveedor
app.get('/api/stats/:provider', validateProviderParam, validateQueryParams, (req, res) => {
  try {
    const { provider } = req.params;
    const days = req.query.days || 7; // Ya validado por middleware
    const stats = db.getProviderStats(provider, days);
    res.json({ provider, days, stats });
  } catch (error) {
    res.status(500).json({
      error: 'Error al obtener estadísticas',
      details: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
});

// Endpoint con validación - Tendencia general
app.get('/api/trend', validateQueryParams, (req, res) => {
  try {
    const hours = req.query.hours || 24; // Ya validado por middleware
    const interval = req.query.interval || 1; // Ya validado por middleware
    const trend = db.getTrend(hours, interval);
    res.json({ hours, interval, data: trend });
  } catch (error) {
    res.status(500).json({
      error: 'Error al obtener tendencia',
      details: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
});

// Obtener lista de todos los proveedores
app.get('/api/providers', (req, res) => {
  try {
    const providers = db.getAllProviders();
    res.json({ providers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener estadísticas de la base de datos
app.get('/api/db-stats', (req, res) => {
  try {
    const stats = db.getDatabaseStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    lastUpdate: exchangeRates.lastUpdate,
    ratesCount: exchangeRates.rates.length,
    hasError: !!exchangeRates.error
  });
});

// Servir el frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// MANEJO GLOBAL DE ERRORES
// ============================================

// 404 - Ruta no encontrada
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint no encontrado',
    path: req.path,
    method: req.method
  });
});

// Manejo de errores de CORS
app.use((err, req, res, next) => {
  if (err.message === 'No permitido por CORS') {
    return res.status(403).json({
      error: 'Acceso no permitido por política CORS',
      origin: req.get('origin')
    });
  }
  next(err);
});

// Manejador global de errores
app.use((err, req, res, next) => {
  console.error('❌ Error no manejado:', err);

  // Determinar código de estado
  const statusCode = err.statusCode || err.status || 500;

  // En producción, no exponer detalles del error
  if (process.env.NODE_ENV === 'production') {
    res.status(statusCode).json({
      error: 'Error interno del servidor',
      timestamp: new Date().toISOString()
    });
  } else {
    // En desarrollo, mostrar detalles completos
    res.status(statusCode).json({
      error: err.message || 'Error interno del servidor',
      stack: err.stack,
      timestamp: new Date().toISOString()
    });
  }
});

// ============================================
// INICIALIZACIÓN DEL SERVIDOR
// ============================================

// Función para asegurar que Chrome está instalado (para Render.com)
async function ensureChromeInstalled() {
  try {
    console.log('🔍 Verificando instalación de Chrome...');
    const { execSync } = require('child_process');
    execSync('npx puppeteer browsers install chrome', {
      stdio: 'inherit',
      timeout: 60000
    });
    console.log('✅ Chrome verificado/instalado correctamente');
  } catch (error) {
    console.log('⚠️  Advertencia al verificar Chrome:', error.message);
    // Continuar de todos modos, Puppeteer podría encontrar Chrome
  }
}

async function startServer() {
  // Asegurar que Chrome está instalado (crítico para Render.com)
  await ensureChromeInstalled();

  console.log('🔄 Haciendo scraping inicial antes de iniciar el servidor...');

  // Hacer scraping inicial ANTES de que el servidor acepte requests
  await scrapeExchangeRates();

  console.log('✅ Scraping inicial completado');

  // Ahora sí, iniciar el servidor
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📊 ${exchangeRates.rates.length} casas de cambio disponibles`);

    // Programar scraping automático
    const interval = process.env.SCRAPE_INTERVAL_MINUTES || 5;
    cron.schedule(`*/${interval} * * * *`, async () => {
      console.log('⏰ Actualización programada de tasas...');
      await scrapeExchangeRates();
    });

    // Programar limpieza de registros antiguos (una vez al día a las 3 AM)
    cron.schedule('0 3 * * *', () => {
      console.log('🧹 Iniciando limpieza de registros antiguos...');
      db.cleanOldRecords(30); // Mantener últimos 30 días
    });

    console.log(`⏰ Scraping automático programado cada ${interval} minutos`);
    console.log('⏰ Limpieza automática programada diariamente a las 3 AM');
  });
}

// Iniciar el servidor
startServer().catch(error => {
  console.error('❌ Error fatal al iniciar el servidor:', error);
  process.exit(1);
});
