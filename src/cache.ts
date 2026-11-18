import crypto from 'crypto';
import QuickLRU from 'quick-lru';
import { normalizeUrl } from './url-normalize.js';
import {
  LINK_DEDUP_TTL,
  LINK_DEDUP_SIZE,
  URL_CACHE_TTL,
  URL_CACHE_SIZE,
  RERANK_CACHE_SIZE,
} from "./config.js";

const LINK_DEDUP_TTL_MS = LINK_DEDUP_TTL * 1000;
const URL_CACHE_TTL_MS = URL_CACHE_TTL * 1000;


// ============ 类型定义 ============
interface UrlCacheValue {
  htmlContent: string;
  markdownContent: string;
  timestamp: number;
}

// ============ 1. 链接去重池 ============
/**
 * 链接去重池
 * - 大小：可配置（LINK_DEDUP_SIZE，默认 500）
 * - TTL：可配置（LINK_DEDUP_TTL，默认 60 秒）
 * - 功能：避免同一轮对话内重复返回同一条链接
 * - 注意：进程级单例，HTTP 模式下所有会话共享，故 TTL 不宜过长
 */
class LinkDedupPool {
  private pool: QuickLRU<string, number>;

  constructor() {
    this.pool = new QuickLRU<string, number>({
      maxSize: LINK_DEDUP_SIZE,
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

// ============ 3. Rerank 结果缓存 ============
/**
 * Rerank 结果缓存
 * - 大小：可配置，默认 100 条
 * - TTL：30 分钟（固定）
 * - 键：query + 文档 URL 列表的 MD5 hash
 * - 值：rerank 后的 ScoredResult 数组
 */
class RerankCache {
  private cache: QuickLRU<string, unknown[]>;

  constructor() {
    this.cache = new QuickLRU<string, unknown[]>({
      maxSize: RERANK_CACHE_SIZE,
      maxAge: 30 * 60 * 1000,
    });
  }

  private buildKey(query: string, docUrls: string[]): string {
    const sorted = [...docUrls].sort();
    const raw = `${query}||${sorted.join('|')}`;
    return crypto.createHash('md5').update(raw).digest('hex');
  }

  get(query: string, docUrls: string[]): unknown[] | null {
    const key = this.buildKey(query, docUrls);
    const entry = this.cache.get(key);
    return entry ? (Array.isArray(entry) ? entry : null) : null;
  }

  set(query: string, docUrls: string[], results: unknown[]): void {
    const key = this.buildKey(query, docUrls);
    this.cache.set(key, results);
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.cache.maxSize,
    };
  }
}

// ============ 导出实例和接口 ============

// 单例实例
export const linkDedupPool = new LinkDedupPool();
export const urlContentCache = new UrlContentCache();
export const rerankCache = new RerankCache();

// 便捷函数：链接去重（统一走 URL 规范化，避免 utm/www/锚点等写法差异导致漏去重）
export function isLinkDuplicate(url: string): boolean {
  return linkDedupPool.isDuplicate(normalizeUrl(url));
}

export function addLinksToDedup(urls: string[]): void {
  linkDedupPool.addBatch(urls.map(normalizeUrl));
}

// 导出类型
export type { UrlCacheValue };
