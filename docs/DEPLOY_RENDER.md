# Deploy en Render.com - Guía Completa

## Por Qué Render.com

✅ **GRATIS** - 750 horas/mes (24/7 para 1 app)
✅ **Soporta Puppeteer** - Chrome headless funciona perfecto
✅ **Persistencia** - SQLite con datos permanentes
✅ **Cron Jobs** - Scraping automático cada 10 min
✅ **Deploy Automático** - Push a GitHub = auto deploy
✅ **HTTPS gratis** - Certificado SSL incluido

## Paso a Paso (5 minutos)

### 1. Preparar Repositorio GitHub

```bash
# Si aún no tienes repo, crear uno
git init
git add .
git commit -m "Ready for Render deployment"

# Crear repo en GitHub y pushear
git remote add origin https://github.com/tu-usuario/coya.git
git branch -M main
git push -u origin main
```

### 2. Crear Cuenta en Render

1. Ve a https://render.com
2. Sign up con GitHub (recomendado)
3. Autoriza Render a acceder a tus repos

### 3. Crear Web Service

1. Click **"New +"** → **"Web Service"**
2. Conecta tu repositorio `coya`
3. Render detectará automáticamente Node.js

### 4. Configuración del Servicio

Render detecta el `render.yaml` pero verifica:

**Build Command:**
```bash
npm install
```

**Start Command:**
```bash
npm start
```

**Environment:**
- Node

**Plan:**
- Free (seleccionar)

### 5. Configurar Variables de Entorno

En la sección **Environment**, agregar:

```env
NODE_ENV=production
PORT=3006
VERBOSE_LOGGING=false
SCRAPE_INTERVAL_MINUTES=10
PUPPETEER_HEADLESS=true
DB_PATH=./data/exchange_rates.db

# Seguridad (recomendado)
ALLOWED_ORIGINS=https://tu-app.onrender.com
ADMIN_API_KEY=genera_una_clave_aqui
```

### 6. Agregar Disco Persistente

**IMPORTANTE para SQLite:**

1. En el dashboard, ir a **"Disks"**
2. Click **"Add Disk"**
3. Configurar:
   - **Name**: `coya-data`
   - **Mount Path**: `/opt/render/project/src/data`
   - **Size**: 1 GB (suficiente)

Esto asegura que tu base de datos SQLite no se borre.

### 7. Deploy

1. Click **"Create Web Service"**
2. Render empezará a buildear automáticamente
3. Espera 3-5 minutos (Puppeteer tarda en instalarse)

### 8. Verificar Deployment

Una vez completado:

```bash
# Tu URL será algo como:
https://coya-xxxx.onrender.com

# Probar API
curl https://coya-xxxx.onrender.com/api/health
curl https://coya-xxxx.onrender.com/api/rates

# Ver en navegador
https://coya-xxxx.onrender.com
```

## Configuración Post-Deploy

### Actualizar ALLOWED_ORIGINS

En Environment Variables, actualizar:
```env
ALLOWED_ORIGINS=https://coya-xxxx.onrender.com,https://www.tu-dominio.com
```

### Configurar Dominio Custom (Opcional)

1. Ve a **"Settings"** → **"Custom Domain"**
2. Agregar tu dominio
3. Configurar DNS según instrucciones de Render

## Monitoring

### Ver Logs en Tiempo Real

1. Dashboard → Tu servicio
2. Pestaña **"Logs"**
3. Ver scraping en vivo

### Health Checks

Render automáticamente verifica:
- URL: `/api/health`
- Cada 30 segundos
- Si falla 3 veces, reinicia el servicio

## Limitaciones del Free Tier

⚠️ **Importante:**

1. **Sleep después de 15 min de inactividad**
   - Primera request después de sleep tarda ~30 segundos
   - Solución: Usar servicio de ping externo (UptimeRobot)

2. **750 horas/mes**
   - Suficiente para 24/7 de 1 app
   - Si tienes múltiples apps, se comparte el límite

3. **No backups automáticos**
   - Debes hacer backups manuales de SQLite

## Mantener Activo 24/7

**Usar UptimeRobot (gratis):**

1. Registrarse en https://uptimerobot.com
2. Crear nuevo monitor:
   - **Type**: HTTP(S)
   - **URL**: `https://coya-xxxx.onrender.com/api/health`
   - **Interval**: 5 minutos
3. Esto hace ping cada 5 min = servicio siempre activo

## Actualizaciones

### Deploy Automático

Cada `git push` a `main` despliega automáticamente:

```bash
git add .
git commit -m "Update security features"
git push origin main

# Render auto-detecta y despliega
```

### Deploy Manual

En Render dashboard:
1. Click **"Manual Deploy"**
2. Seleccionar branch
3. Click **"Deploy"**

## Troubleshooting

### Build falla

**Error: Puppeteer no se instala**
```bash
# En render.yaml, verificar que esté:
buildCommand: npm install
```

**Error: Out of memory**
```bash
# Puppeteer es pesado, pero Render free tier soporta
# Si persiste, considerar Railway o Fly.io
```

### Scraping no funciona

```bash
# Verificar logs que Puppeteer está corriendo
# Ver que PUPPETEER_HEADLESS=true

# En Render dashboard → Logs
# Buscar: "Scraping Kambista.com..."
```

### Base de datos se borra

```bash
# Verificar que el disco esté montado
# Dashboard → Disks → Verificar mount path
```

## Costos

**Free Tier:**
- 0 USD/mes
- 750 horas/mes
- 512 MB RAM
- Disco persistente gratis (1GB)

**Si necesitas más:**
- Starter: $7/mes
- RAM ilimitada
- Sin sleep
- Más recursos

## Alternativas si Free Tier no Suficiente

### Railway.app ($5 crédito/mes)
```bash
# Similar a Render pero con créditos
# Puede quedarse sin crédito rápido con Puppeteer
```

### Fly.io (Más generoso)
```bash
# Más complejo pero free tier más grande
# Ver DEPLOYMENT.md sección Fly.io
```

## Checklist Pre-Deploy

- [ ] Código pusheado a GitHub
- [ ] `.env` NO está en el repo (en `.gitignore`)
- [ ] `render.yaml` configurado
- [ ] Variables de entorno listas
- [ ] ADMIN_API_KEY generada
- [ ] ALLOWED_ORIGINS configurado con tu URL de Render

## Checklist Post-Deploy

- [ ] Servicio está corriendo (verde)
- [ ] `/api/health` responde OK
- [ ] `/api/rates` retorna datos
- [ ] Frontend se ve correctamente
- [ ] Logs muestran scraping funcionando
- [ ] Disco persistente montado
- [ ] UptimeRobot configurado (opcional)
- [ ] Dominio custom configurado (opcional)

---

**Tiempo estimado total: 5-10 minutos**

¡Tu app estará live en https://coya-xxxx.onrender.com! 🚀
