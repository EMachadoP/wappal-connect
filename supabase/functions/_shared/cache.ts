/**
 * Simple in-memory cache for Edge Functions
 * 
 * Use for data that changes infrequently (settings, configs)
 */

interface CacheEntry<T> {
    data: T;
    expires: number;
}

class MemoryCache {
    private cache: Map<string, CacheEntry<any>>;
    private defaultTTL: number;

    constructor(defaultTTLMs: number = 60000) {
        this.cache = new Map();
        this.defaultTTL = defaultTTLMs;
    }

    get<T>(key: string): T | null {
        const entry = this.cache.get(key);

        if (!entry) {
            return null;
        }

        // Check if expired
        if (Date.now() > entry.expires) {
            this.cache.delete(key);
            return null;
        }

        return entry.data as T;
    }

    set<T>(key: string, data: T, ttlMs?: number): void {
        const ttl = ttlMs ?? this.defaultTTL;

        this.cache.set(key, {
            data,
            expires: Date.now() + ttl,
        });
    }

    delete(key: string): void {
        this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
    }

    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;

        if (Date.now() > entry.expires) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    size(): number {
        // Clean expired entries first
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expires) {
                this.cache.delete(key);
            }
        }

        return this.cache.size;
    }
}

// Global cache instance (persists across function invocations in same container)
const globalCache = new MemoryCache();

export { globalCache, MemoryCache };

/**
 * Helper functions for common cache patterns
 */

export async function getCachedOrFetch<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttlMs?: number
): Promise<T> {
    // Try cache first
    const cached = globalCache.get<T>(key);
    if (cached !== null) {
        return cached;
    }

    // Fetch if not in cache
    const data = await fetchFn();
    globalCache.set(key, data, ttlMs);

    return data;
}

/**
 * Cache key builders for common patterns
 */

export const CacheKeys = {
    aiSettings: () => 'ai_settings',
    participant: (conversationId: string) => `participant:${conversationId}`,
    condominium: (id: string) => `condominium:${id}`,
    contact: (id: string) => `contact:${id}`,
    integrationSettings: () => 'integration_settings',
};
