# Consideraciones de Seguridad - COYA

## Resumen

Este documento describe las medidas de seguridad implementadas y recomendaciones adicionales para el despliegue seguro de COYA.

## Seguridad Implementada

### 1. Variables de Entorno
✅ **Implementado**: Configuración mediante archivos `.env`
- Credenciales y configuración sensible no están en el código
- `.env` está en `.gitignore`
- Se proporciona `.env.example` como plantilla

### 2. Gestión de Dependencias
✅ **Implementado**: Todas las dependencias están especificadas en `package.json`
- Versiones específicas de dependencias críticas
- Uso de `npm ci` recomendado en producción

### 3. Logging Controlado
✅ **Implementado**: Sistema de logging por entorno
- En producción (`NODE_ENV=production`), logging mínimo
- Logs no exponen información sensible
- Sistema de logger en `utils/logger.js`

## Medidas de Seguridad Recomendadas

### 1. CORS (Cross-Origin Resource Sharing)

**Estado Actual**: CORS abierto a todos los orígenes

**Recomendación**: Configurar CORS restrictivo en producción

**Implementación Recomendada**:

```javascript
// En server.js
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://tudominio.com', 'https://www.tudominio.com']
    : '*',
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
```

Agregar a `.env`:
```
ALLOWED_ORIGINS=https://tudominio.com,https://www.tudominio.com
```

### 2. Rate Limiting

**Estado Actual**: Sin rate limiting

**Riesgo**: Susceptible a abuso de API

**Implementación Recomendada**:

Opción 1 - Middleware simple (ya incluido en `utils/security.js`):
```javascript
const { simpleRateLimit } = require('./utils/security');
app.use('/api/', simpleRateLimit);
```

Opción 2 - Usar express-rate-limit (más robusto):
```bash
npm install express-rate-limit
```

```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests por IP
  message: 'Demasiadas solicitudes desde esta IP'
});

app.use('/api/', limiter);
```

### 3. Headers de Seguridad

**Recomendación**: Usar helmet.js para headers HTTP seguros

```bash
npm install helmet
```

```javascript
const helmet = require('helmet');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"]
    }
  }
}));
```

### 4. Validación de Inputs

**Estado Actual**: Validación básica en algunos endpoints

**Recomendación**: Usar middleware de validación

**Implementación** (ya incluido en `utils/security.js`):

```javascript
const { 
  validateQueryParams, 
  validateProviderParam 
} = require('./utils/security');

// Aplicar a endpoints específicos
app.get('/api/history/:provider', 
  validateProviderParam,
  validateQueryParams,
  (req, res) => {
    // Handler seguro
  }
);
```

### 5. HTTPS en Producción

**Obligatorio**: Siempre usar HTTPS en producción

**Opciones**:
- Let's Encrypt (gratuito) con Certbot
- Certificado SSL de tu proveedor cloud
- Cloudflare (proxy con SSL automático)

**Forzar HTTPS**:
```javascript
// Middleware para redirigir HTTP a HTTPS
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}
```

### 6. Protección de Endpoints Sensibles

**Recomendación**: Proteger endpoints que modifican datos

```javascript
// Endpoint de refresh con API key simple
app.get('/api/refresh', (req, res) => {
  const apiKey = req.header('X-API-Key');
  
  if (apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  
  // Proceder con refresh
});
```

Agregar a `.env`:
```
ADMIN_API_KEY=genera_una_clave_aleatoria_segura_aqui
```

### 7. Sanitización de Datos de Scraping

**Recomendación**: Validar datos extraídos antes de almacenar

```javascript
function validateRate(rate) {
  const parsed = parseFloat(rate);
  if (isNaN(parsed) || parsed <= 0 || parsed > 10) {
    throw new Error('Tasa inválida');
  }
  return parsed;
}
```

### 8. Manejo de Errores

**Recomendación**: No exponer detalles de errores en producción

```javascript
// Middleware de manejo de errores global
app.use((err, req, res, next) => {
  console.error(err.stack);
  
  if (process.env.NODE_ENV === 'production') {
    res.status(500).json({ 
      error: 'Error interno del servidor' 
    });
  } else {
    res.status(500).json({ 
      error: err.message,
      stack: err.stack 
    });
  }
});
```

## Seguridad de Base de Datos

### 1. Permisos de Archivos

```bash
# Asegurar que solo el usuario de la app puede acceder a la DB
chmod 600 data/exchange_rates.db
```

### 2. Backups Encriptados

```bash
# Backup con encriptación
tar -czf - data/exchange_rates.db | openssl enc -aes-256-cbc -e > backup_encrypted.tar.gz.enc
```

### 3. Limpieza Automática

✅ Ya implementado: Limpieza diaria de datos antiguos

## Seguridad del Servidor

### 1. Firewall

```bash
# UFW en Ubuntu
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
```

### 2. Usuario No-Root

```bash
# Crear usuario para la aplicación
sudo adduser --disabled-password coya
sudo su - coya

# Instalar aplicación bajo este usuario
```

### 3. Fail2Ban (Anti-bruteforce)

```bash
sudo apt install fail2ban
sudo systemctl enable fail2ban
```

## Monitoreo de Seguridad

### 1. Auditoría de Dependencias

```bash
# Revisar vulnerabilidades conocidas
npm audit

# Actualizar dependencias con vulnerabilidades
npm audit fix
```

### 2. Logs de Acceso

```bash
# Revisar accesos sospechosos
grep "404\|500" /var/log/nginx/access.log

# Con PM2
pm2 logs coya | grep -i "error\|fail"
```

### 3. Monitoreo de Recursos

```bash
# Ver uso de recursos
pm2 monit

# O con htop
htop
```

## Checklist de Seguridad Pre-Producción

- [ ] HTTPS configurado y funcionando
- [ ] CORS restringido a dominios permitidos
- [ ] Rate limiting implementado
- [ ] Headers de seguridad configurados (helmet)
- [ ] Variables de entorno configuradas correctamente
- [ ] `.env` no está en el repositorio
- [ ] Validación de inputs implementada
- [ ] Logging configurado (sin datos sensibles)
- [ ] Backups de base de datos programados
- [ ] Firewall configurado
- [ ] Aplicación corre con usuario no-root
- [ ] Dependencias auditadas (`npm audit`)
- [ ] Endpoints sensibles protegidos
- [ ] Manejo de errores no expone detalles en producción

## Reporte de Vulnerabilidades

Si encuentras una vulnerabilidad de seguridad:

1. **NO** la publiques en issues públicos
2. Envía detalles a: [tu-email-de-seguridad]
3. Incluye:
   - Descripción de la vulnerabilidad
   - Pasos para reproducir
   - Impacto potencial
   - Sugerencias de mitigación (si las tienes)

## Actualizaciones de Seguridad

- Revisar dependencias mensualmente: `npm audit`
- Actualizar Node.js a versiones LTS
- Seguir advisories de seguridad de npm
- Mantener sistema operativo actualizado

## Referencias

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)

---

**Última actualización**: 2025-12-28
