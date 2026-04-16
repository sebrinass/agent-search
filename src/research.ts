/**
 * Research 工具模块 - 搜索融合
 * 
 * 核心功能：
 * 1. 支持并发搜索多个关键词
 * 2. 集成混合检索（RRF 融合 BM25 + 语义嵌入）
 * 3. 集成链接去重
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { logMessage } from "./logging.js";
import { fetchSinglePage } from "./search.js";
import { rerankWithHybridSearch, type SearchResult } from "./embedding.js";
import { addLinksToDedup, isLinkDuplicate } from "./cache.js";
import {
  MAX_KEYWORDS,
  SEARCH_TIMEOUT_MS,
  MAX_DESCRIPTION_LENGTH,
  SEARCH_PAGES,
  SEARCH_LANGUAGE,
  SAFE_SEARCH
} from "./config.js";

// ============ 类型定义 ============

/**
 * 搜索输入接口
 */
export interface SearchInput {
  searchedKeywords?: string[];
  site?: string;
  time_range?: string;
  lang?: string;
  safeSearch?: number;
  mode?: 'fast' | 'embedding';
}

/**
 * 单个搜索结果的接口
 */
export interface SearchResultItem {
  title: string;
  url: string;
  description: string;
}

/**
 * 每个关键词的搜索结果
 */
export interface KeywordSearchResult {
  keyword: string;
  results: SearchResultItem[];
  error?: string;
}

/**
 * Research 工具的返回结果
 */
export interface ResearchResult {
  searchResults?: KeywordSearchResult[];
  message?: string;
}

/**
 * 工具返回类型
 */
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// ============ Research Server 类 ============

/**
 * Research 服务器类
 * 管理搜索执行
 */
export class ResearchServer {
  private server: Server | null = null;

  /**
   * 设置 server 实例（用于日志和搜索）
   */
  public setServer(server: Server): void {
    this.server = server;
  }

  /**
   * 执行单个关键词搜索
   * 使用 fetchSinglePage 获取多页结果，集成混合检索和链接去重
   */
  private async searchKeyword(keyword: string, site?: string, time_range?: string, lang?: string, safeSearch?: number, mode?: 'fast' | 'embedding'): Promise<KeywordSearchResult> {
    if (!this.server) {
      return {
        keyword,
        results: [],
        error: "Server not initialized"
      };
    }

    try {
      const effectiveLang = lang || SEARCH_LANGUAGE;
      const effectiveSafeSearch = safeSearch !== undefined ? safeSearch : SAFE_SEARCH;

      const pagesToFetch = mode === 'embedding' ? SEARCH_PAGES : 1;

      const pagePromises: Promise<Array<{ title: string; content: string; url: string; score: number }>>[] = [];
      for (let page = 1; page <= pagesToFetch; page++) {
        pagePromises.push(fetchSinglePage(this.server, keyword, page, time_range, effectiveLang, effectiveSafeSearch, site));
      }

      const pageResults = await Promise.all(pagePromises);

      const seenUrls = new Set<string>();
      const rawResults: SearchResult[] = [];

      for (const results of pageResults) {
        for (const result of results) {
          if (!seenUrls.has(result.url)) {
            seenUrls.add(result.url);
            rawResults.push(result);
          }
        }
      }

      if (rawResults.length === 0) {
        return {
          keyword,
          results: []
        };
      }

      const rerankedResults = await rerankWithHybridSearch(keyword, rawResults, mode);

      const dedupedResults: SearchResultItem[] = [];
      const newUrls: string[] = [];

      for (const result of rerankedResults) {
        if (!isLinkDuplicate(result.url)) {
          dedupedResults.push({
            title: result.title,
            url: result.url,
            description: result.content.length > MAX_DESCRIPTION_LENGTH 
              ? result.content.substring(0, MAX_DESCRIPTION_LENGTH) + '...' 
              : result.content,
          });
          newUrls.push(result.url);
        }
      }

      if (newUrls.length > 0) {
        addLinksToDedup(newUrls);
      }

      return {
        keyword,
        results: dedupedResults
      };
    } catch (error: any) {
      logMessage(this.server, "error", `Search failed for keyword "${keyword}": ${error.message}`);
      return {
        keyword,
        results: [],
        error: error.message || "搜索失败"
      };
    }
  }

