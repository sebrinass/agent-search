/**
 * 环境变量健壮解析
 *
 * 为什么不用裸 parseInt / parseFloat：
 * - parseInt('abc') → NaN，NaN 会静默传遍全链路：超时变 0（立即超时）、
 *   循环不执行（页数 0）、上限失效（TOP_K 为 NaN，slice 返回空数组），
 *   症状怪异且极难定位
 * - parseInt('12s') → 12，写错的单位会被静默吞掉，比报错更危险
 * - parseFloat 同理会把 '0.5x' 解析成 0.5
 *
 * 本模块统一行为：
 * - 未设置或空串 → 回退默认值，不告警（属正常情况）
 * - 非法值 → 回退默认值 + stderr 告警（不污染 stdout，符合 STDIO 规范）
 * - 越界 → 钳制到边界 + 告警（钳制比回退更贴近用户原意）
 */

/** 数值边界（两端均含） */
export interface NumberBounds {
  min?: number;
  max?: number;
}

function warnFallback(name: string, raw: string, fallback: number, reason: string): void {
  console.error(`[config] ${name}="${raw}" ${reason}，已回退为默认值 ${fallback}`);
}

function warnClamp(name: string, raw: string, clamped: number, bound: number, side: 'min' | 'max'): void {
  console.error(
    `[config] ${name}="${raw}" 超出${side === 'min' ? '下' : '上'}限 ${bound}，已钳制为 ${clamped}`
  );
}

function applyBounds(
  name: string,
  raw: string,
  value: number,
  bounds: NumberBounds
): number {
  if (bounds.min !== undefined && value < bounds.min) {
    warnClamp(name, raw, bounds.min, bounds.min, 'min');
    return bounds.min;
  }
  if (bounds.max !== undefined && value > bounds.max) {
    warnClamp(name, raw, bounds.max, bounds.max, 'max');
    return bounds.max;
  }
  return value;
}

/**
 * 解析整数环境变量。
 * 使用 Number() 而非 parseInt()：'12abc' 必须被判为非法，不能被截断成 12。
 */
export function envInt(name: string, fallback: number, bounds: NumberBounds = {}): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    warnFallback(name, raw, fallback, '不是合法整数');
    return fallback;
  }

  return applyBounds(name, raw, parsed, bounds);
}

/**
 * 解析浮点环境变量。
 * 注意：0 往往是合法且有语义的值（如 RERANK_MIN_SCORE_RATIO=0 表示关闭过滤），
 * 因此不能写成 `|| fallback`。
 */
export function envFloat(name: string, fallback: number, bounds: NumberBounds = {}): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed)) {
    warnFallback(name, raw, fallback, '不是合法数字');
    return fallback;
  }

  return applyBounds(name, raw, parsed, bounds);
}

/**
 * 解析布尔环境变量（1/true/yes/on 与 0/false/no/off）。
 * 项目历史代码多用 `!== 'false'` 的宽松写法，新配置建议用本函数以获得
 * 明确的非法值告警；老配置保持原样迁移，避免行为变化。
 */
export function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

  console.error(`[config] ${name}="${raw}" 不是合法布尔值，已回退为默认值 ${fallback}`);
  return fallback;
}
