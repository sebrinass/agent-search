import crypto from 'crypto';
import QuickLRU from 'quick-lru';

// ============ 环境变量配置 ============
const LINK_DEDUP_TTL = parseInt(process.env.LINK_DEDUP_TTL || '60', 10) * 1000; // 转为毫秒
const URL_CACHE_TTL = parseInt(process.env.URL_CACHE_TTL || '60', 10) * 1000; // 转为毫秒
const URL_CACHE_SIZE = parseInt(process.env.URL_CACHE_SIZE || '200', 10);
const EMBEDDING_CACHE_SIZE = parseInt(process.env.EMBEDDING_CACHE_SIZE || '500', 10);
const EMBEDDING_CACHE_TTL = 30 * 60 * 1000; // 30分钟，固定值

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
      maxAge: LINK_DEDUP_TTL
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
      maxAge: URL_CACHE_TTL
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
 * - 存储格式：Float16Array（节省50%内存）
 * - 键：文本内容的MD5 hash
 */
class EmbeddingCache {
  private cache: QuickLRU<string, Uint16Array>; // Float16Array在JS中用Uint16Array存储

  constructor() {
    this.cache = new QuickLRU<string, Uint16Array>({
      maxSize: EMBEDDING_CACHE_SIZE,
      maxAge: EMBEDDING_CACHE_TTL
    });
  }

  /**
   * 生成文本的MD5 hash作为键
   */
  private hashText(text: string): string {
    return crypto.createHash('md5').update(text).digest('hex');
  }

  /**
   * 将Float32Array转换为Float16Array（用Uint16Array存储）
   * 节省50%内存
   */
  private float32ToFloat16(float32: Float32Array): Uint16Array {
    const float16 = new Uint16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      // 简化的Float16转换（精度略有损失，但足够用于嵌入向量）
      float16[i] = this.toFloat16(float32[i]);
    }
    return float16;
  }

  /**
   * 将Float16Array转换回Float32Array
   */
  private float16ToFloat32(float16: Uint16Array): Float32Array {
    const float32 = new Float32Array(float16.length);
    for (let i = 0; i < float16.length; i++) {
      float32[i] = this.fromFloat16(float16[i]);
    }
    return float32;
  }

  /**
   * 单个float32转float16
   */
  private toFloat16(value: number): number {
    const float32 = new Float32Array(1);
    float32[0] = value;
    const buffer = new ArrayBuffer(2);
    const float16View = new DataView(buffer);
    
    // 简化转换：直接截断精度
    const sign = Math.sign(value);
    const absValue = Math.abs(value);
    
    if (absValue === 0) return 0;
    if (absValue > 65504) return sign > 0 ? 0x7C00 : 0xFC00; // Infinity
    if (Number.isNaN(value)) return 0x7E00; // NaN
    
    // 使用简单的缩放方法
    const exponent = Math.floor(Math.log2(absValue));
    const mantissa = absValue / Math.pow(2, exponent) - 1;
    
    const exp16 = exponent + 15;
    const mant16 = Math.round(mantissa * 1024);
    
    const bits = (sign > 0 ? 0 : 0x8000) | ((exp16 & 0x1F) << 10) | (mant16 & 0x3FF);
    return bits;
  }

  /**
   * 单个float16转float32
   */
  private fromFloat16(bits: number): number {
    const sign = (bits & 0x8000) >> 15;
    const exponent = (bits & 0x7C00) >> 10;
    const mantissa = bits & 0x03FF;
    
    if (exponent === 0) {
      // 非规格化数
      return sign ? -mantissa / 1024 * Math.pow(2, -14) : mantissa / 1024 * Math.pow(2, -14);
    }
    if (exponent === 31) {
      // Infinity 或 NaN
      return mantissa === 0 ? (sign ? -Infinity : Infinity) : NaN;
    }
    
    const value = (1 + mantissa / 1024) * Math.pow(2, exponent - 15);
    return sign ? -value : value;
  }

  /**
   * 获取嵌入向量
   */
  get(text: string): Float32Array | null {
    const key = this.hashText(text);
    const float16 = this.cache.get(key);
    if (!float16) return null;
    return this.float16ToFloat32(float16);
  }

  /**
   * 设置嵌入向量
   */
  set(text: string, embedding: Float32Array | number[]): void {
    const key = this.hashText(text);
    const float32 = embedding instanceof Float32Array 
      ? embedding 
      : new Float32Array(embedding);
    const float16 = this.float32ToFloat16(float32);
    this.cache.set(key, float16);
  }

  /**
   * 检查是否存在
   */
  has(text: string): boolean {
    const key = this.hashText(text);
    return this.cache.has(key);
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
  getStats(): { size: number; maxSize: number; estimatedMemoryMB: number } {
    // 估算内存使用：每条嵌入向量约 1024 维 * 2 字节 = 2KB
    // 500条约 1MB
    const avgDimensions = 1024; // qwen3-embedding-0.6B 输出维度
    const bytesPerEntry = avgDimensions * 2; // Float16 = 2 bytes
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

export function addLinkToDedup(url: string): void {
  linkDedupPool.add(url);
}

export function addLinksToDedup(urls: string[]): void {
  linkDedupPool.addBatch(urls);
}

export function clearLinkDedup(): void {
  linkDedupPool.clear();
}

export function getLinkDedupStats(): ReturnType<LinkDedupPool['getStats']> {
  return linkDedupPool.getStats();
}

// 便捷函数：URL内容缓存
export function getUrlCache(url: string): UrlCacheValue | null {
  return urlContentCache.get(url);
}

export function setUrlCache(url: string, htmlContent: string, markdownContent: string): void {
  urlContentCache.set(url, htmlContent, markdownContent);
}

export function hasUrlCache(url: string): boolean {
  return urlContentCache.has(url);
}

export function deleteUrlCache(url: string): boolean {
  return urlContentCache.delete(url);
}

export function clearUrlCache(): void {
  urlContentCache.clear();
}

export function getUrlCacheStats(): ReturnType<UrlContentCache['getStats']> {
  return urlContentCache.getStats();
}

// 兼容旧版API：导出urlCache实例（与旧版保持一致）
export const urlCache = {
  get: (url: string) => urlContentCache.get(url),
  set: (url: string, htmlContent: string, markdownContent: string) => urlContentCache.set(url, htmlContent, markdownContent),
  has: (url: string) => urlContentCache.has(url),
  delete: (url: string) => urlContentCache.delete(url),
  clear: () => urlContentCache.clear()
};

// 便捷函数：嵌入缓存
export function getEmbeddingCache(text: string): Float32Array | null {
  return embeddingCache.get(text);
}

export function setEmbeddingCache(text: string, embedding: Float32Array | number[]): void {
  embeddingCache.set(text, embedding);
}

export function hasEmbeddingCache(text: string): boolean {
  return embeddingCache.has(text);
}

export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}

export function getEmbeddingCacheStats(): ReturnType<EmbeddingCache['getStats']> {
  return embeddingCache.getStats();
}

// 统一清空所有缓存
export function clearAllCaches(): void {
  linkDedupPool.clear();
  urlContentCache.clear();
  embeddingCache.clear();
}

// 获取所有缓存的统计信息
export function getAllCacheStats(): {
  linkDedup: ReturnType<LinkDedupPool['getStats']>;
  urlContent: ReturnType<UrlContentCache['getStats']>;
  embedding: ReturnType<EmbeddingCache['getStats']>;
} {
  return {
    linkDedup: linkDedupPool.getStats(),
    urlContent: urlContentCache.getStats(),
    embedding: embeddingCache.getStats()
  };
}

// 导出类型
export type { UrlCacheValue };
