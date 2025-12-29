// Estado de la aplicación
let currentRates = [];
let currentSort = 'default';
let calculatorAction = 'buy'; // 'buy' or 'sell'
let lastSuccessfulFetch = null; // Timestamp de la última carga exitosa
let autoRefreshInterval = null; // Intervalo de actualización automática
let isLoadingFresh = false; // Flag para evitar múltiples cargas simultáneas
let timestampUpdateInterval = null; // Intervalo para actualizar timestamps en la UI

// Configuración de caché
const CACHE_KEY = 'coya_exchange_rates';
const CACHE_TIMESTAMP_KEY = 'coya_cache_timestamp';
const CACHE_MAX_AGE = 30 * 60 * 1000; // 30 minutos en milisegundos

// Configuración de reintentos
let retryCount = 0;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [5000, 10000, 30000]; // 5s, 10s, 30s

// Auto-refresh countdown
let nextRefreshTime = null;
const AUTO_REFRESH_INTERVAL_MS = 30 * 1000; // 30 segundos

// Elementos del DOM
const elements = {
    // KPI Elements
    bestBuyRate: document.getElementById('bestBuyRate'),
    bestBuyProvider: document.getElementById('bestBuyProvider'),
    bestSellRate: document.getElementById('bestSellRate'),
    bestSellProvider: document.getElementById('bestSellProvider'),
    savingsValue: document.getElementById('savingsValue'),
    avgSpread: document.getElementById('avgSpread'),

    // Update timestamps
    lastUpdate: document.getElementById('lastUpdate'),
    lastUpdateSidebar: document.getElementById('lastUpdateSidebar'),

    // Calculator Elements
    calcAmount: document.getElementById('calcAmount'),
    calcResult: document.getElementById('calcResult'),
    inputCurrency: document.getElementById('inputCurrency'),
    outputCurrency: document.getElementById('outputCurrency'),
    bestProvider: document.getElementById('bestProvider'),
    appliedRate: document.getElementById('appliedRate'),
    worstProvider: document.getElementById('worstProvider'),
    worstRate: document.getElementById('worstRate'),
    savingsAmount: document.getElementById('savingsAmount'),

    // Table Elements
    loadingState: document.getElementById('loadingState'),
    errorState: document.getElementById('errorState'),
    ratesTable: document.getElementById('ratesTable'),
    tableBody: document.getElementById('tableBody'),
    refreshBtn: document.getElementById('refreshBtn')
};

// ===================================
// SISTEMA DE CACHÉ
// ===================================

// Guardar datos en caché
function saveToCache(rates, timestamp) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(rates));
        localStorage.setItem(CACHE_TIMESTAMP_KEY, timestamp);
    } catch (error) {
        console.warn('No se pudo guardar en caché:', error);
    }
}

// Cargar datos desde caché
function loadFromCache() {
    try {
        const cachedRates = localStorage.getItem(CACHE_KEY);
        const cachedTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);

        if (cachedRates && cachedTimestamp) {
            return {
                rates: JSON.parse(cachedRates),
                timestamp: cachedTimestamp
            };
        }
    } catch (error) {
        console.warn('No se pudo cargar desde caché:', error);
    }
    return null;
}

// Verificar si el caché es válido
function isCacheValid() {
    const cachedTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    if (!cachedTimestamp) return false;

    const cacheAge = Date.now() - new Date(cachedTimestamp).getTime();
    return cacheAge < CACHE_MAX_AGE;
}

// Cargar tasas al iniciar
document.addEventListener('DOMContentLoaded', () => {
    // Cargar inmediatamente desde caché si existe
    const cached = loadFromCache();
    if (cached) {
        console.log('📦 Cargando datos desde caché...');
        currentRates = cached.rates || [];
        updateKPIs(currentRates);
        updateLastUpdate(cached.timestamp);
        renderRatesTable(currentRates);
        calculateExchange();
        updateWidgets(currentRates, cached.timestamp);

        // Actualizar contador de proveedores en el sidebar
        if (typeof window.updateSidebarProviderCount === 'function') {
            window.updateSidebarProviderCount();
        }

        hideLoading();

        // Mostrar indicador de datos en caché si están viejos
        if (!isCacheValid()) {
            showStaleDataWarning();
        }
    }

    // Luego cargar datos frescos
    loadRates();
    setupEventListeners();
    setupNavigation();
    setupSidebar();

    // Establecer tiempo de la próxima actualización
    nextRefreshTime = Date.now() + AUTO_REFRESH_INTERVAL_MS;

    // Auto-refresh cada 30 segundos con protección contra cargas múltiples
    autoRefreshInterval = setInterval(() => {
        if (!isLoadingFresh) {
            console.log('🔄 Auto-refresh programado ejecutándose...');
            showRefreshIndicator();
            loadRates();
            nextRefreshTime = Date.now() + AUTO_REFRESH_INTERVAL_MS;
        }
    }, AUTO_REFRESH_INTERVAL_MS);

    // Actualizar timestamps en la UI cada segundo
    timestampUpdateInterval = setInterval(() => {
        updateAllTimestamps();
        updateRefreshCountdown();
    }, 1000);

    // Actualizar cuando el usuario regresa a la pestaña
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            console.log('👁️ Usuario regresó - Verificando actualización...');

            // Solo recargar si los datos tienen más de 1 minuto
            const cachedTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
            if (cachedTimestamp) {
                const cacheAge = Date.now() - new Date(cachedTimestamp).getTime();
                if (cacheAge > 60 * 1000) { // 1 minuto
                    console.log('🔄 Datos tienen más de 1 minuto, recargando...');
                    loadRates();
                } else {
                    console.log('✅ Datos son recientes, no se necesita recargar');
                }
            }
        }
    });

    // Actualizar cuando vuelve la conexión a internet
    window.addEventListener('online', () => {
        console.log('🌐 Conexión restaurada - Recargando datos...');
        showStaleDataWarning();
        loadRates();
    });

    window.addEventListener('offline', () => {
        console.log('📡 Sin conexión - Usando modo offline con caché');
        showStaleDataWarning();
    });
});

// Configurar navegación del sidebar
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();

            // Actualizar items activos
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Scroll suave a la sección correspondiente
            const targetId = item.getAttribute('href').substring(1);

            if (targetId === 'dashboard') {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } else if (targetId === 'calculator') {
                document.querySelector('.calculator-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else if (targetId === 'rates') {
                document.querySelector('.rates-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else if (targetId === 'historical') {
                document.querySelector('.historical-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}

// Configurar sidebar con funcionalidad de colapsar y widgets dinámicos
function setupSidebar() {
    // 1. Toggle button para colapsar/expandir sidebar
    const toggleBtn = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');

    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');

            // Guardar preferencia en localStorage
            const isCollapsed = sidebar.classList.contains('collapsed');
            localStorage.setItem('sidebarCollapsed', isCollapsed);
        });

        // Restaurar estado desde localStorage
        const savedState = localStorage.getItem('sidebarCollapsed');
        if (savedState === 'true') {
            sidebar.classList.add('collapsed');
        }
    }

    // 2. Actualizar fecha y hora en tiempo real
    function updateTodayWidget() {
        const now = new Date();

        // Actualizar hora (formato 24h con segundos)
        const timeElement = document.getElementById('todayTime');
        if (timeElement) {
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const seconds = String(now.getSeconds()).padStart(2, '0');
            timeElement.textContent = `${hours}:${minutes}:${seconds}`;
        }

        // Actualizar fecha (formato elegante en español)
        const dateElement = document.getElementById('todayDate');
        if (dateElement) {
            const options = { day: 'numeric', month: 'long' };
            const dateStr = now.toLocaleDateString('es-PE', options);
            dateElement.textContent = dateStr;
        }
    }

    // 3. Actualizar contador de proveedores
    function updateProviderCount() {
        const countElement = document.getElementById('providerCount');
        if (countElement && currentRates.length > 0) {
            countElement.textContent = currentRates.length;
        }
    }

    // 4. Formatear tiempo de última actualización en sidebar
    function updateSidebarLastUpdate() {
        const lastUpdateElement = document.getElementById('lastUpdateSidebar');
        if (!lastUpdateElement) return;

        // Este valor ya se actualiza en updateLastUpdate(), solo aseguramos el formato
        const timestamp = lastUpdateElement.getAttribute('data-timestamp');
        if (timestamp) {
            const date = new Date(timestamp);
            const now = new Date();
            const diffMinutes = Math.floor((now - date) / 1000 / 60);

            let updateText;
            if (diffMinutes < 1) {
                updateText = 'hace menos de 1 min';
            } else if (diffMinutes === 1) {
                updateText = 'hace 1 minuto';
            } else if (diffMinutes < 60) {
                updateText = `hace ${diffMinutes} minutos`;
            } else {
                const hours = Math.floor(diffMinutes / 60);
                updateText = `hace ${hours} hora${hours > 1 ? 's' : ''}`;
            }

            lastUpdateElement.textContent = updateText;
        }
    }

    // Inicializar inmediatamente
    updateTodayWidget();
    updateProviderCount();

    // Actualizar reloj cada segundo
    setInterval(updateTodayWidget, 1000);

    // Actualizar contador de proveedores cuando cambien las tasas
    // (se llamará desde loadRates cuando se actualicen los datos)
    window.updateSidebarProviderCount = updateProviderCount;
}

// Configurar event listeners
function setupEventListeners() {
    // Botón de refresh
    elements.refreshBtn.addEventListener('click', async () => {
        elements.refreshBtn.classList.add('loading');
        await loadRates(true);
        elements.refreshBtn.classList.remove('loading');
    });

    // Filtros de ordenamiento
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Actualizar botones activos
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            // Aplicar ordenamiento
            currentSort = e.target.getAttribute('data-sort');
            renderRatesTable(currentRates);
        });
    });

    // Calculator tabs
    document.querySelectorAll('.calc-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const button = e.currentTarget;

            // Actualizar tabs activos
            document.querySelectorAll('.calc-tab').forEach(t => t.classList.remove('active'));
            button.classList.add('active');

            // Cambiar acción
            calculatorAction = button.getAttribute('data-action');

            // Actualizar labels de moneda
            updateCalculatorCurrency();

            // Recalcular
            calculateExchange();
        });
    });

    // Calculator input
    elements.calcAmount.addEventListener('input', () => {
        calculateExchange();
    });

    // CSV Export button
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', () => {
            exportRatesToCSV(currentRates);
        });
    }
}

