# Checklist de Despliegue - COYA

## Pre-Despliegue

### 1. Configuración del Entorno
- [ ] Copiar `.env.example` a `.env`
- [ ] Configurar `NODE_ENV=production`
- [ ] Configurar `PORT` según el servidor
- [ ] Configurar `VERBOSE_LOGGING=false`
- [ ] Verificar `PUPPETEER_HEADLESS=true`
- [ ] Configurar path de base de datos `DB_PATH`

### 2. Dependencias
- [ ] Ejecutar `npm install --production`
- [ ] Verificar que todas las dependencias se instalaron correctamente
- [ ] Verificar versión de Node.js >= 18.0.0

### 3. Base de Datos
- [ ] Crear directorio `data/` si no existe
- [ ] Verificar permisos de escritura en `data/`
- [ ] Ejecutar aplicación una vez para crear esquema de DB

### 4. Seguridad
- [ ] Configurar CORS adecuado para producción
- [ ] Revisar que `.env` no esté commiteado
- [ ] Configurar firewall para permitir solo puertos necesarios
- [ ] Configurar certificado SSL/TLS
- [ ] Implementar rate limiting (opcional pero recomendado)

### 5. Logs
- [ ] Crear directorio `logs/` para PM2 (si se usa)
- [ ] Configurar rotación de logs
- [ ] Verificar que logs no expongan información sensible

## Despliegue según Plataforma

### VPS Tradicional (AWS, DigitalOcean, Linode)

1. **Preparar Servidor**
   ```bash
   # Actualizar sistema
   sudo apt update && sudo apt upgrade -y
   
   # Instalar Node.js 18
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # Instalar Git
   sudo apt-get install -y git
   ```

2. **Clonar y Configurar**
   ```bash
   git clone <tu-repo>
   cd coya
   npm install --production
   cp .env.example .env
   nano .env  # Editar configuración
   mkdir -p data logs
   ```

3. **Instalar PM2**
   ```bash
   sudo npm install -g pm2
   pm2 start ecosystem.config.js --env production
   pm2 save
   pm2 startup
   # Copiar y ejecutar el comando que muestra PM2
   ```

4. **Configurar Nginx**
   ```bash
   sudo apt install -y nginx
   sudo nano /etc/nginx/sites-available/coya
   ```
   
   Contenido del archivo:
   ```nginx
   server {
       listen 80;
       server_name tudominio.com;

       location / {
           proxy_pass http://localhost:3006;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```
   
   ```bash
   sudo ln -s /etc/nginx/sites-available/coya /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

5. **Configurar SSL con Certbot**
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d tudominio.com
   ```

6. **Verificar Despliegue**
   - [ ] Acceder a http://tudominio.com
   - [ ] Verificar que redirige a HTTPS
   - [ ] Probar API endpoints
   - [ ] Verificar que scraping funciona

### Docker

1. **Build de Imagen**
   ```bash
   docker build -t coya:latest .
   ```

2. **Ejecutar con Docker Compose**
   ```bash
   docker-compose up -d
   ```

3. **Verificar**
   ```bash
   docker-compose ps
   docker-compose logs -f
   ```

### Render.com

1. **Preparar Repositorio**
   - [ ] Asegurar que `render.yaml` está en el repo
   - [ ] Commit y push a GitHub

2. **Crear Servicio**
   - [ ] Ir a dashboard.render.com
   - [ ] Crear nuevo "Web Service"
   - [ ] Conectar repositorio de GitHub
   - [ ] Render detectará automáticamente la configuración

3. **Configurar Variables de Entorno**
   - [ ] Agregar todas las variables desde `.env.example`
   - [ ] Configurar `NODE_ENV=production`

4. **Deploy**
   - [ ] Hacer deploy manual o esperar auto-deploy
   - [ ] Verificar logs de build
   - [ ] Verificar que la aplicación está corriendo

### Railway.app

1. **Crear Proyecto**
   - [ ] Ir a railway.app
   - [ ] Crear nuevo proyecto desde GitHub
   - [ ] Seleccionar repositorio

