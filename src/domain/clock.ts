/** 可注入时钟：业务计算与测试都不直接调用 new Date()，保证可复现。 */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = {
  now: () => new Date(),
}

/** 固定时钟。传入本地时间描述（如 '2026-10-25T23:59:00'），测试专用。 */
export function fixedClock(localIso: string): Clock {
  const d = new Date(localIso)
  return { now: () => new Date(d.getTime()) }
}