// Actualizar etiquetas de moneda en la calculadora
function updateCalculatorCurrency() {
    if (calculatorAction === 'buy') {
        // Comprar USD (tengo PEN, quiero USD)
        elements.inputCurrency.textContent = 'PEN';
        elements.outputCurrency.textContent = 'USD';
    } else {
        // Vender USD (tengo USD, quiero PEN)
        elements.inputCurrency.textContent = 'USD';
        elements.outputCurrency.textContent = 'PEN';
    }
}

// Cargar tasas desde la API
async function loadRates(forceRefresh = false) {
    // Evitar cargas múltiples simultáneas
    if (isLoadingFresh && !forceRefresh) {
        console.log('⏭️ Carga ya en progreso, saltando...');
        return;
    }

    isLoadingFresh = true;

    console.log('🔄 Iniciando carga de tasas...', { forceRefresh, currentRatesCount: currentRates.length });

    try {
        // Solo mostrar loading si no hay datos en caché
        if (currentRates.length === 0) {
            console.log('📊 Mostrando loading (sin datos en caché)');
            showLoading();
        } else {
            console.log('✅ Hay datos en caché, cargando en segundo plano');
        }

        const endpoint = forceRefresh ? '/api/refresh' : '/api/rates';
        console.log(`📡 Fetching: ${endpoint}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 segundos timeout

        const response = await fetch(endpoint, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        console.log(`📡 Response status: ${response.status}`);

        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`);
        }

        const data = await response.json();
        console.log(`📊 Data received:`, {
            ratesCount: data.rates?.length,
            lastUpdate: data.lastUpdate,
            error: data.error,
            firstRate: data.rates?.[0]
        });

        if (data.error) {
            throw new Error(data.error);
        }

        const rates = data.rates || [];
        console.log(`✅ Rates parsed: ${rates.length} proveedores`);

        // Si no hay tasas nuevas, usar las del caché
        if (rates.length === 0) {
            console.warn('⚠️ API no devolvió tasas, usando caché...');
            const cached = loadFromCache();
            if (cached && cached.rates.length > 0) {
                currentRates = cached.rates;
                updateLastUpdate(cached.timestamp);
                showStaleDataWarning();
                hideLoading();
                isLoadingFresh = false;
                return;
            } else {
                throw new Error('No se encontraron tasas de cambio');
            }
        }

        // Actualizar con datos frescos
        currentRates = rates;
        lastSuccessfulFetch = new Date().toISOString();

        // Guardar en caché
        saveToCache(currentRates, data.lastUpdate || lastSuccessfulFetch);

        // Actualizar UI
        updateKPIs(currentRates);
        updateLastUpdate(data.lastUpdate || lastSuccessfulFetch);
        renderRatesTable(currentRates);
        calculateExchange();
        updateWidgets(currentRates, data.lastUpdate || lastSuccessfulFetch);

        // Actualizar contador de proveedores en el sidebar
        if (typeof window.updateSidebarProviderCount === 'function') {
            window.updateSidebarProviderCount();
        }

        // Ocultar advertencia de datos viejos si estaba visible
        hideStaleDataWarning();

        hideLoading();

        // Reinicio exitoso del contador de reintentos
        retryCount = 0;

        // Actualizar tiempo de próxima actualización
        nextRefreshTime = Date.now() + AUTO_REFRESH_INTERVAL_MS;

        console.log(`✅ Tasas actualizadas: ${currentRates.length} proveedores`);

    } catch (error) {
        console.error('❌ Error al cargar tasas:', error);

        // Si falla, intentar usar caché
        const cached = loadFromCache();
        if (cached && cached.rates.length > 0) {
            console.log('📦 Usando datos del caché debido a error en API');
            currentRates = cached.rates;

            updateKPIs(currentRates);
            updateLastUpdate(cached.timestamp);
            renderRatesTable(currentRates);
            calculateExchange();
            updateWidgets(currentRates, cached.timestamp);

            if (typeof window.updateSidebarProviderCount === 'function') {
                window.updateSidebarProviderCount();
            }

            showStaleDataWarning();
            hideLoading();

            // Programar reintento si no hemos alcanzado el máximo
            if (retryCount < MAX_RETRIES && !forceRefresh) {
                const delay = RETRY_DELAYS[retryCount] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
                console.log(`⏰ Reintentando en ${delay / 1000}s... (intento ${retryCount + 1}/${MAX_RETRIES})`);

                setTimeout(() => {
                    retryCount++;
                    loadRates();
                }, delay);
            } else {
                retryCount = 0; // Resetear contador
            }
        } else {
            // Solo mostrar error si no hay datos en caché
            showError(error.message);

            // Intentar recargar después de un tiempo
            if (retryCount < MAX_RETRIES && !forceRefresh) {
                const delay = RETRY_DELAYS[retryCount] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
                console.log(`⏰ Reintentando en ${delay / 1000}s... (intento ${retryCount + 1}/${MAX_RETRIES})`);

                setTimeout(() => {
                    retryCount++;
                    loadRates();
                }, delay);
            }
        }
    } finally {
        isLoadingFresh = false;
    }
}

// Actualizar todos los KPIs
function updateKPIs(rates) {
    if (rates.length === 0) return;

    // Encontrar mejor compra (mayor tasa - más PEN por USD)
    const bestBuy = rates.reduce((best, current) =>
        current.compra > best.compra ? current : best
    );

    // Encontrar mejor venta (menor tasa - menos PEN por USD)
    const bestSell = rates.reduce((best, current) =>
        current.venta < best.venta ? current : best
    );

    // Encontrar peor compra y peor venta para calcular ahorro
    const worstBuy = rates.reduce((worst, current) =>
        current.compra < worst.compra ? current : worst
    );

    const worstSell = rates.reduce((worst, current) =>
        current.venta > worst.venta ? current : worst
    );

    // Actualizar KPI Cards
    animateValue(elements.bestBuyRate, bestBuy.compra, 3);
    elements.bestBuyProvider.textContent = bestBuy.name;

    animateValue(elements.bestSellRate, bestSell.venta, 3);
    elements.bestSellProvider.textContent = bestSell.name;

    // Calcular ahorro potencial por USD 1,000 para AMBAS operaciones
    const referenceAmount = 1000;

    // COMPRANDO USD (tienes PEN, quieres USD):
    // Ahorro = cuántos PEN menos pagas con la mejor opción vs la peor
    const costWithBestSell = referenceAmount * bestSell.venta;  // PEN que pagas con mejor opción
    const costWithWorstSell = referenceAmount * worstSell.venta; // PEN que pagas con peor opción
    const savingsBuyingUSD = costWithWorstSell - costWithBestSell; // PEN ahorrados

    // VENDIENDO USD (tienes USD, quieres PEN):
    // Ahorro = cuántos PEN más recibes con la mejor opción vs la peor
    const receivedWithBestBuy = referenceAmount * bestBuy.compra;  // PEN que recibes con mejor opción
    const receivedWithWorstBuy = referenceAmount * worstBuy.compra; // PEN que recibes con peor opción
    const savingsSellingUSD = receivedWithBestBuy - receivedWithWorstBuy; // PEN de diferencia

    // Mostrar el ahorro más relevante (el mayor)
    const maxSavings = Math.max(savingsBuyingUSD, savingsSellingUSD);

    // Actualizar KPI con información de ambas operaciones
    elements.savingsValue.textContent = `S/ ${maxSavings.toFixed(2)}`;

    // Actualizar contexto para mostrar ambas operaciones
    const savingsContext = document.getElementById('savingsContext');
    if (savingsContext) {
        if (savingsBuyingUSD > savingsSellingUSD) {
            savingsContext.innerHTML = `
                <span>Comprando USD 1,000</span>
                <span style="font-size: 0.65rem; color: #666; margin-top: 0.125rem;">Ahorro en PEN</span>
            `;
        } else {
            savingsContext.innerHTML = `
                <span>Vendiendo USD 1,000</span>
                <span style="font-size: 0.65rem; color: #666; margin-top: 0.125rem;">Ahorro en PEN</span>
            `;
        }
    }

    // Calcular spread promedio
    const avgSpreadValue = rates.reduce((sum, rate) => sum + (rate.venta - rate.compra), 0) / rates.length;
    animateValue(elements.avgSpread, avgSpreadValue, 3);
}

