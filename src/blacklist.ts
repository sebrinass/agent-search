/**
 * 域名黑名单模块
 *
 * 功能：
 * 1. 从 blacklist.md 加载黑名单域名列表
 * 2. 判断 URL 是否命中黑名单
 * 3. 基于文件修改时间的热加载缓存
 */

import fs from "node:fs";
import { BLACKLIST_PATH } from "./config.js";

// ============ 默认黑名单内容 ============

/** 默认黑名单文件内容，文件不存在时自动创建 */
const DEFAULT_BLACKLIST_CONTENT = `# 域名黑名单
# 每行一个一级域名，搜索结果中匹配的URL将被过滤
# 修改后下一轮搜索立即生效

# 视频网站
douyin.com

# 字典/翻译网站
zdic.net
iciba.com
ichacha.net
hanyuguoxue.com
hancibao.com
chagushici.com
hgcha.com
zidian.100xgj.com
zidian.qianp.com
creationwiki.org
dict.cn
`;

/** 默认黑名单域名列表 */
const DEFAULT_DOMAINS = [
  "douyin.com",
  "zdic.net",
  "iciba.com",
  "ichacha.net",
  "hanyuguoxue.com",
  "hancibao.com",
  "chagushici.com",
  "hgcha.com",
  "zidian.100xgj.com",
  "zidian.qianp.com",
  "creationwiki.org",
  "dict.cn",
];

// ============ 缓存机制 ============

/** 缓存的黑名单域名列表 */
let cachedBlacklist: string[] | null = null;

/** 缓存对应的文件修改时间（mtimeMs），用于检测文件变化 */
let cachedMtimeMs: number | null = null;

// ============ 核心函数 ============

/**
 * 加载黑名单域名列表
 *
 * 逻辑：
 * 1. 检查文件是否存在，不存在则自动创建默认黑名单
 * 2. 比对文件修改时间，未变则返回缓存（热加载）
 * 3. 重新读取并解析文件，忽略注释和空行
 *
 * @returns 黑名单域名列表
 */
export function loadBlacklist(): string[] {
  const filePath = BLACKLIST_PATH;

  // 文件不存在时自动创建
  if (!fs.existsSync(filePath)) {
    try {
      // 确保目录存在
      const dir = filePath.substring(0, filePath.lastIndexOf("/") || filePath.lastIndexOf("\\"));
      if (dir) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, DEFAULT_BLACKLIST_CONTENT, "utf-8");
    } catch {
      // 创建失败则返回默认列表，不阻塞搜索流程
      return [...DEFAULT_DOMAINS];
    }
    // 新创建的文件，初始化缓存
    cachedBlacklist = [...DEFAULT_DOMAINS];
    try {
      const stat = fs.statSync(filePath);
      cachedMtimeMs = stat.mtimeMs;
    } catch {
      cachedMtimeMs = null;
    }
    return [...DEFAULT_DOMAINS];
  }

  // 检查文件修改时间，未变则使用缓存
  try {
    const stat = fs.statSync(filePath);
    if (cachedBlacklist !== null && cachedMtimeMs === stat.mtimeMs) {
      return cachedBlacklist;
    }
    // 文件有变化，重新读取
    cachedMtimeMs = stat.mtimeMs;
  } catch {
    // stat 失败，继续尝试读取
  }

  // 读取并解析黑名单文件
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const domains = parseBlacklistContent(content);
    cachedBlacklist = domains;
    return domains;
  } catch {
    // 读取失败，返回缓存或默认列表
    return cachedBlacklist || [...DEFAULT_DOMAINS];
  }
}

/**
 * 解析黑名单文件内容
 *
 * 规则：
 * - 以 # 开头的行为注释，忽略
 * - 空行忽略
 * - 去除首尾空白后作为域名
 *
 * @param content 文件内容
 * @returns 域名列表
 */
function parseBlacklistContent(content: string): string[] {
  const domains: string[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    domains.push(trimmed.toLowerCase());
  }
  return domains;
}

/**
 * 判断 URL 是否命中黑名单
 *
 * 匹配逻辑：提取 URL 的 hostname，检查是否以黑名单域名结尾
 * 例如 bilibili.com 可匹配 www.bilibili.com、m.bilibili.com 等
 *
 * @param url 待检查的 URL
 * @param blacklist 黑名单域名列表
 * @returns 是否命中黑名单
 */
export function isBlacklisted(url: string, blacklist: string[]): boolean {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();

    // bilibili 视频页面精确过滤（不过滤文章等其他页面）
    if (hostname === "bilibili.com" || hostname.endsWith(".bilibili.com")) {
      if (pathname.startsWith("/video/")) {
        return true;
      }
      // bilibili 域名但不是视频页面，不过滤
      return false;
    }

    if (blacklist.length === 0) {
      return false;
    }

    for (const domain of blacklist) {
      // hostname 完全等于域名，或以 .域名 结尾（子域名匹配）
      if (hostname === domain || hostname.endsWith("." + domain)) {
        return true;
      }
    }

    return false;
  } catch {
    // URL 解析失败，不过滤
    return false;
  }
}
