'use strict';

const mongoose = require('mongoose');
const env = require('./env');

/**
 * Mask credentials in MongoDB connection string for safe logging.
 * Robustly handles complex passwords containing '@' or special characters.
 */
function maskMongoUri(uri) {
  if (!uri || typeof uri !== 'string') return '';
  const atIndex = uri.lastIndexOf('@');
  if (atIndex === -1) return uri;
  const protocolIndex = uri.indexOf('://');
  if (protocolIndex === -1) return uri;
  const authPart = uri.substring(protocolIndex + 3, atIndex);
  const colonIndex = authPart.indexOf(':');
  if (colonIndex === -1) return uri;
  const user = authPart.substring(0, colonIndex);
  return `${uri.substring(0, protocolIndex + 3)}${user}:****@${uri.substring(atIndex + 1)}`;
}

/**
 * Validate MongoDB URI format without exposing credentials.
 */
function validateMongoUri(uri, nodeEnv = env.NODE_ENV) {
  if (!uri || typeof uri !== 'string' || !uri.trim()) {
    return {
      valid: false,
      message:
        'MONGODB_URI environment variable is required. For production hosting (e.g., Render, Railway), provide your MongoDB Atlas connection string (e.g., mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/penzo?retryWrites=true&w=majority).',
    };
  }
  const trimmed = uri.trim();
  if (!trimmed.startsWith('mongodb://') && !trimmed.startsWith('mongodb+srv://')) {
    return {
      valid: false,
      message: 'MONGODB_URI is malformed. Connection string must start with "mongodb://" or "mongodb+srv://".',
    };
  }
  if (nodeEnv === 'production' && (trimmed.includes('127.0.0.1') || trimmed.includes('localhost'))) {
    return {
      valid: false,
      message:
        'MONGODB_URI points to localhost (127.0.0.1) in production mode. Cloud hosting platforms do not run a local MongoDB instance. Please configure MONGODB_URI in your hosting platform dashboard with a cloud database URI from MongoDB Atlas (e.g., mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/penzo?retryWrites=true&w=majority).',
    };
  }
  return { valid: true, uri: trimmed };
}

/**
 * Check whether the active Mongoose connection is ready.
 */
function isDBConnected() {
  return mongoose.connection.readyState === 1;
}

// Setup connection lifecycle event handlers once
mongoose.connection.on('disconnected', () => {
  console.warn('[DB] Mongoose connection lost. Awaiting automatic reconnection...');
});
mongoose.connection.on('reconnected', () => {
  console.log('[DB] Mongoose connection re-established.');
});
mongoose.connection.on('error', (err) => {
  console.error('[DB] Mongoose connection error event:', err.message);
});

/**
 * Connect to MongoDB with timeout resilience, retries, and clear startup failure reporting.
 */
async function connectDB(options = {}) {
  const { exitOnError = true, timeoutMS = 15000, maxRetries = 3 } = options;
  const validation = validateMongoUri(env.MONGODB_URI);

  if (!validation.valid) {
    const errorBox = [
      '',
      '================================================================================',
      '[DATABASE CONFIGURATION ERROR]',
      validation.message,
      '================================================================================',
      '',
    ].join('\n');
    console.error(errorBox);
    if (exitOnError) {
      process.exit(1);
    }
    throw new Error(validation.message);
  }

  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    try {
      if (attempt > 1) {
        console.log(`[DB] Connection retry ${attempt}/${maxRetries} to MongoDB...`);
      }
      const conn = await mongoose.connect(validation.uri, {
        serverSelectionTimeoutMS: timeoutMS,
        maxPoolSize: 10,
        socketTimeoutMS: 45000,
      });
      console.log('MongoDB connected:', maskMongoUri(validation.uri));
      return conn;
    } catch (err) {
      const isLastAttempt = attempt >= maxRetries;
      const errorMsg = `[DB CONNECTION FAILED] Attempt ${attempt}/${maxRetries} to connect to ${maskMongoUri(
        validation.uri
      )} failed after ${timeoutMS}ms. Error: ${err.message}`;
      console.error(errorMsg);

      if (isLastAttempt) {
        if (exitOnError) {
          process.exit(1);
        }
        throw new Error(errorMsg);
      }

      // Exponential backoff between retries (2s, 4s)
      const delayMs = attempt * 2000;
      console.log(`[DB] Retrying in ${delayMs / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = {
  connectDB,
  isDBConnected,
  maskMongoUri,
  validateMongoUri,
};