// Animar cambio de valor
function animateValue(element, targetValue, decimals = 2) {
    if (!element) return;

    const currentText = element.textContent.replace(/[^\d.-]/g, '');
    const currentValue = parseFloat(currentText) || 0;
    const duration = 800;
    const steps = 30;
    const stepValue = (targetValue - currentValue) / steps;
    const stepDuration = duration / steps;

    let step = 0;

    const interval = setInterval(() => {
        step++;
        const newValue = currentValue + (stepValue * step);
        element.textContent = newValue.toFixed(decimals);

        if (step >= steps) {
            clearInterval(interval);
            element.textContent = targetValue.toFixed(decimals);
        }
    }, stepDuration);
}

// Actualizar timestamp
function updateLastUpdate(timestamp) {
    if (!timestamp) return;

    const date = new Date(timestamp);
    const now = new Date();
    const diffMinutes = Math.floor((now - date) / 1000 / 60);

    let updateText;

    if (diffMinutes < 1) {
        updateText = 'Hace menos de 1 min';
    } else if (diffMinutes === 1) {
        updateText = 'Hace 1 minuto';
    } else if (diffMinutes < 60) {
        updateText = `Hace ${diffMinutes} minutos`;
    } else {
        const hours = Math.floor(diffMinutes / 60);
        updateText = `Hace ${hours} hora${hours > 1 ? 's' : ''}`;
    }

    if (elements.lastUpdate) {
        elements.lastUpdate.textContent = updateText;
    }

    if (elements.lastUpdateSidebar) {
        elements.lastUpdateSidebar.textContent = updateText;
        elements.lastUpdateSidebar.setAttribute('data-timestamp', timestamp);
    }
}

// Calcular conversión en la calculadora
function calculateExchange() {
    if (currentRates.length === 0) return;

    const amount = parseFloat(elements.calcAmount.value) || 0;

    if (amount <= 0) {
        elements.calcResult.value = '0.00';
        elements.bestProvider.textContent = '-';
        elements.appliedRate.textContent = '-';
        elements.worstProvider.textContent = '-';
        elements.worstRate.textContent = '-';
        elements.savingsAmount.textContent = 'S/ 0.00';
        return;
    }

    let result, rate, provider, worstRate, worstProvider, savings;

    if (calculatorAction === 'buy') {
        // COMPRAR USD: Tengo PEN, quiero USD
        // Necesito la mejor VENTA (tasa más baja = más USD por mis PEN)
        const bestOption = currentRates.reduce((best, current) =>
            current.venta < best.venta ? current : best
        );
        const worstOption = currentRates.reduce((worst, current) =>
            current.venta > worst.venta ? current : worst
        );

        rate = bestOption.venta;
        provider = bestOption.name;
        worstRate = worstOption.venta;
        worstProvider = worstOption.name;

        // Resultado: cuántos USD obtengo
        result = amount / rate;

        // AHORRO: Con la misma cantidad de PEN, obtengo más USD en la mejor casa
        // El valor de esos USD extra en PEN es el ahorro
        const usdWithBest = amount / rate;           // USD que obtengo con mejor tasa
        const usdWithWorst = amount / worstRate;     // USD que obtengo con peor tasa
        const usdDifference = usdWithBest - usdWithWorst; // USD extra que obtengo

        // Convertir esa diferencia a PEN usando la tasa promedio entre ambas
        const avgRate = (rate + worstRate) / 2;
        savings = usdDifference * avgRate;

    } else {
        // VENDER USD: Tengo USD, quiero PEN
        // Necesito la mejor COMPRA (tasa más alta = más PEN por mis USD)
        const bestOption = currentRates.reduce((best, current) =>
            current.compra > best.compra ? current : best
        );
        const worstOption = currentRates.reduce((worst, current) =>
            current.compra < worst.compra ? current : worst
        );

        rate = bestOption.compra;
        provider = bestOption.name;
        worstRate = worstOption.compra;
        worstProvider = worstOption.name;

        // Resultado: cuántos PEN obtengo
        result = amount * rate;

        // AHORRO: Cuántos PEN más recibo con la mejor vs la peor tasa
        const penWithBest = amount * rate;
        const penWithWorst = amount * worstRate;
        savings = penWithBest - penWithWorst;
    }

    // Actualizar UI
    elements.calcResult.value = result.toFixed(2);
    elements.bestProvider.textContent = provider;
    elements.appliedRate.textContent = `S/ ${rate.toFixed(3)}`;
    elements.worstProvider.textContent = worstProvider;
    elements.worstRate.textContent = `S/ ${worstRate.toFixed(3)}`;

    // Mostrar ahorro con indicador de positivo
    if (savings > 0) {
        elements.savingsAmount.textContent = `S/ ${savings.toFixed(2)}`;
        elements.savingsAmount.classList.add('success');
    } else {
        elements.savingsAmount.textContent = 'S/ 0.00';
        elements.savingsAmount.classList.remove('success');
    }

    // Actualizar KPI dinámico de ahorro potencial
    updateDynamicSavingsKPI(amount, result, savings, calculatorAction);
}

// Actualizar KPI dinámico de ahorro potencial
function updateDynamicSavingsKPI(inputAmount, outputAmount, savings, action) {
    const savingsValueEl = document.getElementById('savingsValue');
    const savingsContextEl = document.getElementById('savingsContext');
    const savingsKpiEl = document.getElementById('savingsKpi');

    if (!savingsValueEl || !savingsContextEl || !savingsKpiEl) return;

    // Si el monto es válido, actualizar con los valores calculados
    if (inputAmount > 0 && savings > 0) {
        // Animar el valor
        animateValue(savingsValueEl, savings, 2);

        // Actualizar contexto con el monto actual y operación específica
        let contextHTML = '';

        if (action === 'buy') {
            // COMPRANDO USD (tienes PEN, quieres USD)
            // Input: PEN (inputAmount) → Output: USD (outputAmount)
            const amountPEN = inputAmount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const amountUSD = outputAmount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            contextHTML = `
                <div style="display: flex; flex-direction: column; gap: 0.125rem;">
                    <span style="color: #ffffff; font-weight: 500;">Comprando USD ${amountUSD}</span>
                    <span style="font-size: 0.65rem; color: #a0a0a0;">Con S/ ${amountPEN}</span>
                    <span style="font-size: 0.625rem; color: #666;">Ahorro en PEN</span>
                </div>
            `;
        } else {
            // VENDIENDO USD (tienes USD, quieres PEN)
            // Input: USD (inputAmount) → Output: PEN (outputAmount)
            const amountUSD = inputAmount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const amountPEN = outputAmount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            contextHTML = `
                <div style="display: flex; flex-direction: column; gap: 0.125rem;">
                    <span style="color: #ffffff; font-weight: 500;">Vendiendo USD ${amountUSD}</span>
                    <span style="font-size: 0.65rem; color: #a0a0a0;">Por S/ ${amountPEN}</span>
                    <span style="font-size: 0.625rem; color: #666;">Ahorro en PEN</span>
                </div>
            `;
        }

        savingsContextEl.innerHTML = contextHTML;

        // Añadir clase de activo para efecto visual
        savingsKpiEl.classList.add('kpi-active');
    } else {
        // Volver a valores por defecto calculados en updateKPIs
        savingsKpiEl.classList.remove('kpi-active');
        // No resetear aquí - dejar que updateKPIs maneje el valor por defecto
    }
}

