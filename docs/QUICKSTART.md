# Inicio Rápido - COYA

## Desarrollo Local (2 minutos)

```bash
# 1. Clonar e instalar
git clone <tu-repo>
cd coya
npm install

# 2. Configurar
cp .env.example .env

# 3. Ejecutar
npm run dev

# 4. Abrir navegador
http://localhost:3006
```

¡Listo! La aplicación está corriendo con datos de prueba.

## Despliegue Rápido en Cloud (5 minutos)

### Render.com (Recomendado para principiantes)

1. Crea cuenta en https://render.com
2. Click "New +" → "Web Service"
3. Conecta tu repo de GitHub
4. Render detecta automáticamente Node.js
5. Configura variables de entorno desde `.env.example`
6. Click "Create Web Service"

### Railway.app (Muy simple)

1. Crea cuenta en https://railway.app
2. "New Project" → "Deploy from GitHub repo"
3. Selecciona el repo
4. Railway deploy automático
5. Configura variables de entorno en Settings
6. Listo!

### Fly.io (Más control)

```bash
# 1. Instalar CLI
curl -L https://fly.io/install.sh | sh

# 2. Login
flyctl auth login

# 3. Deploy
flyctl launch
# Responde las preguntas, usa defaults

# 4. Configurar secretos
flyctl secrets set NODE_ENV=production

# 5. Deploy
flyctl deploy
```

## Comandos Útiles

```bash
# Desarrollo con logging verbose
npm run dev

# Producción
npm start

# Ver estructura del proyecto
ls -R

# Limpiar y reinstalar
rm -rf node_modules
npm install

# Ver base de datos (requiere sqlite3)
sqlite3 data/exchange_rates.db ".tables"
sqlite3 data/exchange_rates.db "SELECT COUNT(*) FROM exchange_rates;"
```

## Resolución Rápida de Problemas

### "Cannot find module..."
```bash
npm install
```

### "Puerto 3006 en uso"
```bash
# Windows
netstat -ano | findstr :3006
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:3006 | xargs kill -9
```

### "Puppeteer no funciona"
```bash
# Linux
sudo apt-get install -y chromium-browser

# Verificar instalación
node -e "const puppeteer = require('puppeteer'); console.log('OK')"
```

### Scraping no trae datos
- Verificar conexión a internet
- Algunos scrapers pueden tardar hasta 90 segundos
- Ver logs en la consola

## Estructura Mínima Necesaria

```
coya/
├── data/              # Se crea automáticamente
├── public/            # Frontend (HTML, CSS, JS)
├── scrapers/          # Scripts de scraping
├── utils/             # Utilidades (logger, database, security)
├── server.js          # Servidor principal
├── .env               # Tu configuración (crear desde .env.example)
└── package.json       # Dependencias
```

## Próximos Pasos

1. ✅ Aplicación corriendo localmente
2. 📖 Leer [README.md](README.md) para documentación completa
3. 🚀 Seguir [DEPLOYMENT.md](DEPLOYMENT.md) para desplegar
4. 🔒 Revisar [SECURITY.md](SECURITY.md) antes de producción
5. ⚙️ Personalizar según tus necesidades

## Ayuda

- **Issues**: Crea un issue en GitHub
- **Documentación**: Ver README.md
- **Despliegue**: Ver DEPLOYMENT.md
- **Seguridad**: Ver SECURITY.md

---

**Tiempo total estimado de setup**: 2-5 minutos desarrollo, 10-30 minutos producción
