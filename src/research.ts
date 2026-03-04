/**
 * Research 工具模块 - 思考 + 搜索融合
 * 
 * 核心功能：
 * 1. 记录每一步思考过程
 * 2. 支持并发搜索多个关键词
 * 3. 追踪搜索历史和决策过程
 * 4. 集成混合检索（RRF 融合 BM25 + 语义嵌入）
 * 5. 集成链接去重
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { logMessage } from "./logging.js";
import { rerankWithHybridSearch, type SearchResult, type ScoredResult } from "./embedding.js";
import { addLinksToDedup, isLinkDuplicate } from "./cache.js";
import {
  MAX_THOUGHTS,
  MAX_KEYWORDS,
  SEARCH_TIMEOUT_MS,
  MAX_DESCRIPTION_LENGTH,
  SEARXNG_URL,
  SEARCH_PAGES,
  SEARCH_LANGUAGE,
  SAFE_SEARCH,
  DEFAULT_SEARCH_PAGES,
  isEmbeddingEnabled,
  getResearchConfig
} from "./config.js";

// ============ 类型定义 ============

/**
 * 思考数据接口 - 所有必填参数
 */
export interface ThoughtData {
  /** 当前思考内容 */
  thought: string;
  /** 当前思考步骤编号 */
  thoughtNumber: number;
  /** 预计总思考步骤数 */
  totalThoughts: number;
  /** 已搜索的关键词（可选） */
  searchedKeywords?: string[];
  /** 是否需要继续思考 */
  nextThoughtNeeded: boolean;
  /** 限制搜索范围到具体网站（可选） */
  site?: string;
  /** 时间范围过滤（可选）：day, month, year */
  time_range?: string;
}

/**
 * 单个搜索结果的接口
 */
export interface SearchResultItem {
  title: string;
  url: string;
  description: string;
  relevance: number;
}

/**
 * 每个关键词的搜索结果
 */
export interface KeywordSearchResult {
  keyword: string;
  cached: boolean;
  matchedKeyword?: string;
  resultCount: number;
  results: SearchResultItem[];
  error?: string;
}

/**
 * Research 工具的返回结果
 */
export interface ResearchResult {
  thoughtStatus: {
    thoughtNumber: number;
    totalThoughts: number;
    nextThoughtNeeded: boolean;
    thoughtHistoryLength: number;
    branches: string[];
  };
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
 * 管理思考历史和执行搜索
 */
export class ResearchServer {
  private thoughtHistory: ThoughtData[] = [];
  private branches: Record<string, ThoughtData[]> = {};
  private server: Server | null = null;

  /**
   * 设置 server 实例（用于日志和搜索）
   */
  public setServer(server: Server): void {
    this.server = server;
  }

  private async performSearXNGSearch(keyword: string, site?: string, time_range?: string): Promise<SearchResult[]> {
    if (!this.server) {
      throw new Error("Server not initialized");
    }

    if (!SEARXNG_URL) {
      throw new Error("SEARXNG_URL not configured");
    }

    const baseUrl = SEARXNG_URL.endsWith('/') ? SEARXNG_URL : SEARXNG_URL + '/';
    
    let query = keyword;
    if (site) {
      query = `site:${site} ${keyword}`;
    }

    const pagePromises: Promise<{ results?: Array<{ title?: string; content?: string; url?: string; score?: number }> }>[] = [];
    
    for (let page = 1; page <= SEARCH_PAGES; page++) {
      const url = new URL('search', baseUrl);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      url.searchParams.set("pageno", page.toString());

      if (SEARCH_LANGUAGE !== "all") {
        url.searchParams.set("language", SEARCH_LANGUAGE);
      }

      url.searchParams.set("safesearch", SAFE_SEARCH.toString());

      if (time_range && ["day", "month", "year"].includes(time_range)) {
        url.searchParams.set("time_range", time_range);
      }

      pagePromises.push(
        fetch(url.toString(), {
          method: "GET",
          headers: { 'Accept': 'application/json' }
        }).then(r => r.json())
      );
    }

    try {
      const pageResults = await Promise.all(pagePromises);
      
      const seenUrls = new Set<string>();
      const allResults: SearchResult[] = [];
      
      for (const data of pageResults) {
        if (data.results) {
          for (const result of data.results) {
            const url = result.url || "";
            if (url && !seenUrls.has(url)) {
              seenUrls.add(url);
              allResults.push({
                title: result.title || "",
                content: result.content || "",
                url: url,
                score: result.score || 0,
              });
            }
          }
        }
      }

      return allResults;
    } catch (error) {
      throw error;
    }
  }