// Renderizar tabla de tasas
function renderRatesTable(rates) {
    if (rates.length === 0) return;

    // Actualizar contador de proveedores inmediatamente
    const providerCountBadge = document.getElementById('providerCountBadge');
    if (providerCountBadge) {
        providerCountBadge.textContent = rates.length;
        // Trigger animation
        providerCountBadge.style.animation = 'none';
        setTimeout(() => {
            providerCountBadge.style.animation = '';
        }, 10);
    }

    // Ordenar según el filtro activo
    let sortedRates = [...rates];

    switch (currentSort) {
        case 'buy':
            sortedRates.sort((a, b) => b.compra - a.compra);
            break;
        case 'sell':
            sortedRates.sort((a, b) => a.venta - b.venta);
            break;
        default:
            // Mantener orden original
            break;
    }

    // Limpiar tabla
    elements.tableBody.innerHTML = '';

    // Encontrar mejores tasas
    const bestBuyRate = Math.max(...rates.map(r => r.compra));
    const bestSellRate = Math.min(...rates.map(r => r.venta));

    // Generar filas
    const now = new Date();

    sortedRates.forEach((rate, index) => {
        const spread = (rate.venta - rate.compra).toFixed(3);
        const isBestBuy = rate.compra === bestBuyRate;
        const isBestSell = rate.venta === bestSellRate;

        // Calcular costo vs mejor opción (por USD 1,000)
        const referenceAmount = 1000;

        // Para vender USD (tienes USD, quieres PEN): pérdida por tasa de compra más baja
        const costVsBestBuy = (bestBuyRate - rate.compra) * referenceAmount;

        // Para comprar USD (tienes PEN, quieres USD): costo extra por tasa de venta más alta
        const costVsBestSell = (rate.venta - bestSellRate) * referenceAmount;

        // Usar el peor de los dos como indicador general
        const totalCost = Math.max(costVsBestBuy, costVsBestSell);

        // Formatear costo
        let costDisplay = '';
        if (totalCost < 0.01) {
            costDisplay = '<span class="cost-best">MEJOR</span>';
        } else if (totalCost < 5) {
            costDisplay = `<span class="cost-low">+S/ ${totalCost.toFixed(2)}</span>`;
        } else if (totalCost < 15) {
            costDisplay = `<span class="cost-medium">+S/ ${totalCost.toFixed(2)}</span>`;
        } else {
            costDisplay = `<span class="cost-high">+S/ ${totalCost.toFixed(2)}</span>`;
        }

        // Formatear timestamp usando función centralizada
        const timeAgo = formatTimeAgo(new Date(rate.timestamp));

        const row = document.createElement('tr');
        row.style.animationDelay = `${index * 0.05}s`;

        // Agregar clase especial si es la mejor opción
        if (isBestBuy || isBestSell) {
            row.classList.add('best-rate-row');
        }

        // Determinar badge
        let badge = '';
        if (isBestBuy && isBestSell) {
            badge = '<span class="rate-badge badge-both">Mejor Ambas</span>';
        } else if (isBestBuy) {
            badge = '<span class="rate-badge badge-buy">Mejor Compra</span>';
        } else if (isBestSell) {
            badge = '<span class="rate-badge badge-sell">Mejor Venta</span>';
        }

        // Determinar si los datos son antiguos (> 15 minutos)
        const rateAge = Math.floor((now - new Date(rate.timestamp)) / 1000 / 60);
        const isStaleData = rateAge > 15;
        const staleClass = isStaleData ? 'stale-data-row' : '';

        row.innerHTML = `
            <td>
                <div class="provider-cell">
                    <span class="provider-name">${rate.name}</span>
                    ${badge}
                    ${isStaleData ? '<span class="backup-indicator" title="Datos del backup">📦</span>' : ''}
                </div>
            </td>
            <td class="rate-cell ${isBestBuy ? 'best-rate' : ''}">
                <span class="rate-value">S/ ${rate.compra.toFixed(3)}</span>
            </td>
            <td class="rate-cell ${isBestSell ? 'best-rate' : ''}">
                <span class="rate-value">S/ ${rate.venta.toFixed(3)}</span>
            </td>
            <td>
                <span class="spread-value">${spread}</span>
            </td>
            <td class="cost-comparison">
                ${costDisplay}
                <span class="cost-reference">por USD 1,000</span>
            </td>
            <td>
                <span class="timestamp-value ${isStaleData ? 'timestamp-stale' : ''}">${timeAgo}</span>
            </td>
        `;

        // Agregar clase de datos antiguos a la fila
        if (isStaleData) {
            row.classList.add(staleClass);
        }

        elements.tableBody.appendChild(row);
    });
}

// Mostrar indicador de actualización
function showRefreshIndicator() {
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.classList.add('refreshing');
        setTimeout(() => {
            refreshBtn.classList.remove('refreshing');
        }, 1000);
    }
}

// Actualizar todos los timestamps en la UI
function updateAllTimestamps() {
    // Actualizar timestamps en la tabla
    const rows = document.querySelectorAll('#tableBody tr');
    rows.forEach((row, index) => {
        if (currentRates[index]) {
            const timestampCell = row.querySelector('.timestamp-value');
            if (timestampCell) {
                const timeAgo = formatTimeAgo(new Date(currentRates[index].timestamp));
                timestampCell.textContent = timeAgo;
            }
        }
    });

    // Actualizar contador de proveedores
    const providerCountBadge = document.getElementById('providerCountBadge');
    if (providerCountBadge && currentRates.length > 0) {
        providerCountBadge.textContent = currentRates.length;
    }

    // Actualizar timestamp general en el subtitle de la tabla
    const cachedTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    if (cachedTimestamp) {
        updateLastUpdate(cachedTimestamp);

        // También actualizar en el subtitle de la tabla
        const tableSubtitle = document.getElementById('tableSubtitle');
        if (tableSubtitle) {
            const timeAgo = formatTimeAgo(new Date(cachedTimestamp));
            tableSubtitle.innerHTML = `Compara todas las opciones disponibles <span style="color: #666; font-size: 0.7rem; margin-left: 0.5rem;">● Actualizado ${timeAgo}</span>`;
        }
    }
}

// Actualizar countdown de próxima actualización
function updateRefreshCountdown() {
    if (!nextRefreshTime) return;

    const timeUntilRefresh = Math.max(0, Math.floor((nextRefreshTime - Date.now()) / 1000));

    // Actualizar indicador en el subtitle
    const subtitle = document.querySelector('.page-subtitle');
    if (subtitle && timeUntilRefresh > 0) {
        const originalText = 'Tasas de cambio en tiempo real';
        subtitle.innerHTML = `${originalText} <span style="color: #60a5fa; font-size: 0.7rem; margin-left: 0.5rem;">● Actualiza en ${timeUntilRefresh}s</span>`;
    } else if (subtitle && timeUntilRefresh === 0) {
        subtitle.innerHTML = `Tasas de cambio en tiempo real <span style="color: #22c55e; font-size: 0.7rem; margin-left: 0.5rem;">● Actualizando...</span>`;
    }
}

// Formatear tiempo transcurrido
function formatTimeAgo(date) {
    const now = new Date();
    const diffSecs = Math.floor((now - date) / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);

    if (diffSecs < 60) {
        return `Hace ${diffSecs} seg`;
    } else if (diffMins < 60) {
        return `Hace ${diffMins} min`;
    } else if (diffHours < 24) {
        return `Hace ${diffHours} hora${diffHours > 1 ? 's' : ''}`;
    } else {
        return date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    }
}

