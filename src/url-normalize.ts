/**
 * URL 规范化模块
 *
 * 用途：搜索/阅读链路中，对 URL 做规范化后再去重，避免"同一条内容多个 URL 写法"被算成两条。
 * 例如：utm 参数、www 前缀、http/https、末尾斜杠、锚点等导致同一页面 URL 不同。
 *
 * 策略（保守）：
 * - 只删除【已知的跟踪参数】（白名单式），不删除业务参数（如 ?page=2、?id=123）
 * - 域名归一：去 www. 前缀
 * - 去锚点（#...）
 * - 规整末尾斜杠
 * - 保留 query 顺序（不排序，避免误伤有意义的顺序）
 */

// 已知跟踪参数：命中即删（大小写不敏感）
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_reader', 'utm_name', 'utm_place',
  'fbclid', 'gclid', 'dclid', 'msclkid', 'igshid', 'mc_cid', 'mc_eid',
  'spm', 'spm_id_from', 'scm', // 淘宝/阿里系
  'from', 'ref', 'referrer', 'source', 'src', 'origin',
  'campaign', 'cid', 'ccid', 'aff_id', 'aff_sub',
  'yclid', 'twclid', 'sccid', 'epik', 'wickedid', 'oly_anon_id',
  'vero_id', 'gclsrc', 'kw', 'piwik_campaign', 'piwik_kwd',
  'wt_mc', 'wt_zmc', 'wt_cc', // 元宝/百度系部分
]);

const PROTOCOL_STRIP = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * 规范化单个 URL。
 * @param url 原始 URL
 * @returns 规范化后的 URL（失败时原样返回）
 */
export function normalizeUrl(url: string): string {
  if (!url) return url;
  const trimmed = url.trim();
  if (!trimmed) return trimmed;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // 非标准 URL（如协议相对 //example.com/path 或残缺地址），尽力清理后返回
    return stripProtocolRelative(trimmed);
  }

  // 1. 去跟踪参数（白名单式）
  const keep = [...parsed.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()));
  parsed.search = keep.length > 0
    ? keep.map(([k, v]) => `${k}=${v}`).join('&')
    : '';

  // 2. 域名归一：去 www.
  if (parsed.hostname.startsWith('www.')) {
    parsed.hostname = parsed.hostname.slice(4);
  }

  // 3. 去锚点
  parsed.hash = '';

  // 4. 规整末尾斜杠（保留根路径 /）
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }

  return parsed.toString();
}

/**
 * 协议相对 URL（//example.com/path）或残缺地址的轻量清理：
 * 去锚点、去跟踪参数、去 www。
 */
function stripProtocolRelative(raw: string): string {
  let out = raw.replace(/#.*$/, '');

  // 提取 query 部分去跟踪参数
  const qIdx = out.indexOf('?');
  if (qIdx >= 0) {
    const queryStr = out.slice(qIdx + 1);
    const kept = queryStr.split('&').filter(pair => {
      const [k] = pair.split('=');
      return k && !TRACKING_PARAMS.has(k.toLowerCase());
    });
    out = out.slice(0, qIdx) + (kept.length > 0 ? `?${kept.join('&')}` : '');
  }

  // 去 www.
  out = out.replace(/^(https?:)?\/\/www\./i, (m) => m.replace(/www\./i, ''));

  // 规整尾斜杠
  const pathStart = out.indexOf('/', out.indexOf('//') + 2);
  if (pathStart > 0 && out.length > pathStart + 1 && out.endsWith('/')) {
    out = out.replace(/\/+$/, '');
  }

  return out;
}

export { PROTOCOL_STRIP };
