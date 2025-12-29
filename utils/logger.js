/**
 * Logger utility para producción y desarrollo
 * En producción solo muestra errores, en desarrollo muestra todo
 */

const isDevelopment = process.env.NODE_ENV !== 'production';
const isVerbose = process.env.VERBOSE_LOGGING === 'true';

class Logger {
    constructor(context = 'APP') {
        this.context = context;
    }

    _formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const emoji = {
            'INFO': 'ℹ️',
            'SUCCESS': '✅',
            'WARNING': '⚠️',
            'ERROR': '❌',
            'DEBUG': '🔍'
        }[level] || '📝';

        let formattedMsg = `[${timestamp}] ${emoji} [${this.context}] ${message}`;

        if (data !== null && data !== undefined) {
            formattedMsg += ` ${typeof data === 'object' ? JSON.stringify(data) : data}`;
        }

        return formattedMsg;
    }

    info(message, data = null) {
        if (isDevelopment || isVerbose) {
            console.log(this._formatMessage('INFO', message, data));
        }
    }

    success(message, data = null) {
        if (isDevelopment || isVerbose) {
            console.log(this._formatMessage('SUCCESS', message, data));
        }
    }

    warn(message, data = null) {
        if (isDevelopment || isVerbose) {
            console.warn(this._formatMessage('WARNING', message, data));
        }
    }

    error(message, error = null) {
        // Los errores SIEMPRE se muestran, incluso en producción
        console.error(this._formatMessage('ERROR', message, error?.message || error));
        if (error?.stack && isDevelopment) {
            console.error(error.stack);
        }
    }

    debug(message, data = null) {
        // Debug solo en desarrollo con verbose
        if (isDevelopment && isVerbose) {
            console.log(this._formatMessage('DEBUG', message, data));
        }
    }

    // Alias de métodos comunes
    log(message, data = null) {
        this.info(message, data);
    }
}

// Exportar factory function
function createLogger(context) {
    return new Logger(context);
}

// Exportar logger por defecto
const defaultLogger = new Logger('SERVER');

module.exports = {
    createLogger,
    logger: defaultLogger,
    Logger
};
