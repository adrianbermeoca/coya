# COYA - Comparador de Tasas de Cambio

Aplicación web en tiempo real para comparar tasas de cambio de dólar a soles peruanos (USD/PEN) de múltiples casas de cambio en Perú.

## Características

- ✅ **Scraping en tiempo real** de 6 fuentes confiables:
  - Kambista
  - Rextie
  - Tkambio
  - Tucambista
  - Bloomberg Línea (Spot)
  - Western Union Peru

- 📊 **Dashboard interactivo** con:
  - Tabla comparativa de tasas en tiempo real
  - Calculadora de cambio
  - Gráficos históricos (24h, 3d, 7d)
  - KPIs y estadísticas

- 🎨 **Diseño profesional** estilo Power BI con tema oscuro

- 💾 **Base de datos SQLite** para almacenamiento histórico

- 🔄 **Actualización automática** cada 10 minutos

## Requisitos del Sistema

- Node.js >= 18.0.0
- npm o yarn
- 2GB de RAM mínimo (para Puppeteer)
- Sistema operativo: Windows, Linux, o macOS

## Instalación

### 1. Clonar el repositorio

\`\`\`bash
git clone <tu-repositorio>
cd coya
\`\`\`

### 2. Instalar dependencias

\`\`\`bash
npm install
\`\`\`

### 3. Configurar variables de entorno

Copia el archivo de ejemplo y ajusta según tus necesidades:

\`\`\`bash
cp .env.example .env
\`\`\`

Edita el archivo \`.env\`:

\`\`\`env
# Configuración del servidor
PORT=3006
NODE_ENV=production

# Configuración de logging
VERBOSE_LOGGING=false

# Configuración de scraping
SCRAPE_INTERVAL_MINUTES=10
PUPPETEER_HEADLESS=true

# Base de datos
DB_PATH=./data/exchange_rates.db
\`\`\`

### 4. Crear directorio de datos

\`\`\`bash
mkdir -p data
\`\`\`

## Uso

### Modo Desarrollo

\`\`\`bash
npm run dev
\`\`\`

Esto iniciará el servidor con logging verbose activado en el puerto 3006.

### Modo Producción

\`\`\`bash
npm start
\`\`\`

o

\`\`\`bash
npm run prod
\`\`\`

El servidor se iniciará en modo producción con logging mínimo.

### Acceder a la aplicación

Abre tu navegador en:
\`\`\`
http://localhost:3006
\`\`\`

## Estructura del Proyecto

\`\`\`
coya/
├── data/                   # Base de datos SQLite
├── public/                 # Archivos estáticos del frontend
│   ├── index.html         # Página principal
│   ├── app.js            # Lógica del cliente
│   └── styles.css        # Estilos CSS
├── scrapers/              # Scripts de scraping
│   ├── kambista.js
│   ├── rextie.js
│   ├── tkambio.js
│   ├── tucambista.js
│   ├── bloomberg.js
│   └── westernunion.js
├── utils/                 # Utilidades
│   ├── database.js       # Manejo de SQLite
│   └── logger.js         # Sistema de logging
├── server.js             # Servidor Express principal
├── .env                  # Variables de entorno (no commiteado)
├── .env.example          # Ejemplo de configuración
└── package.json          # Dependencias del proyecto
\`\`\`

## API Endpoints

### \`GET /api/rates\`
Obtiene las tasas de cambio actuales de todas las casas.

**Respuesta:**
\`\`\`json
{
  "timestamp": "2025-12-28T23:30:00.000Z",
  "rates": [
    {
      "name": "Kambista",
      "compra": 3.346,
      "venta": 3.383,
      "timestamp": "2025-12-28T23:30:00.000Z"
    }
  ]
}
\`\`\`

### \`GET /api/providers\`
Lista todos los proveedores disponibles.

**Respuesta:**
\`\`\`json
{
  "providers": ["Kambista", "Rextie", "Tkambio", ...]
}
\`\`\`

### \`GET /api/history/:provider?hours=24\`
Obtiene el historial de tasas de un proveedor.

**Parámetros:**
- \`provider\`: Nombre del proveedor
- \`hours\`: Horas hacia atrás (por defecto 24)

**Respuesta:**
\`\`\`json
{
  "provider": "Kambista",
  "data": [
    {
      "timestamp": "2025-12-28T23:00:00.000Z",
      "buy_rate": 3.346,
      "sell_rate": 3.383
    }
  ]
}
\`\`\`

## Despliegue en Producción

### Opción 1: VPS tradicional (AWS, DigitalOcean, Linode)

1. **Conectar al servidor:**
\`\`\`bash
ssh usuario@tu-servidor.com
\`\`\`

2. **Instalar Node.js:**
\`\`\`bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
\`\`\`

3. **Clonar y configurar:**
\`\`\`bash
git clone <tu-repo>
cd coya
npm install --production
cp .env.example .env
nano .env  # Editar configuración
\`\`\`

4. **Usar PM2 para gestión de procesos:**
\`\`\`bash
sudo npm install -g pm2
pm2 start server.js --name coya
pm2 save
pm2 startup
\`\`\`

5. **Configurar Nginx como reverse proxy:**
\`\`\`nginx
server {
    listen 80;
    server_name tudominio.com;

    location / {
        proxy_pass http://localhost:3006;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
\`\`\`

### Opción 2: Render.com

1. Crear cuenta en [Render.com](https://render.com)
2. Crear nuevo "Web Service"
3. Conectar tu repositorio de GitHub
4. Configurar:
   - **Build Command:** \`npm install\`
   - **Start Command:** \`npm start\`
   - **Environment Variables:** Agregar las del archivo .env
5. Deploy automático

### Opción 3: Railway.app

1. Crear cuenta en [Railway.app](https://railway.app)
2. Crear nuevo proyecto desde GitHub
3. Railway detectará automáticamente Node.js
4. Agregar variables de entorno desde el dashboard
5. Deploy automático

### Opción 4: Fly.io

1. Instalar flyctl:
\`\`\`bash
curl -L https://fly.io/install.sh | sh
\`\`\`

2. Autenticarse:
\`\`\`bash
flyctl auth login
\`\`\`

3. Lanzar app:
\`\`\`bash
flyctl launch
\`\`\`

4. Configurar variables de entorno:
\`\`\`bash
flyctl secrets set NODE_ENV=production
flyctl secrets set PORT=3006
\`\`\`

5. Deploy:
\`\`\`bash
flyctl deploy
\`\`\`

## Variables de Entorno para Producción

Asegúrate de configurar estas variables en tu plataforma de despliegue:

\`\`\`env
NODE_ENV=production
PORT=3006
VERBOSE_LOGGING=false
SCRAPE_INTERVAL_MINUTES=10
PUPPETEER_HEADLESS=true
DB_PATH=./data/exchange_rates.db
\`\`\`

## Monitoreo y Mantenimiento

### Ver logs (con PM2)
\`\`\`bash
pm2 logs coya
\`\`\`

### Reiniciar aplicación
\`\`\`bash
pm2 restart coya
\`\`\`

### Ver estado
\`\`\`bash
pm2 status
\`\`\`

### Base de datos

La base de datos se limpia automáticamente cada día a las 3 AM, eliminando datos mayores a 30 días.

Para hacer backup manual:
\`\`\`bash
cp data/exchange_rates.db data/backup_\$(date +%Y%m%d).db
\`\`\`

## Solución de Problemas

### Error: "Cannot find module 'puppeteer'"
\`\`\`bash
npm install
\`\`\`

### Error: "EADDRINUSE - Puerto en uso"
Cambia el puerto en el archivo \`.env\` o detén el proceso que usa el puerto 3006.

### Scraping muy lento
Verifica tu conexión a internet y considera aumentar el \`SCRAPE_INTERVAL_MINUTES\`.

### Base de datos corrupta
\`\`\`bash
rm data/exchange_rates.db
# La aplicación creará una nueva base de datos al iniciar
\`\`\`

## Licencia

ISC

## Soporte

Para reportar problemas o sugerir mejoras, crea un issue en el repositorio.

---

**Desarrollado con ❤️ para facilitar el cambio de divisas en Perú**
