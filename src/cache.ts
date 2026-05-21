import crypto from 'crypto';
import QuickLRU from 'quick-lru';
import {
  LINK_DEDUP_TTL,
  URL_CACHE_TTL,
  URL_CACHE_SIZE,
  EMBEDDING_CACHE_SIZE
} from "./config.js";

const LINK_DEDUP_TTL_MS = LINK_DEDUP_TTL * 1000;
const URL_CACHE_TTL_MS = URL_CACHE_TTL * 1000;
const EMBEDDING_CACHE_TTL = 30 * 60 * 1000;


// ============ 类型定义 ============
interface UrlCacheValue {
  htmlContent: string;
  markdownContent: string;
  timestamp: number;
}

// ============ 1. 链接去重池 ============
/**
 * 链接去重池
 * - 大小：100条
 * - TTL：可配置，默认60秒
 * - 功能：避免返回重复链接
 */
class LinkDedupPool {
  private pool: QuickLRU<string, number>;

  constructor() {
    this.pool = new QuickLRU<string, number>({
      maxSize: 100,
      maxAge: LINK_DEDUP_TTL_MS
    });
  }

  /**
   * 检查链接是否重复
   */
  isDuplicate(url: string): boolean {
    return this.pool.has(url);
  }

  /**
   * 添加链接到池
   */
  add(url: string): void {
    this.pool.set(url, Date.now());
  }

  /**
   * 批量添加链接
   */
  addBatch(urls: string[]): void {
    const now = Date.now();
    for (const url of urls) {
      this.pool.set(url, now);
    }
  }

  /**
   * 清空池
   */
  clear(): void {
    this.pool.clear();
  }

  /**
   * 获取统计信息
   */
  getStats(): { size: number; maxSize: number } {
    return {
      size: this.pool.size,
      maxSize: this.pool.maxSize
    };
  }
}

// ============ 2. URL内容缓存 ============
/**
 * URL内容缓存
 * - 大小：可配置，默认200条
 * - TTL：可配置，默认60秒
 * - 功能：缓存URL对应的页面内容
 */
class UrlContentCache {
  private cache: QuickLRU<string, UrlCacheValue>;

  constructor() {
    this.cache = new QuickLRU<string, UrlCacheValue>({
      maxSize: URL_CACHE_SIZE,
      maxAge: URL_CACHE_TTL_MS
    });
  }

  /**
   * 获取缓存内容
   */
  get(url: string): UrlCacheValue | null {
    const entry = this.cache.get(url);
    return entry ?? null;
  }

  /**
   * 设置缓存内容
   */
  set(url: string, htmlContent: string, markdownContent: string): void {
    this.cache.set(url, {
      htmlContent,
      markdownContent,
      timestamp: Date.now()
    });
  }

  /**
   * 检查是否存在
   */
  has(url: string): boolean {
    return this.cache.has(url);
  }

  /**
   * 删除单个缓存
   */
  delete(url: string): boolean {
    return this.cache.delete(url);
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取统计信息
   */
  getStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.cache.maxSize
    };
  }
}

// ============ 3. 嵌入缓存 ============
/**
 * 嵌入缓存
 * - 大小：可配置，默认500条
 * - TTL：30分钟（固定）
 * - 存储格式：Float32Array
 * - 键：文本内容的MD5 hash
 */
class EmbeddingCache {
  private cache: QuickLRU<string, Float32Array>;

  constructor() {
    this.cache = new QuickLRU<string, Float32Array>({
      maxSize: EMBEDDING_CACHE_SIZE,
      maxAge: EMBEDDING_CACHE_TTL
    });
  }

  private hashText(text: string): string {
    return crypto.createHash('md5').update(text).digest('hex');
  }

  get(text: string): Float32Array | null {
    const key = this.hashText(text);
    return this.cache.get(key) ?? null;
  }

  set(text: string, embedding: Float32Array | number[]): void {
    const key = this.hashText(text);
    const float32 = embedding instanceof Float32Array
      ? embedding
      : new Float32Array(embedding);
    this.cache.set(key, float32);
  }

  has(text: string): boolean {
    const key = this.hashText(text);
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): { size: number; maxSize: number; estimatedMemoryMB: number } {
    const avgDimensions = 1024;
    const bytesPerElement = 4;
    const bytesPerEntry = avgDimensions * bytesPerElement;
    const totalBytes = this.cache.size * bytesPerEntry;
    return {
      size: this.cache.size,
      maxSize: this.cache.maxSize,
      estimatedMemoryMB: Math.round(totalBytes / 1024 / 1024 * 100) / 100
    };
  }
}

// ============ 导出实例和接口 ============

// 单例实例
export const linkDedupPool = new LinkDedupPool();
export const urlContentCache = new UrlContentCache();
export const embeddingCache = new EmbeddingCache();

// 便捷函数：链接去重
export function isLinkDuplicate(url: string): boolean {
  return linkDedupPool.isDuplicate(url);
}

export function addLinksToDedup(urls: string[]): void {
  linkDedupPool.addBatch(urls);
}

// 导出类型
export type { UrlCacheValue };