2. **Configurar**
   - [ ] Railway detecta Node.js automáticamente
   - [ ] Agregar variables de entorno desde dashboard
   - [ ] Configurar dominio (opcional)

3. **Deploy**
   - [ ] Deploy automático al hacer push a main
   - [ ] Verificar logs

### Fly.io

1. **Instalar CLI**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Autenticar**
   ```bash
   flyctl auth login
   ```

3. **Configurar**
   - [ ] Asegurar que `fly.toml` está configurado
   - [ ] Crear volumen para persistencia:
   ```bash
   flyctl volumes create coya_data --size 1
   ```

4. **Deploy**
   ```bash
   flyctl deploy
   ```

5. **Configurar Secretos**
   ```bash
   flyctl secrets set NODE_ENV=production
   flyctl secrets set VERBOSE_LOGGING=false
   ```

## Post-Despliegue

### Verificaciones Inmediatas
- [ ] La aplicación responde en el puerto correcto
- [ ] Endpoint `/api/health` retorna `{ status: 'ok' }`
- [ ] Endpoint `/api/rates` retorna datos
- [ ] El scraping se ejecuta correctamente
- [ ] La base de datos se está poblando
- [ ] Los gráficos históricos muestran datos

### Configuración de Monitoreo
- [ ] Configurar alertas para downtime
- [ ] Configurar monitoreo de memoria
- [ ] Configurar monitoreo de errores
- [ ] Configurar backup de base de datos (si es crítico)

### Mantenimiento Regular
- [ ] Programar backups de DB semanales
- [ ] Revisar logs de errores semanalmente
- [ ] Actualizar dependencias mensualmente
- [ ] Verificar que el scraping sigue funcionando (sitios pueden cambiar)

## Comandos Útiles Post-Despliegue

### PM2
```bash
# Ver logs
pm2 logs coya

# Ver estado
pm2 status

# Reiniciar
pm2 restart coya

# Detener
pm2 stop coya

# Monitoreo en tiempo real
pm2 monit
```

### Docker
```bash
# Ver logs
docker-compose logs -f

# Reiniciar
docker-compose restart

# Detener
docker-compose down

# Rebuild y restart
docker-compose up -d --build
```

### Base de Datos
```bash
# Backup manual
cp data/exchange_rates.db backups/exchange_rates_$(date +%Y%m%d).db

# Ver tamaño de DB
du -h data/exchange_rates.db

# Ver últimos registros (requiere sqlite3)
sqlite3 data/exchange_rates.db "SELECT * FROM exchange_rates ORDER BY timestamp DESC LIMIT 10;"
```

## Troubleshooting Común

### Aplicación no arranca
1. Verificar que todas las dependencias están instaladas
2. Verificar variables de entorno
3. Verificar permisos de directorios
4. Revisar logs para errores específicos

### Scraping falla
1. Verificar conexión a internet
2. Verificar que Puppeteer puede ejecutarse (dependencias del sistema)
3. Verificar timeouts configurados
4. Revisar si los sitios objetivo cambiaron estructura

### Base de datos corrupta
1. Detener aplicación
2. Hacer backup de DB actual (por si acaso)
3. Eliminar DB corrupta
4. Reiniciar aplicación (se creará nueva DB)

### Alta memoria/CPU
1. Verificar cantidad de instancias de Puppeteer abiertas
2. Reducir frecuencia de scraping
3. Considerar aumentar recursos del servidor

## Rollback

Si algo sale mal:

### Con PM2
```bash
# Ir a commit anterior
git checkout <commit-anterior>
npm install
pm2 restart coya
```

### Con Docker
```bash
# Usar imagen anterior
docker tag coya:latest coya:backup
docker-compose down
docker-compose up -d
```

### Con Plataformas Cloud
- Render/Railway: Usar opción de rollback en dashboard
- Fly.io: `flyctl releases` y `flyctl releases rollback`

## Contacto y Soporte

Para problemas o preguntas, crear un issue en el repositorio.
