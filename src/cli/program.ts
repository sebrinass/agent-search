#!/usr/bin/env node

import { Command } from "commander";
import { registerSearchCommand } from "./search-cmd.js";
import { registerReadCommand } from "./read-cmd.js";
import { registerServeCommand } from "./serve-cmd.js";
import { packageVersion } from "../version.js";
import { setLogLevel } from "../logging.js";

const program = new Command();

program
  .name("agent-search")
  .description("增强型搜索 CLI 工具 — 支持 SearXNG 搜索、URL 读取")
  .version(packageVersion)
  .option("-v, --verbose", "显示详细日志输出", false);

program.hook('preAction', () => {
  const opts = program.opts();
  if (opts.verbose) {
    setLogLevel('debug');
  }
});

registerSearchCommand(program);
registerReadCommand(program);
registerServeCommand(program);

program.parse();
