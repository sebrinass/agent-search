import { Command } from "commander";
import { Server } from "@modelcontextprotocol/server";
import { packageVersion } from "../version.js";
import { logMessage } from "../logging.js";
import { minimaxSearch } from "../minimax-search.js";
import { exaSearch } from "../exa-search.js";
import { deepseekSearch } from "../deepseek-search.js";
import { isMinimaxEnabled, isExaEnabled, isDeepseekEnabled } from "../config.js";

/** 通用的云端搜索输出（text 模式列表 / json 完整输出） */
function printResults(token: string, json: boolean): void {
  try {
    const parsed = JSON.parse(token);
    if (json) {
      console.log(JSON.stringify(parsed, null, 2));
      return;
    }
    const source = parsed.source || "";
    console.log(`\n[${source}] 关键词: ${parsed.keyword}`);
    if (parsed.error) {
      console.log(`   ❌ 错误: ${parsed.error}`);
      return;
    }
    if (parsed.related?.length) {
      console.log(`   相关搜索: ${parsed.related.join(" | ")}`);
    }
    for (const r of parsed.results || []) {
      console.log(`   ${r.title}`);
      console.log(`   ${r.link}`);
      if (r.snippet) console.log(`   ${r.snippet}`);
      if (r.publishedDate) console.log(`   📅 ${r.publishedDate}`);
      if (r.rerankScore !== undefined || r.authority !== undefined) {
        console.log(`   ⭐ score=${r.rerankScore ?? "-"} authority=${r.authority ?? "-"}`);
      }
      console.log();
    }
  } catch {
    console.log(token);
  }
}

export function registerDeepseekCommand(program: Command) {
  program
    .command("deepseek-search")
    .description("DeepSeek 自研搜索（需配置 DEEPSEEK_API_KEY，按成功请求计费）")
    .requiredOption("-q, --query <keyword>", "搜索关键词（单个，最长128字符）")
    .option("--count <number>", "返回结果数量（1-50，默认10）", "10")
    .option("--site <domain>", "限制搜索域名")
    .option("--time-range <range>", "时间范围：day / month / year")
    .option("--lang <code>", "语言代码，如 zh / en")
    .option("--json", "以 JSON 格式输出结果", false)
    .action(async (opts) => {
      if (!isDeepseekEnabled) {
        console.error("❌ 未配置 DEEPSEEK_API_KEY，无法使用 deepseek-search");
        console.error("请设置 DEEPSEEK_API_KEY，见 .env.example");
        process.exit(1);
      }

      const count = Number(opts.count);
      if (!Number.isInteger(count) || count < 1 || count > 50) {
        console.error(`❌ --count 必须是 1-50 的整数，收到：${opts.count}`);
        process.exit(1);
      }

      const server = new Server(
        { name: "agent-search-cli", version: packageVersion },
        { capabilities: { tools: {} } }
      );

      const result = await deepseekSearch(server, opts.query, count, {
        site: opts.site,
        time_range: opts.timeRange,
        lang: opts.lang,
      });
      printResults(
        JSON.stringify({
          source: "deepseek",
          keyword: result.keyword,
          appliedQuery: result.appliedQuery,
          results: result.results,
          error: result.error,
        }),
        opts.json
      );
      if (result.error) process.exit(1);
      process.exit(0);
    });
}

export function registerMiniMaxCommand(program: Command) {
  program
    .command("minimax-search")
    .description("MiniMax 商业搜索工具（需配置 MINIMAX_API_KEY）")
    .requiredOption("-q, --query <keyword>", "搜索关键词（单个）")
    .option("--count <number>", "返回结果数量（1-10，默认10）", "10")
    .option("--json", "以 JSON 格式输出结果", false)
    .action(async (opts) => {
      if (!isMinimaxEnabled) {
        console.error("❌ 未配置 MINIMAX_API_KEY，无法使用 minimax-search");
        console.error("请设置 MINIMAX_API_KEY（MiniMax Token Plan key），见 .env.example");
        process.exit(1);
      }

      const server = new Server(
        { name: "agent-search-cli", version: packageVersion },
        { capabilities: { tools: {} } }
      );

      const count = parseInt(opts.count, 10);
      const result = await minimaxSearch(server, opts.query, count);
      printResults(
        JSON.stringify({
          source: "minimax",
          keyword: result.keyword,
          results: result.results,
          related: result.related,
          error: result.error,
        }),
        opts.json
      );
      if (result.error) process.exit(1);
      process.exit(0);
    });
}

export function registerExaCommand(program: Command) {
  program
    .command("exa-search")
    .description("Exa 语义搜索工具（配置 EXA_API_KEY 走直连；未配置走匿名通道）")
    .requiredOption("-q, --query <keyword>", "搜索关键词（单个）")
    .option("--count <number>", "返回结果数量（1-10，默认10）", "10")
    .option("--json", "以 JSON 格式输出结果", false)
    .action(async (opts) => {
      if (!isExaEnabled) {
        console.error("❌ ENABLE_EXA_SEARCH=false，已禁用 exa-search");
        process.exit(1);
      }

      const server = new Server(
        { name: "agent-search-cli", version: packageVersion },
        { capabilities: { tools: {} } }
      );

      const count = parseInt(opts.count, 10);
      const result = await exaSearch(server, opts.query, count);
      printResults(
        JSON.stringify({
          source: "exa",
          keyword: result.keyword,
          results: result.results,
          error: result.error,
        }),
        opts.json
      );
      if (result.error) process.exit(1);
      process.exit(0);
    });
}

export { logMessage };