// Mostrar advertencia de datos desactualizados
function showStaleDataWarning() {
    // Agregar indicador visual en el top bar
    const topBar = document.querySelector('.top-bar');
    if (topBar && !document.getElementById('staleDataWarning')) {
        const warning = document.createElement('div');
        warning.id = 'staleDataWarning';
        warning.className = 'stale-data-warning';
        warning.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <span>Mostrando datos en caché - Actualizando en segundo plano...</span>
        `;
        topBar.parentNode.insertBefore(warning, topBar.nextSibling);
    }
}

// Ocultar advertencia de datos desactualizados
function hideStaleDataWarning() {
    const warning = document.getElementById('staleDataWarning');
    if (warning) {
        warning.remove();
    }
}

// Mostrar loading
function showLoading() {
    elements.loadingState.style.display = 'block';
    elements.errorState.style.display = 'none';
    elements.ratesTable.style.display = 'none';
}

// Ocultar loading
function hideLoading() {
    elements.loadingState.style.display = 'none';
    elements.errorState.style.display = 'none';
    elements.ratesTable.style.display = 'block';
}

// Mostrar error
function showError(message) {
    elements.loadingState.style.display = 'none';
    elements.errorState.style.display = 'block';
    elements.ratesTable.style.display = 'none';

    const errorMessage = elements.errorState.querySelector('p');
    if (errorMessage) {
        errorMessage.textContent = message || 'Error al cargar las tasas de cambio';
    }
}

// ============================================
// HISTORICAL CHART & STATISTICS
// ============================================

let ratesChart = null;
let currentPeriod = 24; // hours
let currentView = 'both'; // 'both', 'buy', 'sell'
let currentChartType = 'line'; // 'line', 'area'
let chartData = {}; // Store raw data for filtering

// Corporate Color Palette - Sophisticated & Professional
const CORPORATE_COLORS = {
    // Primary Brand Colors
    'Kambista': {
        primary: '#667eea',
        gradient: ['#667eea', '#764ba2'],
        light: 'rgba(102, 126, 234, 0.2)'
    },
    'Rextie': {
        primary: '#10b981',
        gradient: ['#10b981', '#059669'],
        light: 'rgba(16, 185, 129, 0.2)'
    },
    'Tkambio': {
        primary: '#f59e0b',
        gradient: ['#f59e0b', '#d97706'],
        light: 'rgba(245, 158, 11, 0.2)'
    },
    'Tucambista': {
        primary: '#ef4444',
        gradient: ['#ef4444', '#dc2626'],
        light: 'rgba(239, 68, 68, 0.2)'
    },
    'Bloomberg Línea (Spot)': {
        primary: '#8b5cf6',
        gradient: ['#8b5cf6', '#7c3aed'],
        light: 'rgba(139, 92, 246, 0.2)'
    },
    'Western Union Peru': {
        primary: '#3b82f6',
        gradient: ['#3b82f6', '#2563eb'],
        light: 'rgba(59, 130, 246, 0.2)'
    },
    'SUNAT': {
        primary: '#ec4899',
        gradient: ['#ec4899', '#db2777'],
        light: 'rgba(236, 72, 153, 0.2)'
    }
};

// Get color for provider
function getProviderColor(provider, type = 'primary') {
    const colors = CORPORATE_COLORS[provider];
    if (!colors) return type === 'light' ? 'rgba(148, 163, 184, 0.2)' : '#94a3b8';
    return colors[type];
}

// Inicializar gráfico histórico con configuración estilo Power BI
async function initHistoricalChart() {
    const ctx = document.getElementById('ratesChart');
    if (!ctx) {
        console.error('Canvas element not found');
        return;
    }

    console.log('Initializing historical chart with Power BI styling...');

    // Show loading
    showChartLoading();

    // Create gradient background plugin (Power BI style)
    const gradientBgPlugin = {
        id: 'gradientBg',
        beforeDraw: (chart) => {
            const ctx = chart.ctx;
            const chartArea = chart.chartArea;

            // Create subtle gradient background like Power BI
            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, 'rgba(102, 126, 234, 0.02)');
            gradient.addColorStop(0.5, 'rgba(102, 126, 234, 0.00)');
            gradient.addColorStop(1, 'rgba(139, 92, 246, 0.02)');

            ctx.fillStyle = gradient;
            ctx.fillRect(chartArea.left, chartArea.top,
                        chartArea.right - chartArea.left,
                        chartArea.bottom - chartArea.top);
        }
    };

    // Custom HTML Legend Plugin (Power BI style)
    const htmlLegendPlugin = {
        id: 'htmlLegend',
        afterUpdate(chart, args, options) {
            console.log('🎨 HTML Legend Plugin ejecutándose...', options);
            const ul = getOrCreateLegendList(chart, options.containerID);
            console.log('📋 UL container:', ul);

            // Remove old legend items
            while (ul.firstChild) {
                ul.firstChild.remove();
            }

            // Generate new legend items
            const items = chart.options.plugins.legend.labels.generateLabels(chart);
            console.log('🏷️ Legend items generados:', items.length);

            items.forEach(item => {
                const li = document.createElement('li');
                li.className = 'chartjs-legend-item';
                if (item.hidden) {
                    li.classList.add('hidden');
                }

                li.onclick = () => {
                    const { type } = chart.config;
                    if (type === 'pie' || type === 'doughnut') {
                        chart.toggleDataVisibility(item.index);
                    } else {
                        chart.setDatasetVisibility(item.index, !chart.isDatasetVisible(item.index));
                    }
                    chart.update('active');
                };

                // Color box with proper color
                const boxSpan = document.createElement('span');
                boxSpan.className = 'chartjs-legend-color-box';

                // Extract solid color - need to get from dataset directly
                const dataset = chart.data.datasets[item.index];
                let color = '#94a3b8'; // fallback color

                // Try to extract color from dataset
                if (dataset) {
                    // Get the primary color from CORPORATE_COLORS
                    // Remove both "(Compra)" and "(Venta)" if present, then trim all whitespace
                    let providerName = dataset.label
                        .replace(/\s*\(Compra\)\s*/gi, '')
                        .replace(/\s*\(Venta\)\s*/gi, '')
                        .trim();

                    // Try exact match first
                    let providerColors = CORPORATE_COLORS[providerName];

                    // If not found, try to find a partial match (case-insensitive)
                    if (!providerColors) {
                        const lowerProviderName = providerName.toLowerCase();
                        for (const [key, value] of Object.entries(CORPORATE_COLORS)) {
                            const lowerKey = key.toLowerCase();
                            if (lowerProviderName.includes(lowerKey) || lowerKey.includes(lowerProviderName)) {
                                providerColors = value;
                                break;
                            }
                        }
                    }

                    if (providerColors) {
                        color = providerColors.primary;
                    }
                }

                boxSpan.style.backgroundColor = color;
                boxSpan.style.boxShadow = `0 0 8px ${color}`;

                // Text with visual indicator
                const textContainer = document.createElement('span');
                textContainer.className = 'chartjs-legend-text';
                textContainer.style.color = item.fontColor || '#e2e8f0';
                textContainer.style.textDecoration = item.hidden ? 'line-through' : '';

                // Add visual indicator for buy/sell
                let displayText = item.text;
                if (item.text.includes('(Compra)')) {
                    displayText = item.text.replace('(Compra)', '↑');
                    textContainer.classList.add('buy-indicator');
                } else if (item.text.includes('(Venta)')) {
                    displayText = item.text.replace('(Venta)', '↓');
                    textContainer.classList.add('sell-indicator');
                }

                const text = document.createTextNode(displayText);
                textContainer.appendChild(text);

                li.appendChild(boxSpan);
                li.appendChild(textContainer);
                ul.appendChild(li);
            });
        }
    };

    function getOrCreateLegendList(chart, id) {
        const legendContainer = document.getElementById(id);
        if (!legendContainer) {
            console.warn('Legend container not found:', id);
            return document.createElement('ul'); // Return empty ul to prevent errors
        }

        let listContainer = legendContainer.querySelector('ul');

        if (!listContainer) {
            listContainer = document.createElement('ul');
            listContainer.className = 'chartjs-legend';
            legendContainer.appendChild(listContainer);
        }

        return listContainer;
    }

    // Configuración profesional estilo Power BI
    ratesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: []
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            animation: {
                duration: 750,
                easing: 'easeInOutQuart'
            },
            plugins: {
                legend: {
                    display: false, // Disable default legend, use HTML legend instead
                    labels: {
                        generateLabels: function(chart) {
                            const datasets = chart.data.datasets;
                            return datasets.map((dataset, i) => {
                                const isHidden = !chart.isDatasetVisible(i);
                                return {
                                    text: dataset.label,
                                    fillStyle: isHidden ? 'rgba(148, 163, 184, 0.3)' : dataset.borderColor,
                                    strokeStyle: isHidden ? 'rgba(148, 163, 184, 0.3)' : dataset.borderColor,
                                    lineWidth: 2,
                                    hidden: isHidden,
                                    index: i,
                                    fontColor: isHidden ? '#64748b' : '#e2e8f0'
                                };
                            });
                        }
                    }
                },
                htmlLegend: {
                    containerID: 'chartLegendContainer'
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(15, 23, 42, 0.97)',
                    titleColor: '#f1f5f9',
                    bodyColor: '#e2e8f0',
                    borderColor: 'rgba(102, 126, 234, 0.5)',
                    borderWidth: 1.5,
                    padding: 18,
                    displayColors: true,
                    boxWidth: 14,
                    boxHeight: 14,
                    boxPadding: 6,
                    usePointStyle: true,
                    cornerRadius: 8,
                    titleFont: {
                        size: 13,
                        weight: '700',
                        family: 'Inter, system-ui'
                    },
                    bodyFont: {
                        size: 12,
                        weight: '500',
                        family: 'Roboto Mono, monospace',
                        lineHeight: 1.8
                    },
                    footerFont: {
                        size: 10,
                        weight: '400',
                        family: 'Inter, system-ui'
                    },
                    multiKeyBackground: 'transparent',
                    callbacks: {
                        title: function(tooltipItems) {
                            const date = new Date(tooltipItems[0].parsed.x);
                            return date.toLocaleString('es-PE', {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                            });
                        },
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            const value = context.parsed.y;
                            label += 'S/ ' + value.toFixed(4);

                            return label;
                        },
                        afterLabel: function(context) {
                            // Show trend indicator
                            const dataset = context.dataset;
                            const dataIndex = context.dataIndex;

                            if (dataIndex > 0) {
                                const currentValue = dataset.data[dataIndex].y;
                                const previousValue = dataset.data[dataIndex - 1].y;
                                const change = currentValue - previousValue;
                                const changePercent = (change / previousValue * 100).toFixed(3);

                                if (change > 0) {
                                    return `↑ +${changePercent}% vs anterior`;
                                } else if (change < 0) {
                                    return `↓ ${changePercent}% vs anterior`;
                                } else {
                                    return '→ Sin cambio';
                                }
                            }
                            return '';
                        },
                        footer: function(tooltipItems) {
                            // Add summary footer like Power BI
                            if (tooltipItems.length > 1) {
                                const values = tooltipItems.map(item => item.parsed.y);
                                const avg = values.reduce((a, b) => a + b, 0) / values.length;
                                const min = Math.min(...values);
                                const max = Math.max(...values);

                                return [
                                    '',
                                    `Promedio: S/ ${avg.toFixed(4)}`,
                                    `Rango: ${min.toFixed(4)} - ${max.toFixed(4)}`
                                ];
                            }
                            return '';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    // Agregar padding para evitar que las líneas se peguen a los bordes
                    grace: '5%',
                    grid: {
                        color: function(context) {
                            // Zebra striping like Power BI
                            if (context.tick.value % 0.01 === 0) {
                                return 'rgba(148, 163, 184, 0.12)';
                            }
                            return 'rgba(148, 163, 184, 0.04)';
                        },
                        drawBorder: false,
                        lineWidth: 1,
                        drawTicks: false
                    },
                    border: {
                        display: false,
                        dash: [3, 3]
                    },
                    ticks: {
                        color: '#94a3b8',
                        font: {
                            size: 11,
                            family: 'Roboto Mono, monospace',
                            weight: '500'
                        },
                        padding: 12,
                        maxTicksLimit: 10,
                        // Mejor espaciado entre ticks
                        autoSkip: true,
                        autoSkipPadding: 15,
                        callback: function(value) {
                            return 'S/ ' + value.toFixed(3);
                        }
                    },
                    // Offset para separar del borde
                    offset: true
                },
                x: {
                    type: 'time',
                    time: {
                        unit: 'hour',
                        displayFormats: {
                            hour: 'HH:mm',
                            day: 'dd MMM'
                        },
                        tooltipFormat: 'PPpp'
                    },
                    grid: {
                        color: 'rgba(148, 163, 184, 0.06)',
                        drawBorder: false,
                        lineWidth: 1,
                        drawTicks: false
                    },
                    border: {
                        display: false
                    },
                    ticks: {
                        color: '#94a3b8',
                        font: {
                            size: 11,
                            family: 'Inter, system-ui',
                            weight: '500'
                        },
                        padding: 12,
                        maxRotation: 0,
                        autoSkip: true,
                        autoSkipPadding: 30,
                        maxTicksLimit: 10
                    }
                }
            },
            elements: {
                point: {
                    radius: 0,
                    hitRadius: 12,
                    hoverRadius: 8,
                    hoverBorderWidth: 3,
                    hoverBackgroundColor: '#ffffff',
                    hoverBorderColor: function(context) {
                        return context.dataset.borderColor;
                    }
                },
                line: {
                    borderWidth: 3,
                    tension: 0.35,
                    borderCapStyle: 'round',
                    borderJoinStyle: 'round',
                    // Sombra sutil para separación visual
                    shadowOffsetX: 0,
                    shadowOffsetY: 1,
                    shadowBlur: 3,
                    shadowColor: 'rgba(0, 0, 0, 0.15)',
                    // Evitar superposición con stepped
                    stepped: false,
                    // Mejor antialiasing
                    borderSkipped: false
                }
            },
            // Configuración de layout para mejor espaciado
            layout: {
                padding: {
                    left: 10,
                    right: 10,
                    top: 10,
                    bottom: 10
                }
            }
        },
        plugins: [gradientBgPlugin, htmlLegendPlugin]
    });

    // Cargar datos iniciales
    await loadHistoricalData(currentPeriod);

    // Hide loading
    hideChartLoading();
}

// Loading states
function showChartLoading() {
    const loading = document.getElementById('chartLoading');
    const container = document.getElementById('chartContainer');
    if (loading) loading.style.display = 'flex';
    if (container) container.style.display = 'none';
}

function hideChartLoading() {
    const loading = document.getElementById('chartLoading');
    const container = document.getElementById('chartContainer');
    if (loading) loading.style.display = 'none';
    if (container) container.style.display = 'block';
}

// Cargar datos históricos refactorizado con nueva paleta
async function loadHistoricalData(hours) {
    console.log(`Loading historical data for ${hours} hours...`);

    // Update subtitle with clear description
    const subtitle = document.getElementById('historySubtitle');
    if (subtitle) {
        const timeDescription = hours === 24 ? 'últimas 24 horas' :
                               hours === 72 ? 'últimos 3 días' :
                               hours === 168 ? 'últimos 7 días' :
                               `últimas ${hours} horas`;
        subtitle.textContent = `Tasas históricas reales de ${timeDescription} • ↑ Compra (línea sólida) • ↓ Venta (línea punteada)`;
    }

    try {
        showChartLoading();

        console.log('Fetching providers...');
        const providersResponse = await fetch('/api/providers');
        if (!providersResponse.ok) {
            throw new Error(`Failed to fetch providers: ${providersResponse.status}`);
        }

        const providers = await providersResponse.json();
        console.log('Providers fetched:', providers);

        // Filtrar solo proveedores principales
        const mainProviders = providers.providers.filter(p =>
            ['Kambista', 'Rextie', 'Tkambio', 'Tucambista', 'Bloomberg Línea (Spot)', 'Western Union Peru', 'SUNAT'].includes(p)
        );

        console.log('Main providers:', mainProviders);

        // Cargar datos de todos los proveedores
        const providersData = {};
        for (const provider of mainProviders) {
            console.log(`Fetching history for ${provider}...`);
            try {
                const response = await fetch(`/api/history/${encodeURIComponent(provider)}?hours=${hours}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.data && data.data.length > 0) {
                        providersData[provider] = data.data;
                        console.log(`✓ ${provider}: ${data.data.length} records`);
                    }
                }
            } catch (err) {
                console.warn(`Failed to fetch ${provider}:`, err);
            }
        }

        console.log('All providers data loaded:', Object.keys(providersData));

        // Guardar data cruda para filtrado
        chartData = providersData;

        // Generar datasets según vista actual
        console.log('Updating chart datasets...');
        updateChartDatasets(providersData);

        // Actualizar resumen de estadísticas
        console.log('Updating summary stats...');
        updateSummaryStats(providersData, hours);

        // Cargar estadísticas de proveedores
        console.log('Loading provider stats...');
        await loadProviderStats(mainProviders, hours);

        console.log('Historical data loaded successfully');
        hideChartLoading();

    } catch (error) {
        console.error('Error loading historical data:', error);
        hideChartLoading();

        // Mostrar error al usuario
        const container = document.getElementById('chartContainer');
        if (container) {
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #ef4444;">
                    <p style="font-size: 1.2rem; margin-bottom: 1rem;">Error al cargar datos históricos</p>
                    <p style="color: #94a3b8; font-size: 0.9rem;">${error.message}</p>
                    <button onclick="location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer;">
                        Recargar página
                    </button>
                </div>
            `;
        }
    }
}

// Actualizar datasets del gráfico según vista y tipo con gradientes estilo Power BI
function updateChartDatasets(providersData) {
    const datasets = [];
    const canvas = document.getElementById('ratesChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const providers = Object.keys(providersData);
    const totalDatasets = currentView === 'both' ? providers.length * 2 : providers.length;

    // Ajustar opacidad y grosor según cantidad de líneas
    const baseOpacity = totalDatasets > 8 ? 0.85 : 0.95;
    const baseWidth = totalDatasets > 8 ? 2.5 : 3;

    let datasetIndex = 0;

    for (const [provider, data] of Object.entries(providersData)) {
        const colors = CORPORATE_COLORS[provider];
        const primaryColor = getProviderColor(provider, 'primary');
        const lightColor = getProviderColor(provider, 'light');

        // Create gradient for line if colors exist with opacity
        let lineGradient = primaryColor;
        if (colors && colors.gradient) {
            lineGradient = ctx.createLinearGradient(0, 0, 0, 400);
            // Agregar alpha channel para mejor visibilidad
            const color0 = colors.gradient[0] + Math.round(baseOpacity * 255).toString(16).padStart(2, '0');
            const color1 = colors.gradient[1] + Math.round(baseOpacity * 255).toString(16).padStart(2, '0');
            lineGradient.addColorStop(0, color0);
            lineGradient.addColorStop(1, color1);
        }

        // Create gradient for area fill (Power BI style)
        let areaGradient = 'transparent';
        if (currentChartType === 'area' && colors) {
            areaGradient = ctx.createLinearGradient(0, 0, 0, 400);
            areaGradient.addColorStop(0, colors.light);
            areaGradient.addColorStop(0.5, `rgba(${hexToRgb(colors.primary)}, 0.03)`);
            areaGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        }

        // Configuración base del dataset con estilo Power BI
        const baseConfig = {
            borderColor: lineGradient,
            backgroundColor: areaGradient,
            borderWidth: baseWidth,
            fill: currentChartType === 'area',
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 8,
            pointHoverBorderWidth: 3,
            pointHoverBackgroundColor: '#ffffff',
            pointHoverBorderColor: primaryColor,
            pointBackgroundColor: '#ffffff',
            pointBorderColor: primaryColor,
            spanGaps: true,
            segment: {
                borderColor: function(ctx) {
                    return lineGradient;
                }
            }
        };

        // Añadir dataset de compra si corresponde
        if (currentView === 'both' || currentView === 'buy') {
            datasets.push({
                ...baseConfig,
                label: currentView === 'both' ? `${provider} (Compra)` : provider,
                data: data.map(d => ({
                    x: new Date(d.timestamp),
                    y: d.buy_rate
                })),
                borderDash: [],
                // Usar z-index alternado para evitar superposición total
                order: datasetIndex,
                yAxisID: 'y'
            });
            datasetIndex++;
        }

        // Añadir dataset de venta si corresponde
        if (currentView === 'both' || currentView === 'sell') {
            datasets.push({
                ...baseConfig,
                label: currentView === 'both' ? `${provider} (Venta)` : provider,
                data: data.map(d => ({
                    x: new Date(d.timestamp),
                    y: d.sell_rate
                })),
                // Líneas punteadas para venta cuando se muestran ambas
                borderDash: currentView === 'both' ? [8, 4] : [],
                borderWidth: currentView === 'both' ? baseWidth - 0.5 : baseWidth,
                // Usar z-index alternado
                order: datasetIndex,
                yAxisID: 'y'
            });
            datasetIndex++;
        }
    }

    // Actualizar gráfico con animación suave
    if (ratesChart && datasets.length > 0) {
        ratesChart.data.datasets = datasets;
        ratesChart.update('active'); // Animación suave como Power BI
    }
}

// Helper function to convert hex to rgb
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
        : '148, 163, 184';
}

// Actualizar barra de estadísticas resumen
function updateSummaryStats(providersData, hours) {
    const container = document.getElementById('summaryStats');
    if (!container) return;

    let allBuyRates = [];
    let allSellRates = [];
    let totalRecords = 0;

    for (const data of Object.values(providersData)) {
        allBuyRates.push(...data.map(d => d.buy_rate));
        allSellRates.push(...data.map(d => d.sell_rate));
        totalRecords += data.length;
    }

    if (allBuyRates.length === 0) {
        container.innerHTML = '<p style="color: #94a3b8;">No hay datos suficientes</p>';
        return;
    }

    const avgBuy = allBuyRates.reduce((a, b) => a + b, 0) / allBuyRates.length;
    const avgSell = allSellRates.reduce((a, b) => a + b, 0) / allSellRates.length;
    const minBuy = Math.min(...allBuyRates);
    const maxBuy = Math.max(...allBuyRates);
    const volatility = ((maxBuy - minBuy) / avgBuy * 100).toFixed(2);

    container.innerHTML = `
        <div class="summary-stat-item">
            <span class="summary-stat-label">Promedio Compra</span>
            <span class="summary-stat-value">S/ ${avgBuy.toFixed(3)}</span>
        </div>
        <div class="summary-stat-item">
            <span class="summary-stat-label">Promedio Venta</span>
            <span class="summary-stat-value">S/ ${avgSell.toFixed(3)}</span>
        </div>
        <div class="summary-stat-item">
            <span class="summary-stat-label">Rango (Min-Max)</span>
            <span class="summary-stat-value">${minBuy.toFixed(3)} - ${maxBuy.toFixed(3)}</span>
        </div>
        <div class="summary-stat-item">
            <span class="summary-stat-label">Volatilidad</span>
            <span class="summary-stat-value ${volatility > 1 ? 'negative' : 'positive'}">${volatility}%</span>
            <span class="summary-stat-change">Últimas ${hours}h</span>
        </div>
        <div class="summary-stat-item">
            <span class="summary-stat-label">Total Registros</span>
            <span class="summary-stat-value">${totalRecords.toLocaleString()}</span>
        </div>
    `;
}

// Cargar estadísticas de proveedores
async function loadProviderStats(providers, hours) {
    const container = document.getElementById('providerStats');
    if (!container) return;

    container.innerHTML = '';

    for (const provider of providers) {
        try {
            const days = Math.ceil(hours / 24);
            const stats = await fetch(`/api/stats/${encodeURIComponent(provider)}?days=${days}`)
                .then(r => r.json());

            if (stats.stats && stats.stats.total_records > 0) {
                const card = createProviderStatCard(provider, stats.stats, hours);
                container.appendChild(card);
            }
        } catch (error) {
            console.error(`Error loading stats for ${provider}:`, error);
        }
    }
}

// Crear tarjeta de estadísticas de proveedor
function createProviderStatCard(provider, stats, hours) {
    const card = document.createElement('div');
    card.className = 'provider-stat-card';

    // Determinar si es la mejor opción
    const avgSpread = stats.avg_spread;
    const isBest = avgSpread && avgSpread < 0.01; // Spread menor a 1 centavo

    // Calcular cambio en 24h (si hay datos suficientes)
    const change24h = stats.max_buy - stats.min_buy;
    const changePercent = (change24h / stats.avg_buy * 100).toFixed(2);

    card.innerHTML = `
        <div class="provider-stat-header">
            <span class="provider-stat-name">${provider}</span>
            ${isBest ? '<span class="provider-stat-badge best">Mejor Spread</span>' : '<span class="provider-stat-badge neutral">Competitivo</span>'}
        </div>

        <div class="provider-stat-metrics">
            <div class="provider-stat-metric">
                <span class="provider-stat-metric-label">Promedio Compra</span>
                <span class="provider-stat-metric-value">S/ ${stats.avg_buy.toFixed(3)}</span>
            </div>
            <div class="provider-stat-metric">
                <span class="provider-stat-metric-label">Promedio Venta</span>
                <span class="provider-stat-metric-value">S/ ${stats.avg_sell.toFixed(3)}</span>
            </div>
            <div class="provider-stat-metric">
                <span class="provider-stat-metric-label">Mín / Máx</span>
                <span class="provider-stat-metric-value">${stats.min_buy.toFixed(3)} / ${stats.max_buy.toFixed(3)}</span>
            </div>
            <div class="provider-stat-metric">
                <span class="provider-stat-metric-label">Spread Promedio</span>
                <span class="provider-stat-metric-value">S/ ${(stats.avg_spread * 1000).toFixed(2)}</span>
            </div>
        </div>

        <div class="provider-stat-divider"></div>

        <div class="provider-stat-footer">
            <span>${stats.total_records} registros</span>
            <span class="provider-stat-change ${change24h >= 0 ? 'positive' : 'negative'}">
                ${change24h >= 0 ? '↑' : '↓'} ${Math.abs(changePercent)}%
            </span>
        </div>
    `;

    return card;
}

// ===================================
// CHART TOOLS & EVENT LISTENERS
// ===================================

// Inicializar event listeners para herramientas del gráfico
document.addEventListener('DOMContentLoaded', () => {
    // Inicializar gráfico histórico si Chart.js está disponible
    if (typeof Chart !== 'undefined') {
        initHistoricalChart();
    }

    // 1. BOTONES DE PERÍODO (24h, 3 días, 7 días)
    const periodButtons = document.querySelectorAll('.filter-group .filter-btn');
    periodButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            periodButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const period = parseInt(btn.dataset.period);
            currentPeriod = period;
            await loadHistoricalData(period);

            // Actualizar subtitle
            const subtitle = document.getElementById('historySubtitle');
            if (subtitle) {
                const texts = {
                    24: 'Evolución de las tasas en las últimas 24 horas',
                    72: 'Evolución de las tasas en los últimos 3 días',
                    168: 'Evolución de las tasas en los últimos 7 días'
                };
                subtitle.textContent = texts[period] || `Evolución de las tasas (${period}h)`;
            }
        });
    });

    // 2. SELECTOR DE VISTA (Ambas, Solo Compra, Solo Venta) - Mejorado
    const viewButtons = document.querySelectorAll('.tool-btn[data-view]');
    viewButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            console.log('🔄 Cambiando vista a:', btn.dataset.view);

            // Update active state with animation
            viewButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            currentView = btn.dataset.view;

            // Update chart
            if (chartData && Object.keys(chartData).length > 0) {
                updateChartDatasets(chartData);

                // Update subtitle
                const subtitle = document.getElementById('historySubtitle');
                if (subtitle) {
                    const timeDescription = currentPeriod === 24 ? 'últimas 24 horas' :
                                           currentPeriod === 72 ? 'últimos 3 días' :
                                           currentPeriod === 168 ? 'últimos 7 días' :
                                           `últimas ${currentPeriod} horas`;

                    let viewText = currentView === 'both' ? '• ↑ Compra (sólida) • ↓ Venta (punteada)' :
                                  currentView === 'buy' ? '• ↑ Solo Compra' :
                                  '• ↓ Solo Venta';

                    subtitle.innerHTML = `<strong>Tasas históricas</strong> de ${timeDescription} ${viewText}`;
                }
            }
        });
    });

    // 3. SELECTOR DE TIPO DE GRÁFICO (Líneas, Área) - Mejorado
    const chartTypeButtons = document.querySelectorAll('.tool-btn[data-chart-type]');
    chartTypeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            console.log('📊 Cambiando tipo de gráfico a:', btn.dataset.chartType);

            // Update active state with animation
            chartTypeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            currentChartType = btn.dataset.chartType;

            // Update chart
            if (chartData && Object.keys(chartData).length > 0) {
                updateChartDatasets(chartData);
            }
        });
    });

    // 4. EXPORTAR GRÁFICO
    const exportBtn = document.getElementById('exportChartBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            if (!ratesChart) return;

            const link = document.createElement('a');
            link.download = `tasas-cambio-${currentPeriod}h-${new Date().toISOString().split('T')[0]}.png`;
            link.href = ratesChart.toBase64Image();
            link.click();

            // Feedback visual
            exportBtn.style.transform = 'scale(0.9)';
            setTimeout(() => exportBtn.style.transform = '', 150);
        });
    }

    // 5. RECARGAR DATOS
    const resetBtn = document.getElementById('resetChartBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
            if (!ratesChart) return;

            // Feedback visual
            resetBtn.style.transform = 'rotate(360deg)';
            resetBtn.style.transition = 'transform 0.5s ease';

            // Recargar datos
            await loadHistoricalData(currentPeriod);

            setTimeout(() => {
                resetBtn.style.transform = '';
            }, 500);
        });
    }

    // 6. PANTALLA COMPLETA
    const fullscreenBtn = document.getElementById('fullscreenChartBtn');
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            const container = document.getElementById('chartContainer');
            if (!container) return;

            container.classList.toggle('fullscreen');

            // Cambiar icono (opcional)
            if (container.classList.contains('fullscreen')) {
                fullscreenBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none">
                        <path d="M8 8H3V3M3 8L10 1M16 8H21V3M21 8L14 1M8 16H3V21M3 16L10 23M16 16H21V21M21 16L14 23" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                `;
                ratesChart.resize();
            } else {
                fullscreenBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none">
                        <path d="M8 3H5C3.89543 3 3 3.89543 3 5V8M21 8V5C21 3.89543 20.1046 3 19 3H16M16 21H19C20.1046 21 21 20.1046 21 19V16M3 16V19C3 20.1046 3.89543 21 5 21H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                `;
                ratesChart.resize();
            }

            // ESC para salir de fullscreen
            if (container.classList.contains('fullscreen')) {
                const handleEsc = (e) => {
                    if (e.key === 'Escape') {
                        container.classList.remove('fullscreen');
                        fullscreenBtn.click();
                        document.removeEventListener('keydown', handleEsc);
                    }
                };
                document.addEventListener('keydown', handleEsc);
            }
        });
    }

    // 7. ORDENAR ESTADÍSTICAS
    const statsSort = document.getElementById('statsSortSelect');
    if (statsSort) {
        statsSort.addEventListener('change', () => {
            sortProviderStats(statsSort.value);
        });
    }
});

