import { Command } from "commander";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { fetchAndConvertToMarkdown, PaginationOptions } from "../url-reader.js";
import { packageVersion } from "../version.js";
import { FETCH_TIMEOUT_MS } from "../config.js";

export function registerReadCommand(program: Command) {
  program
    .command("read <urls...>")
    .description("读取 URL 内容（支持多 URL）")
    .option("--start-char <number>", "起始字符位置", "0")
    .option("--max-length <number>", "最大返回字符数")
    .option("--section <heading>", "提取指定章节")
    .option("--paragraph-range <range>", "段落范围 (如 1-5, 3, 10-)")
    .option("--headings", "仅返回标题列表", false)
    .option("--timeout <ms>", "超时时间(ms)", String(FETCH_TIMEOUT_MS))
    .action(async (urls: string[], opts) => {
      // URL 格式预校验
      const invalidUrls: string[] = [];
      for (const u of urls) {
        try {
          new URL(u);
        } catch {
          invalidUrls.push(u);
        }
      }
      if (invalidUrls.length > 0) {
        console.error("❌ 无效的 URL 格式:");
        for (const u of invalidUrls) {
          console.error(`   ${u}`);
        }
        console.error("URL 必须以 http:// 或 https:// 开头，例如: https://example.com");
        process.exit(1);
      }

      const server = new Server(
        { name: "agent-search-cli", version: packageVersion },
        { capabilities: { tools: {} } }
      );

      const paginationOptions: PaginationOptions = {
        startChar: parseInt(opts.startChar, 10),
        maxLength: opts.maxLength ? parseInt(opts.maxLength, 10) : 2000,
        section: opts.section,
        paragraphRange: opts.paragraphRange,
        readHeadings: opts.headings,
      };

      try {
        const result = await fetchAndConvertToMarkdown(
          server,
          urls,
          parseInt(opts.timeout, 10),
          paginationOptions
        );
        console.log(result);
      } catch (error) {
        console.error("读取失败:", error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
