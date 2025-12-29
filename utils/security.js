/**
 * Middleware y utilidades de seguridad
 */

// Validar y sanitizar parámetros numéricos
function validateNumericParam(value, min, max, defaultValue) {
    const parsed = parseInt(value);
    if (isNaN(parsed) || parsed < min || parsed > max) {
        return defaultValue;
    }
    return parsed;
}

// Validar nombres de proveedores (evitar path traversal)
function validateProviderName(providerName) {
    if (!providerName || typeof providerName !== 'string') {
        return null;
    }
    
    // Eliminar caracteres peligrosos
    const sanitized = providerName.replace(/[^a-zA-Z0-9\s\(\)áéíóúñÁÉÍÓÚÑ\-]/g, '');
    
    // Limitar longitud
    if (sanitized.length > 100) {
        return null;
    }
    
    return sanitized;
}

// Lista blanca de proveedores válidos
const VALID_PROVIDERS = [
    'Kambista',
    'Rextie',
    'Tkambio',
    'Tucambista',
    'Bloomberg Línea (Spot)',
    'Western Union Peru',
    'SUNAT'
];

function isValidProvider(providerName) {
    return VALID_PROVIDERS.includes(providerName);
}

// Middleware para validar parámetros comunes
function validateQueryParams(req, res, next) {
    // Validar hours (si existe)
    if (req.query.hours !== undefined) {
        req.query.hours = validateNumericParam(req.query.hours, 1, 720, 24);
    }
    
    // Validar days (si existe)
    if (req.query.days !== undefined) {
        req.query.days = validateNumericParam(req.query.days, 1, 90, 7);
    }
    
    // Validar interval (si existe)
    if (req.query.interval !== undefined) {
        req.query.interval = validateNumericParam(req.query.interval, 1, 24, 1);
    }
    
    next();
}

// Middleware para validar provider en params
function validateProviderParam(req, res, next) {
    if (req.params.provider) {
        const sanitized = validateProviderName(req.params.provider);
        
        if (!sanitized) {
            return res.status(400).json({ 
                error: 'Nombre de proveedor inválido' 
            });
        }
        
        if (!isValidProvider(sanitized)) {
            return res.status(404).json({ 
                error: 'Proveedor no encontrado',
                validProviders: VALID_PROVIDERS
            });
        }
        
        req.params.provider = sanitized;
    }
    
    next();
}

// Headers de seguridad
function securityHeaders(req, res, next) {
    // Prevenir clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    
    // Prevenir XSS
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Deshabilitar caché de información sensible
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    next();
}

// Rate limiting simple (en memoria)
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minuto
const MAX_REQUESTS_PER_WINDOW = 100; // 100 requests por minuto

function simpleRateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    // Limpiar entradas antiguas
    for (const [key, data] of requestCounts.entries()) {
        if (now - data.timestamp > RATE_LIMIT_WINDOW) {
            requestCounts.delete(key);
        }
    }
    
    // Verificar límite
    const record = requestCounts.get(ip);
    
    if (record) {
        if (now - record.timestamp < RATE_LIMIT_WINDOW) {
            if (record.count >= MAX_REQUESTS_PER_WINDOW) {
                return res.status(429).json({ 
                    error: 'Demasiadas solicitudes. Intenta nuevamente en 1 minuto.' 
                });
            }
            record.count++;
        } else {
            requestCounts.set(ip, { count: 1, timestamp: now });
        }
    } else {
        requestCounts.set(ip, { count: 1, timestamp: now });
    }
    
    next();
}

module.exports = {
    validateNumericParam,
    validateProviderName,
    isValidProvider,
    validateQueryParams,
    validateProviderParam,
    securityHeaders,
    simpleRateLimit,
    VALID_PROVIDERS
};