  /**
   * 执行单个关键词搜索
   * 集成混合检索和链接去重
   */
  private async searchKeyword(keyword: string, site?: string, time_range?: string): Promise<KeywordSearchResult> {
    if (!this.server) {
      return {
        keyword,
        cached: false,
        resultCount: 0,
        results: [],
        error: "Server not initialized"
      };
    }

    try {
      const rawResults = await this.performSearXNGSearch(keyword, site, time_range);

      if (rawResults.length === 0) {
        return {
          keyword,
          cached: false,
          resultCount: 0,
          results: []
        };
      }

      const rerankedResults = await rerankWithHybridSearch(keyword, rawResults);

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
            relevance: result.rrfScore
          });
          newUrls.push(result.url);
        }
      }

      if (newUrls.length > 0) {
        addLinksToDedup(newUrls);
      }

      return {
        keyword,
        cached: false,
        resultCount: dedupedResults.length,
        results: dedupedResults
      };
    } catch (error: any) {
      logMessage(this.server, "error", `Search failed for keyword "${keyword}": ${error.message}`);
      return {
        keyword,
        cached: false,
        resultCount: 0,
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
    time_range?: string
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

      const searchPromise = this.searchKeyword(keyword, site, time_range);

      try {
        return await Promise.race([searchPromise, timeoutPromise]);
      } catch (error: any) {
        return {
          keyword,
          cached: false,
          resultCount: 0,
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
  public async processThought(input: ThoughtData): Promise<ToolResult> {
    try {
      // 验证必填参数
      if (!input.thought || typeof input.thought !== 'string') {
        throw new Error("thought 参数是必填的，且必须是字符串");
      }
      if (typeof input.thoughtNumber !== 'number' || input.thoughtNumber < 1) {
        throw new Error("thoughtNumber 参数是必填的，且必须是正整数");
      }
      if (typeof input.totalThoughts !== 'number' || input.totalThoughts < 1) {
        throw new Error("totalThoughts 参数是必填的，且必须是正整数");
      }
      if (typeof input.nextThoughtNeeded !== 'boolean') {
        throw new Error("nextThoughtNeeded 参数是必填的，且必须是布尔值");
      }

      // 限制最大思考步骤数
      if (input.thoughtNumber > MAX_THOUGHTS) {
        input.thoughtNumber = MAX_THOUGHTS;
        input.totalThoughts = MAX_THOUGHTS;
        input.nextThoughtNeeded = false;
      }

      // 调整总步骤数
      if (input.thoughtNumber > input.totalThoughts) {
        input.totalThoughts = input.thoughtNumber;
      }

      // 记录思考历史
      this.thoughtHistory.push(input);

      // 执行搜索（如果有关键词）
      let searchResults: KeywordSearchResult[] | undefined;

      if (input.searchedKeywords && input.searchedKeywords.length > 0) {
        searchResults = await this.searchKeywords(input.searchedKeywords, input.site, input.time_range);
      }

      // 构建返回结果
      const result: ResearchResult = {
        thoughtStatus: {
          thoughtNumber: input.thoughtNumber,
          totalThoughts: input.totalThoughts,
          nextThoughtNeeded: input.nextThoughtNeeded,
          thoughtHistoryLength: this.thoughtHistory.length,
          branches: Object.keys(this.branches)
        }
      };

      if (searchResults && searchResults.length > 0) {
        result.searchResults = searchResults;
      }

      // 如果有被跳过的关键词，添加提示
      if (input.searchedKeywords && input.searchedKeywords.length > MAX_KEYWORDS) {
        result.message = `注意：只处理了前 ${MAX_KEYWORDS} 个关键词，跳过了 ${input.searchedKeywords.length - MAX_KEYWORDS} 个`;
      }

      // 日志输出
      if (this.server) {
        logMessage(this.server, "info", `Research: 思考步骤 ${input.thoughtNumber}/${input.totalThoughts}`, {
          thought: input.thought.substring(0, 100),
          keywords: input.searchedKeywords?.length || 0,
          nextThoughtNeeded: input.nextThoughtNeeded
        });
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            status: 'failed'
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  /**
   * 获取思考历史
   */
  public getThoughtHistory(): ThoughtData[] {
    return [...this.thoughtHistory];
  }

  /**
   * 清空思考历史
   */
  public clearHistory(): void {
    this.thoughtHistory = [];
    this.branches = {};
  }
}

// ============ 工具定义 ============

/**
 * Search 工具定义
 */
export const SEARCH_TOOL: Tool = {
  name: "search",
  description: `规划思考 + 自动网络通用搜索

功能：
1. 记录结构化思考步骤
2. 自动执行 searchedKeywords 中的搜索（并发）
3. 返回思考状态 + 搜索结果`,
  inputSchema: {
    type: "object",
    properties: {
      thought: {
        type: "string",
        description: "当前思考步骤的内容"
      },
      nextThoughtNeeded: {
        type: "boolean",
        description: "是否需要继续思考"
      },
      thoughtNumber: {
        type: "number",
        description: "当前思考步骤编号（如 1, 2, 3）"
      },
      totalThoughts: {
        type: "number",
        description: "预计总思考步骤数（如 5, 10）"
      },
      informationSummary: {
        type: "string",
        description: "上一步获取的关键发现（可选）"
      },
      searchedKeywords: {
        type: "array",
        items: { type: "string" },
        description: "要搜索的关键词列表（最多3个并发）。填写后会自动执行搜索并返回结果。留空则不搜索。"
      },
      site: {
        type: "string",
        description: "限制搜索范围到具体网站。当搜索结果中发现类似知识库或者项目文档的网站时，建议使用此参数进行深度挖掘"
      },
      time_range: {
        type: "string",
        enum: ["day", "month", "year"],
        description: "时间范围过滤（可选）：day=最近一天，month=最近一月，year=最近一年"
      },
      isRevision: {
        type: "boolean",
        description: "是否修正之前的思考（可选）"
      },
      revisesThought: {
        type: "number",
        description: "修正哪个思考步骤（可选）"
      },
      branchFromThought: {
        type: "number",
        description: "从哪个思考步骤分支（可选）"
      },
      branchId: {
        type: "string",
        description: "分支标识（可选）"
      },
      needsMoreThoughts: {
        type: "boolean",
        description: "是否需要更多思考步骤（可选）"
      }
    },
    required: ["thought", "nextThoughtNeeded", "thoughtNumber", "totalThoughts"]
  }
};
