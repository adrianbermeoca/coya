# Dockerfile para COYA - Comparador de Tasas de Cambio

FROM node:18-slim

# Instalar dependencias del sistema para Puppeteer
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Crear directorio de la aplicación
WORKDIR /app

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias de producción
RUN npm ci --only=production

# Copiar el resto de la aplicación
COPY . .

# Crear directorio para la base de datos
RUN mkdir -p data

# Establecer variables de entorno
ENV NODE_ENV=production
ENV PORT=3006
ENV PUPPETEER_HEADLESS=true

# Exponer puerto
EXPOSE 3006

# Usuario no-root para seguridad
RUN groupadd -r coya && useradd -r -g coya coya
RUN chown -R coya:coya /app
USER coya

# Comando de inicio
CMD ["node", "server.js"]
