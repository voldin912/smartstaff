/**
 * Logger utility with log level control
 * Supports: debug, info, warn, error
 * Environment-based: debug logs disabled in production
 */

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Get current log level from environment
const getLogLevel = () => {
  // Check LOG_LEVEL env var first
  const envLogLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLogLevel && LOG_LEVELS.hasOwnProperty(envLogLevel)) {
    return LOG_LEVELS[envLogLevel];
  }
  
  // Default based on NODE_ENV
  const isProduction = process.env.NODE_ENV === 'production';
  return isProduction ? LOG_LEVELS.info : LOG_LEVELS.debug;
};

const currentLogLevel = getLogLevel();

// Format log message with timestamp and structured data
const formatLog = (level, message, data = null) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level: level.toUpperCase(),
    message,
  };
  
  if (data !== null && data !== undefined) {
    // Handle Error objects specially
    if (data instanceof Error) {
      logEntry.error = {
        message: data.message,
        stack: data.stack,
        name: data.name,
      };
    } else {
      logEntry.data = data;
    }
  }
  
  return logEntry;
};

// Output log to console (can be extended to file/remote logging)
const outputLog = (level, message, data = null) => {
  const logEntry = formatLog(level, message, data);
  
  // Use appropriate console method
  switch (level) {
    case 'error':
      console.error(JSON.stringify(logEntry));
      break;
    case 'warn':
      console.warn(JSON.stringify(logEntry));
      break;
    default:
      console.log(JSON.stringify(logEntry));
  }
};

// Logger object with level-specific methods
export const logger = {
  debug: (message, data = null) => {
    if (currentLogLevel <= LOG_LEVELS.debug) {
      outputLog('debug', message, data);
    }
  },
  
  info: (message, data = null) => {
    if (currentLogLevel <= LOG_LEVELS.info) {
      outputLog('info', message, data);
    }
  },
  
  warn: (message, data = null) => {
    if (currentLogLevel <= LOG_LEVELS.warn) {
      outputLog('warn', message, data);
    }
  },
  
  error: (message, error = null) => {
    if (currentLogLevel <= LOG_LEVELS.error) {
      outputLog('error', message, error);
    }
  },
};

export default logger;
