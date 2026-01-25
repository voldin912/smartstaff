/**
 * In-memory cache utility with LRU eviction, TTL support, and ETag generation
 * Supports company-level caching with pattern-based invalidation
 */

import crypto from 'crypto';

// Cache configuration
const CACHE_TTL_SECONDS = parseInt(process.env.CACHE_TTL_SECONDS || '30');
const CACHE_MAX_SIZE = parseInt(process.env.CACHE_MAX_SIZE || '1000');
const CACHE_ENABLED = process.env.CACHE_ENABLED !== 'false';

// Cache entry structure
class CacheEntry {
  constructor(data, ttlSeconds, companyId = null) {
    this.data = data;
    this.etag = this.generateETag(data);
    this.expiresAt = Date.now() + (ttlSeconds * 1000);
    this.companyId = companyId;
    this.lastAccessed = Date.now();
  }

  generateETag(data) {
    const jsonString = JSON.stringify(data);
    return crypto.createHash('md5').update(jsonString).digest('hex');
  }

  isExpired() {
    return Date.now() > this.expiresAt;
  }

  touch() {
    this.lastAccessed = Date.now();
  }
}

// In-memory cache store
class CacheStore {
  constructor(maxSize = CACHE_MAX_SIZE) {
    this.store = new Map();
    this.maxSize = maxSize;
  }

  get(key) {
    const entry = this.store.get(key);
    
    if (!entry) {
      return null;
    }

    // Check if expired
    if (entry.isExpired()) {
      this.store.delete(key);
      return null;
    }

    // Update last accessed time (for LRU)
    entry.touch();
    return entry;
  }

  set(key, data, ttlSeconds = CACHE_TTL_SECONDS, companyId = null) {
    // If cache is full, remove least recently used entry
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      this.evictLRU();
    }

    const entry = new CacheEntry(data, ttlSeconds, companyId);
    this.store.set(key, entry);
    
    return entry;
  }

  delete(key) {
    return this.store.delete(key);
  }

  // Evict least recently used entry
  evictLRU() {
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.store.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.store.delete(oldestKey);
    }
  }

  // Invalidate entries matching a pattern
  invalidatePattern(pattern) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    let count = 0;

    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        this.store.delete(key);
        count++;
      }
    }

    return count;
  }

  // Invalidate all entries for a specific company
  invalidateCompany(companyId) {
    let count = 0;
    for (const [key, entry] of this.store.entries()) {
      if (entry.companyId === companyId) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  // Clean expired entries
  cleanExpired() {
    let count = 0;
    for (const [key, entry] of this.store.entries()) {
      if (entry.isExpired()) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  // Get cache statistics
  getStats() {
    return {
      size: this.store.size,
      maxSize: this.maxSize,
      entries: Array.from(this.store.keys())
    };
  }

  // Clear all cache
  clear() {
    this.store.clear();
  }
}

// Singleton cache instance
const cacheStore = new CacheStore(CACHE_MAX_SIZE);

// Periodic cleanup of expired entries (every 60 seconds)
if (CACHE_ENABLED) {
  setInterval(() => {
    cacheStore.cleanExpired();
  }, 60000);
}

// Public API
export const cache = {
  get: (key) => {
    if (!CACHE_ENABLED) return null;
    const entry = cacheStore.get(key);
    return entry ? { data: entry.data, etag: entry.etag } : null;
  },

  set: (key, data, ttlSeconds = CACHE_TTL_SECONDS, companyId = null) => {
    if (!CACHE_ENABLED) return null;
    return cacheStore.set(key, data, ttlSeconds, companyId);
  },

  delete: (key) => {
    if (!CACHE_ENABLED) return false;
    return cacheStore.delete(key);
  },

  invalidatePattern: (pattern) => {
    if (!CACHE_ENABLED) return 0;
    return cacheStore.invalidatePattern(pattern);
  },

  invalidateCompany: (companyId) => {
    if (!CACHE_ENABLED) return 0;
    return cacheStore.invalidateCompany(companyId);
  },

  generateETag: (data) => {
    const jsonString = JSON.stringify(data);
    return crypto.createHash('md5').update(jsonString).digest('hex');
  },

  getStats: () => {
    return cacheStore.getStats();
  },

  clear: () => {
    cacheStore.clear();
  }
};

export default cache;
