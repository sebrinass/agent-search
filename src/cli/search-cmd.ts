import { Command } from "commander";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ResearchServer, SearchInput } from "../research.js";
import { packageVersion } from "../version.js";
import { SEARXNG_URL, isEmbeddingEnabled } from "../config.js";

export function registerSearchCommand(program: Command) {
  program
    .command("search")
    .description("通用网络搜索工具")
    .requiredOption("-q, --query <keywords...>", "搜索关键词（最多3个）")
    .option("-s, --site <domain>", "限制搜索域名")
    .option("--time-range <range>", "时间范围: day, month, year")
    .option("--lang <language>", "搜索语言", "all")
    .option("--safe-search <level>", "安全搜索级别: 0, 1, 2", "0")
    .option("-m, --mode <mode>", "搜索模式: fast=快速(默认), embedding=精准(需配置嵌入模型)", 'fast')
    .option("-v, --verbose", "显示详细输出", false)
    .option("--json", "以 JSON 格式输出结果", false)
    .action(async (opts) => {
      if (!SEARXNG_URL) {
        console.error("❌ 缺少 SEARXNG_URL 环境变量");
        console.error("请设置 SearXNG 实例地址，例如: SEARXNG_URL=http://localhost:8080 agent-search search -q \"关键词\"");
        process.exit(1);
      }

      const mode = opts.mode as 'fast' | 'embedding';
      if (mode === 'embedding' && !isEmbeddingEnabled) {
        console.warn("⚠️ 警告: embedding 模式未配置 EMBEDDING_BASE_URL，将自动降级为 fast 模式");
      }

      const server = new Server(
        { name: "agent-search-cli", version: packageVersion },
        { capabilities: { tools: {} } }
      );
      const researchServer = new ResearchServer();
      researchServer.setServer(server);

      const searchInput: SearchInput = {
        searchedKeywords: opts.query,
        site: opts.site,
        time_range: opts.timeRange,
        lang: opts.lang,
        safeSearch: parseInt(opts.safeSearch, 10),
        mode: mode,
      };

      const result = await researchServer.processSearch(searchInput);

      if (result.isError) {
        console.error("搜索失败:", result.content[0].text);
        process.exit(1);
      }

      try {
        const parsed = JSON.parse(result.content[0].text);
        if (opts.json) {
          console.log(JSON.stringify(parsed, null, 2));
        } else {
          if (parsed.searchResults) {
            for (const kr of parsed.searchResults) {
              console.log(`\n关键词: ${kr.keyword}`);
              if (kr.error) {
                console.log(`   错误: ${kr.error}`);
                continue;
              }
              for (const r of kr.results) {
                console.log(`   ${r.title}`);
                console.log(`   ${r.url}`);
                console.log(`   ${r.description}`);
                console.log();
              }
            }
          }
          if (parsed.message) {
            console.log(`注意: ${parsed.message}`);
          }
        }
      } catch {
        console.log(result.content[0].text);
      }
    });
}
