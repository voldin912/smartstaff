/**
 * Cache middleware for Express routes
 * Supports ETag-based conditional requests and automatic caching
 */

import cache from '../utils/cache.js';
import logger from '../utils/logger.js';

/**
 * Generate cache key from request
 */
export const getCacheKey = (req, options = {}) => {
  const { prefix, includeQuery = true, includeParams = false } = options;
  const { user } = req;
  
  let key = prefix || '';
  
  // Include company_id if available
  if (user?.company_id) {
    key += `:company:${user.company_id}`;
  } else if (user?.role === 'admin') {
    key += `:admin`;
  }
  
  // Include user_id if needed
  if (options.includeUserId && user?.id) {
    key += `:user:${user.id}`;
  }
  
  // Include query parameters
  if (includeQuery && Object.keys(req.query).length > 0) {
    const queryStr = Object.entries(req.query)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(':');
    key += `:${queryStr}`;
  }
  
  // Include route parameters
  if (includeParams && req.params) {
    const paramStr = Object.entries(req.params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(':');
    if (paramStr) {
      key += `:${paramStr}`;
    }
  }
  
  return key;
};

/**
 * Check If-None-Match header and return 304 if ETag matches
 */
export const checkETag = (req, etag) => {
  const ifNoneMatch = req.headers['if-none-match'];
  
  if (ifNoneMatch) {
    // Remove "W/" prefix if present (weak ETag)
    const cleanETag = etag.replace(/^W\//, '');
    const cleanIfNoneMatch = ifNoneMatch.replace(/^W\//, '').replace(/"/g, '');
    
    if (cleanETag === cleanIfNoneMatch) {
      return true; // ETag matches, should return 304
    }
  }
  
  return false;
};

/**
 * Set ETag response header
 */
export const setETagHeader = (res, etag) => {
  res.set('ETag', `W/"${etag}"`); // Weak ETag for dynamic content
};

/**
 * Cache middleware factory
 * 
 * @param {Object} options - Cache options
 * @param {string} options.prefix - Cache key prefix (required)
 * @param {number} options.ttl - Cache TTL in seconds (default: from env or 30)
 * @param {boolean} options.includeQuery - Include query params in key (default: true)
 * @param {boolean} options.includeParams - Include route params in key (default: false)
 * @param {boolean} options.includeUserId - Include user ID in key (default: false)
 * @param {Function} options.keyGenerator - Custom key generator function
 * @param {Function} options.shouldCache - Function to determine if response should be cached (default: always cache)
 */
export const cacheMiddleware = (options = {}) => {
  const {
    prefix,
    ttl = parseInt(process.env.CACHE_TTL_SECONDS || '30'),
    includeQuery = true,
    includeParams = false,
    includeUserId = false,
    keyGenerator,
    shouldCache = () => true
  } = options;

  if (!prefix && !keyGenerator) {
    throw new Error('Cache middleware requires either prefix or keyGenerator option');
  }

  return async (req, res, next) => {
    // Skip caching if disabled
    if (process.env.CACHE_ENABLED === 'false') {
      return next();
    }

    // Generate cache key
    const cacheKey = keyGenerator 
      ? keyGenerator(req)
      : getCacheKey(req, { prefix, includeQuery, includeParams, includeUserId });

    // Check cache
    const cached = cache.get(cacheKey);
    
    if (cached) {
      // Check ETag
      if (checkETag(req, cached.etag)) {
        logger.debug('Cache hit (ETag match)', { cacheKey });
        return res.status(304).end(); // Not Modified
      }

      // Return cached data
      logger.debug('Cache hit', { cacheKey });
      setETagHeader(res, cached.etag);
      return res.json(cached.data);
    }

    // Cache miss - intercept response
    logger.debug('Cache miss', { cacheKey });
    
    // Store original json method
    const originalJson = res.json.bind(res);
    
    // Override json method to cache response
    res.json = function(data) {
      // Check if response should be cached
      if (shouldCache(req, res, data)) {
        // Get company_id for cache entry
        const companyId = req.user?.company_id || null;
        
        // Cache the response
        cache.set(cacheKey, data, ttl, companyId);
        
        // Set ETag header
        const etag = cache.generateETag(data);
        setETagHeader(res, etag);
        
        logger.debug('Response cached', { cacheKey, ttl });
      }
      
      // Call original json method
      return originalJson(data);
    };

    next();
  };
};

export default cacheMiddleware;
