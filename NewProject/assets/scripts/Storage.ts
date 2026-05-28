/**
 * 拧丝 AI · 跨环境本地存储
 *
 * 优先级：wx.getStorageSync (微信小游戏) → localStorage (H5/Web) → 内存兜底 (隐私模式 / 配额满)
 *
 * 所有 API 同步返回，失败静默返回 defaultValue，不抛异常（避免阻塞游戏）。
 */

declare const wx: any | undefined;

const memoryStore: Record<string, string> = {};

function hasWxStorage(): boolean {
  try {
    return typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function';
  } catch {
    return false;
  }
}

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function';
  } catch {
    return false;
  }
}

function rawGet(key: string): string | null {
  if (hasWxStorage()) {
    try {
      const v = wx.getStorageSync(key);
      if (typeof v === 'string' && v.length > 0) return v;
      if (v && typeof v === 'object') return JSON.stringify(v);
    } catch {}
  }
  if (hasLocalStorage()) {
    try {
      const v = localStorage.getItem(key);
      if (v !== null && v.length > 0) return v;
    } catch {}
  }
  return memoryStore[key] ?? null;
}

function rawSet(key: string, value: string): boolean {
  let ok = false;
  if (hasWxStorage()) {
    try {
      wx.setStorageSync(key, value);
      ok = true;
    } catch {}
  }
  if (hasLocalStorage()) {
    try {
      localStorage.setItem(key, value);
      ok = true;
    } catch {}
  }
  memoryStore[key] = value;
  return ok;
}

function rawRemove(key: string): void {
  if (hasWxStorage()) {
    try {
      wx.removeStorageSync(key);
    } catch {}
  }
  if (hasLocalStorage()) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }
  delete memoryStore[key];
}

export const Storage = {
  /** 读取 JSON 序列化的值；失败/不存在返回 defaultValue */
  get<T>(key: string, defaultValue: T): T {
    const raw = rawGet(key);
    if (raw == null) return defaultValue;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  },

  /** 写入 JSON 序列化的值；返回是否至少有一个后端成功 */
  set<T>(key: string, value: T): boolean {
    try {
      const raw = JSON.stringify(value);
      return rawSet(key, raw);
    } catch {
      return false;
    }
  },

  remove(key: string): void {
    rawRemove(key);
  },
};

/** 统一 key 命名（避免分散在各处魔法字符串） */
export const StorageKeys = {
  PlayerHistory: 'nutsy_ai_history_v1',
  CurrentLevelIndex: 'nutsy_ai_level_idx_v1',
  AiNarrativeCache: 'nutsy_ai_narrative_cache_v1',
  Settings: 'nutsy_ai_settings_v1',
};