// Ordenar tarjetas de estadísticas
function sortProviderStats(sortBy) {
    const container = document.getElementById('providerStats');
    if (!container) return;

    const cards = Array.from(container.children);

    cards.sort((a, b) => {
        const nameA = a.querySelector('.provider-stat-name').textContent;
        const nameB = b.querySelector('.provider-stat-name').textContent;

        switch (sortBy) {
            case 'name':
                return nameA.localeCompare(nameB);
            case 'avg-buy':
                const buyA = parseFloat(a.querySelector('.provider-stat-metric-value').textContent.replace('S/ ', ''));
                const buyB = parseFloat(b.querySelector('.provider-stat-metric-value').textContent.replace('S/ ', ''));
                return buyB - buyA;
            case 'spread':
                const metrics = a.querySelectorAll('.provider-stat-metric-value');
                const metricsB = b.querySelectorAll('.provider-stat-metric-value');
                const spreadA = parseFloat(metrics[3].textContent.replace('S/ ', ''));
                const spreadB = parseFloat(metricsB[3].textContent.replace('S/ ', ''));
                return spreadA - spreadB;
            default:
                return 0;
        }
    });

    cards.forEach(card => container.appendChild(card));
}

// ===================================
// INFO WIDGETS UPDATE
// ===================================

function updateWidgets(rates, lastUpdate) {
    if (!rates || rates.length === 0) return;

    // Update provider count
    const providerCountEl = document.getElementById('widgetProviderCount');
    if (providerCountEl) {
        providerCountEl.textContent = rates.length;
    }

    // Update last update time
    const lastUpdateEl = document.getElementById('widgetLastUpdate');
    if (lastUpdateEl && lastUpdate) {
        const date = new Date(lastUpdate);
        const now = new Date();
        const diffMinutes = Math.floor((now - date) / 1000 / 60);

        let updateText;
        if (diffMinutes < 1) {
            updateText = 'Ahora';
        } else if (diffMinutes === 1) {
            updateText = 'Hace 1 min';
        } else if (diffMinutes < 60) {
            updateText = `Hace ${diffMinutes} min`;
        } else {
            const hours = Math.floor(diffMinutes / 60);
            updateText = `Hace ${hours}h`;
        }

        lastUpdateEl.textContent = updateText;
    }

    // Best buy (highest compra rate)
    const bestBuy = rates.reduce((best, current) =>
        current.compra > best.compra ? current : best
    );

    const bestBuyCompactEl = document.getElementById('widgetBestBuyCompact');
    if (bestBuyCompactEl) {
        const providerEl = bestBuyCompactEl.querySelector('.compact-opp-provider');
        const rateEl = bestBuyCompactEl.querySelector('.compact-opp-rate');
        if (providerEl) providerEl.textContent = bestBuy.name;
        if (rateEl) rateEl.textContent = `S/ ${bestBuy.compra.toFixed(3)}`;
    }

    // Best sell (lowest venta rate)
    const bestSell = rates.reduce((best, current) =>
        current.venta < best.venta ? current : best
    );

    const bestSellCompactEl = document.getElementById('widgetBestSellCompact');
    if (bestSellCompactEl) {
        const providerEl = bestSellCompactEl.querySelector('.compact-opp-provider');
        const rateEl = bestSellCompactEl.querySelector('.compact-opp-rate');
        if (providerEl) providerEl.textContent = bestSell.name;
        if (rateEl) rateEl.textContent = `S/ ${bestSell.venta.toFixed(3)}`;
    }

    // Average spread
    const avgSpread = rates.reduce((sum, rate) => sum + (rate.venta - rate.compra), 0) / rates.length;
    const avgSpreadCompactEl = document.getElementById('widgetAvgSpreadCompact');
    if (avgSpreadCompactEl) {
        avgSpreadCompactEl.textContent = avgSpread.toFixed(3);
    }

    // Range (Min-Max)
    const allBuyRates = rates.map(r => r.compra);
    const minBuy = Math.min(...allBuyRates);
    const maxBuy = Math.max(...allBuyRates);
    const rangeCompactEl = document.getElementById('widgetRangeCompact');
    if (rangeCompactEl) {
        rangeCompactEl.textContent = `${minBuy.toFixed(3)}-${maxBuy.toFixed(3)}`;
    }
}

