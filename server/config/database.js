'use strict';

const mongoose = require('mongoose');
const env = require('./env');

/**
 * Mask credentials in MongoDB connection string for safe logging.
 */
function maskMongoUri(uri) {
  if (!uri || typeof uri !== 'string') return '';
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
}

/**
 * Validate MongoDB URI format without exposing credentials.
 */
function validateMongoUri(uri) {
  if (!uri || typeof uri !== 'string' || !uri.trim()) {
    return {
      valid: false,
      message: 'MONGODB_URI is required but was not provided or is empty.',
    };
  }
  const trimmed = uri.trim();
  if (!trimmed.startsWith('mongodb://') && !trimmed.startsWith('mongodb+srv://')) {
    return {
      valid: false,
      message: 'MONGODB_URI is malformed. Connection string must start with "mongodb://" or "mongodb+srv://".',
    };
  }
  return { valid: true, uri: trimmed };
}

/**
 * Connect to MongoDB with timeout resilience and clear startup failure reporting.
 */
async function connectDB(options = {}) {
  const { exitOnError = true, timeoutMS = 5000 } = options;
  const validation = validateMongoUri(env.MONGODB_URI);

  if (!validation.valid) {
    const errorMsg = `[DB STARTUP ERROR] Configuration Action Required: ${validation.message}`;
    console.error(errorMsg);
    if (exitOnError) {
      process.exit(1);
    }
    throw new Error(errorMsg);
  }

  try {
    const conn = await mongoose.connect(validation.uri, {
      serverSelectionTimeoutMS: timeoutMS,
    });
    console.log('MongoDB connected:', maskMongoUri(validation.uri));
    return conn;
  } catch (err) {
    const errorMsg = `[DB CONNECTION FAILED] Unable to establish connection to MongoDB within ${timeoutMS}ms. Target: ${maskMongoUri(validation.uri)}. Detail: ${err.message}`;
    console.error(errorMsg);
    if (exitOnError) {
      process.exit(1);
    }
    throw new Error(errorMsg);
  }
}

module.exports = {
  connectDB,
  maskMongoUri,
  validateMongoUri,
};