  /**
   * 并发执行多个关键词搜索
   */
  private async searchKeywords(
    keywords: string[],
    site?: string,
    time_range?: string,
    lang?: string,
    safeSearch?: number,
    mode?: 'fast' | 'embedding'
  ): Promise<KeywordSearchResult[]> {
    const limitedKeywords = keywords.slice(0, MAX_KEYWORDS);

    const uniqueKeywords = Array.from(new Set(limitedKeywords));

    if (uniqueKeywords.length === 0) {
      return [];
    }

    if (this.server) {
      logMessage(this.server, "info", `Research: 开始并发搜索 ${uniqueKeywords.length} 个关键词`);
    }

    const searchWithTimeout = async (keyword: string): Promise<KeywordSearchResult> => {
      const timeoutPromise = new Promise<KeywordSearchResult>((_, reject) => {
        setTimeout(() => reject(new Error('搜索超时')), SEARCH_TIMEOUT_MS);
      });

      const searchPromise = this.searchKeyword(keyword, site, time_range, lang, safeSearch, mode);

      try {
        return await Promise.race([searchPromise, timeoutPromise]);
      } catch (error: any) {
        return {
          keyword,
          results: [],
          error: error.message || '搜索超时'
        };
      }
    };

    const results = await Promise.all(uniqueKeywords.map(kw => searchWithTimeout(kw)));

    if (this.server) {
      const successCount = results.filter(r => !r.error).length;
      logMessage(this.server, "info", `Research: 搜索完成，成功 ${successCount}/${uniqueKeywords.length}`);
    }

    return results;
  }

  /**
   * 主处理方法
   */
  public async processSearch(input: SearchInput): Promise<ToolResult> {
    try {
      let searchResults: KeywordSearchResult[] | undefined;

      if (input.searchedKeywords && input.searchedKeywords.length > 0) {
        searchResults = await this.searchKeywords(input.searchedKeywords, input.site, input.time_range, input.lang, input.safeSearch, input.mode);
      }

      const result: ResearchResult = {};

      if (searchResults && searchResults.length > 0) {
        result.searchResults = searchResults;
      }

      if (input.searchedKeywords && input.searchedKeywords.length > MAX_KEYWORDS) {
        result.message = `注意：只处理了前 ${MAX_KEYWORDS} 个关键词，跳过了 ${input.searchedKeywords.length - MAX_KEYWORDS} 个`;
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error instanceof Error ? error.message : String(error), status: 'failed' }, null, 2) }],
        isError: true
      };
    }
  }
}

// ============ 工具定义 ============

/**
 * Search 工具定义
 */
export const SEARCH_TOOL: Tool = {
  name: "search",
  description: `并发搜索

功能：
1. 多关键词并发搜索（最多3个）
2. 站点、时间范围、语言过滤
3. 两种搜索模式：fast（默认，快速，日常）和 embedding（精准，慢速，高相关性，深度搜索）`,
  inputSchema: {
    type: "object",
    properties: {
      searchedKeywords: {
        type: "array",
        items: { type: "string" },
        description: "要搜索的关键词列表（最多3个并发）"
      },
      site: {
        type: "string",
        description: "限制搜索范围到具体网站域名"
      },
      time_range: {
        type: "string",
        enum: ["day", "month", "year"],
        description: "时间范围过滤：day=最近一天，month=最近一月，year=最近一年"
      },
      lang: {
        type: "string",
        description: "搜索语言（如 en, zh, all）"
      },
      safeSearch: {
        type: "number",
        enum: [0, 1, 2],
        description: "安全搜索级别：0=关闭，1=中等，2=严格"
      },
      mode: {
        type: "string",
        enum: ["fast", "embedding"],
        description: "搜索模式：fast=快速搜索(1页+BM25)，embedding=精准搜索(多页+RRF混合检索，需配置嵌入模型)"
      }
    },
    required: ["searchedKeywords"]
  }
};