// ===================================
// CSV EXPORT FUNCTIONALITY
// ===================================

function exportRatesToCSV(rates) {
    if (!rates || rates.length === 0) {
        alert('No hay datos para exportar');
        return;
    }

    // Calcular tasas adicionales para el export
    const bestBuyRate = Math.max(...rates.map(r => r.compra));
    const bestSellRate = Math.min(...rates.map(r => r.venta));
    const referenceAmount = 1000;

    // Crear datos CSV con información completa
    const csvData = rates.map(rate => {
        const spread = (rate.venta - rate.compra).toFixed(3);
        const isBestBuy = rate.compra === bestBuyRate;
        const isBestSell = rate.venta === bestSellRate;

        // Calcular costo vs mejor
        const costVsBestBuy = (bestBuyRate - rate.compra) * referenceAmount;
        const costVsBestSell = (rate.venta - bestSellRate) * referenceAmount;
        const totalCost = Math.max(costVsBestBuy, costVsBestSell);

        // Badge
        let badge = '';
        if (isBestBuy && isBestSell) badge = 'Mejor Ambas';
        else if (isBestBuy) badge = 'Mejor Compra';
        else if (isBestSell) badge = 'Mejor Venta';

        return {
            'Casa de Cambio': rate.name,
            'Tasa Compra': rate.compra.toFixed(3),
            'Tasa Venta': rate.venta.toFixed(3),
            'Diferencial': spread,
            'Costo vs Mejor (USD 1000)': totalCost < 0.01 ? '0.00' : totalCost.toFixed(2),
            'Indicador': badge,
            'Fecha y Hora': new Date(rate.timestamp).toLocaleString('es-PE')
        };
    });

    // Crear encabezados
    const headers = Object.keys(csvData[0]);

    // Convertir a formato CSV
    const csvRows = [
        headers.join(','),
        ...csvData.map(row =>
            headers.map(header => {
                const value = row[header];
                // Escapar valores que contengan comas
                return typeof value === 'string' && value.includes(',')
                    ? `"${value}"`
                    : value;
            }).join(',')
        )
    ];

    const csvContent = csvRows.join('\n');

    // Crear blob y descargar
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    // Nombre de archivo con fecha y hora
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `tasas-cambio-${timestamp}.csv`;

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Feedback visual
    const exportBtn = document.getElementById('exportCsvBtn');
    if (exportBtn) {
        const originalText = exportBtn.innerHTML;
        exportBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17L4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>Exportado!</span>
        `;
        exportBtn.style.background = '#22c55e';

        setTimeout(() => {
            exportBtn.innerHTML = originalText;
            exportBtn.style.background = '';
        }, 2000);
    }
}
