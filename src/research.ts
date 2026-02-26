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

// ============ 环境变量配置 ============
const MAX_THOUGHTS = parseInt(process.env.MAX_THOUGHTS || '5', 10);
const MAX_KEYWORDS = parseInt(process.env.MAX_KEYWORDS || '3', 10);
const SEARCH_TIMEOUT_MS = parseInt(process.env.SEARCH_TIMEOUT_MS || '30000', 10);
const MAX_DESCRIPTION_LENGTH = parseInt(process.env.MAX_DESCRIPTION_LENGTH || '200', 10);

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

  /**
   * 执行 SearXNG 搜索
   */
  private async performSearXNGSearch(keyword: string, site?: string): Promise<SearchResult[]> {
    if (!this.server) {
      throw new Error("Server not initialized");
    }

    const searxngUrl = process.env.SEARXNG_URL;
    if (!searxngUrl) {
      throw new Error("SEARXNG_URL not configured");
    }

    // 构建搜索 URL
    const baseUrl = searxngUrl.endsWith('/') ? searxngUrl : searxngUrl + '/';
    const url = new URL('search', baseUrl);
    
    // 构建查询词（支持站内搜索）
    let query = keyword;
    if (site) {
      query = `site:${site} ${keyword}`;
    }
    
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("pageno", "1");

    // 添加语言设置
    const language = process.env.SEARCH_LANGUAGE || "all";
    if (language !== "all") {
      url.searchParams.set("language", language);
    }

    // 添加安全搜索设置
    const safesearch = process.env.SAFE_SEARCH || "0";
    url.searchParams.set("safesearch", safesearch);

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          'Accept': 'application/json',
        }
      });

      if (!response.ok) {
        throw new Error(`SearXNG returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { results?: Array<{ title?: string; content?: string; url?: string; score?: number }> };

      if (!data.results || data.results.length === 0) {
        return [];
      }

      // 转换为标准格式
      return data.results.map((result) => ({
        title: result.title || "",
        content: result.content || "",
        url: result.url || "",
        score: result.score || 0,
      }));
    } catch (error) {
      throw error;
    }
  }

  /**
   * 执行单个关键词搜索
   * 集成混合检索和链接去重
   */
  private async searchKeyword(keyword: string, site?: string): Promise<KeywordSearchResult> {
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
      // 1. 执行 SearXNG 搜索
      const rawResults = await this.performSearXNGSearch(keyword, site);

      if (rawResults.length === 0) {
        return {
          keyword,
          cached: false,
          resultCount: 0,
          results: []
        };
      }

      // 2. 应用混合检索重排序
      const rerankedResults = await rerankWithHybridSearch(keyword, rawResults);

      // 3. 应用链接去重
      const dedupedResults: SearchResultItem[] = [];
      const newUrls: string[] = [];

      for (const result of rerankedResults) {
        // 检查是否已去重
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

      // 4. 将新链接添加到去重池
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
    site?: string
  ): Promise<KeywordSearchResult[]> {
    // 限制关键词数量
    const limitedKeywords = keywords.slice(0, MAX_KEYWORDS);

    // 去重
    const uniqueKeywords = Array.from(new Set(limitedKeywords));

    if (uniqueKeywords.length === 0) {
      return [];
    }

    if (this.server) {
      logMessage(this.server, "info", `Research: 开始并发搜索 ${uniqueKeywords.length} 个关键词`);
    }

    // 创建带超时的 Promise
    const searchWithTimeout = async (keyword: string): Promise<KeywordSearchResult> => {
      const timeoutPromise = new Promise<KeywordSearchResult>((_, reject) => {
        setTimeout(() => reject(new Error('搜索超时')), SEARCH_TIMEOUT_MS);
      });

      const searchPromise = this.searchKeyword(keyword, site);

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

    // 并发执行所有搜索
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
        searchResults = await this.searchKeywords(input.searchedKeywords);
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
  description: `增强搜索工具 - 规划思考 + 自动搜索

功能：
1. 记录结构化思考步骤
2. 自动执行 searchedKeywords 中的搜索（并发）
3. 返回思考状态 + 搜索结果

使用方法：
1. 填写 thought 描述当前思考
2. 填写 searchedKeywords 指定要搜索的词（最多3个并发）
3. 根据返回的搜索结果决定下一步
4. 如需深读某个网页，调用 read 工具

返回内容：
- thoughtStatus: 思考状态（步骤编号、是否继续等）
- searchResults: 搜索结果（每个keyword的匹配结果，包含URL用于read）

注意：
- 每个关键词应是独立的实体，避免组合查询
- 搜索结果已按相关性排序
- 结果中的URL可用于后续 read 工具深入阅读`,
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

// ============ 导出配置信息 ============

/**
 * 获取 Research 配置
 */
export function getResearchConfig() {
  return {
    maxThoughts: MAX_THOUGHTS,
    maxKeywords: MAX_KEYWORDS,
    searchTimeoutMs: SEARCH_TIMEOUT_MS,
    maxDescriptionLength: MAX_DESCRIPTION_LENGTH
  };
}
