/**
 * 拧丝 AI · 关卡叙事生成
 *
 * 当前实现：本地兜底文案池（20+ 条）。
 * 下一阶段：补充云函数 `narrateLevel`（豆包 lite），失败/超时自动降级到本地池。
 *
 * 设计原则：
 * - 永远不阻塞游戏：所有 AI 接口都是 Promise 形式，并自带超时保护
 * - 内容边界（见 SPEC 4.2）：本地池经过人工审核，不含敏感词
 */

import { LevelConfig, LevelNarrative } from './LevelTypes';
import { Storage, StorageKeys } from './Storage';

/** 本地兜底文案池（按"主题"分组，AI 不可用时随机抽取） */
const FALLBACK_NARRATIVES: Array<{ title: string; story: string; encourage: string }> = [
  { title: '修复长城烽火台',     story: '风沙磨损了城墙的木骨，工匠想念十年前的春天。',           encourage: '一座关隘已修缮如初。' },
  { title: '拆解时光机',         story: '过期的时间从螺丝缝里流出来，散成一阵金色尘埃。',         encourage: '时空齿轮重新归位。' },
  { title: '修一辆童年三轮车',   story: '坐垫漏了棉花，铃铛却还能响。它在等你拧紧最后一颗螺丝。', encourage: '车把已稳，可以出发。' },
  { title: '复原一台老收音机',   story: '木壳里有 1985 年的电流和邓丽君的歌。',                   encourage: '电波再次响起。' },
  { title: '修复琉璃灯笼',       story: '檐角的风把灯笼摇了一夜，金线脱了一根。',                 encourage: '灯火重新照亮回家的路。' },
  { title: '修一架月光纸飞机',   story: '它从月亮的背面坠落，机翼有几道折痕需要校正。',           encourage: '它又能飞回月亮去了。' },
  { title: '组装赛博朋克霓虹',   story: '霓虹管缺了三颗紫色螺丝，雨水沿招牌往下淌。',             encourage: '霓虹再次点亮夜市。' },
  { title: '修复祖传木匣',       story: '匣里藏着外婆的银顶针和一枚发黄的车票。',                 encourage: '匣盖严丝合缝。' },
  { title: '复原西夏旧码头',     story: '海风把船坞的木桩晒得发白，铁锈像花一样开。',             encourage: '渔船可以归港了。' },
  { title: '修一只机械鸟',       story: '它的翅膀停了七天，发条还剩最后一圈。',                   encourage: '机械鸟扑棱飞起。' },
  { title: '加固露天观星台',     story: '木梯吱呀响，星图却比去年清晰。',                         encourage: '今晚可以数到一千颗星。' },
  { title: '修复古琴台',         story: '七弦下的桐木开裂了一寸，琴师准备过冬。',                 encourage: '宫商角徵羽，皆归位。' },
  { title: '调试老式纺织机',     story: '梭子被尘埃卡住，丝线在月色里等着续上。',                 encourage: '纺机吱呀作响，重新有了节奏。' },
  { title: '修一座迷你水车',     story: '溪水比去年小了一半，水车也越转越慢。',                   encourage: '溪流再次推动叶轮。' },
  { title: '复原童话书架',       story: '书架上的童话从某一页开始缺了字，得先把架子修稳。',       encourage: '故事可以继续讲下去了。' },
  { title: '修复邮筒木格栅',     story: '邮筒里还压着一封未寄出的信，写于 2003 年。',             encourage: '信终于被取走了。' },
  { title: '加固深山图书馆',     story: '木地板被白蚁啃过，但《山海经》还在。',                   encourage: '夜读者归位。' },
  { title: '修复一台手摇放映机', story: '胶片在齿轮上打了个结，电影只放到一半就停了。',           encourage: '黑白光影重新流动。' },
  { title: '修一只老座钟',       story: '它准了二十年，最近开始慢三分钟。',                       encourage: '钟摆又开始有节奏地走动。' },
  { title: '组装迷你天文望远镜', story: '镜筒上的螺丝松了，看不见土星的环。',                     encourage: '土星环再次清晰。' },
];

/** 通用兜底鼓励语池（用于失败结算） */
const FALLBACK_ENCOURAGE_FAIL: string[] = [
  '差一颗螺丝而已，再来。',
  '工匠不是从第一颗螺丝就开始的。',
  '退一步，看看木头的纹理。',
  '没关系，木头会等。',
  '这次只是试拧。',
];

interface NarratorOptions {
  /** AI 调用超时（毫秒），默认 3000 */
  timeoutMs?: number;
  /** 是否强制使用本地兜底池（调试/离线模式） */
  forceFallback?: boolean;
}

/** 主入口：生成关卡叙事 */
export async function narrate(
  config: LevelConfig,
  options: NarratorOptions = {},
): Promise<LevelNarrative> {
  const { forceFallback = true } = options; // MVP 阶段默认走本地池，云函数留待下次会话

  // 1. 缓存优先：同一关卡同一会话内不重复生成
  const cached = readCachedNarrative(config.level);
  if (cached) return cached;

  // 2. AI 调用（下次会话补充）
  if (!forceFallback) {
    try {
      const ai = await callAiCloudFunction(config, options.timeoutMs ?? 3000);
      if (ai) {
        const result: LevelNarrative = { ...ai, source: 'ai' };
        writeCachedNarrative(config.level, result);
        return result;
      }
    } catch {
      // 失败静默降级
    }
  }

  // 3. 本地兜底池
  const fallback = pickFallback(config.level);
  writeCachedNarrative(config.level, fallback);
  return fallback;
}

/** 失败时的鼓励语（不需要异步） */
export function pickFailEncourage(): string {
  return FALLBACK_ENCOURAGE_FAIL[Math.floor(Math.random() * FALLBACK_ENCOURAGE_FAIL.length)];
}

function pickFallback(level: number): LevelNarrative {
  // 关卡 1 固定用第一条（避免新手玩家被随机内容劝退），其它关随机
  const idx = level === 1 ? 0 : Math.floor(Math.random() * FALLBACK_NARRATIVES.length);
  const f = FALLBACK_NARRATIVES[idx];
  return {
    title: f.title,
    story: f.story,
    encourage: f.encourage,
    source: 'fallback',
  };
}

function readCachedNarrative(level: number): LevelNarrative | null {
  const cache = Storage.get<Record<number, LevelNarrative>>(StorageKeys.AiNarrativeCache, {});
  return cache[level] ?? null;
}

function writeCachedNarrative(level: number, narrative: LevelNarrative) {
  const cache = Storage.get<Record<number, LevelNarrative>>(StorageKeys.AiNarrativeCache, {});
  cache[level] = narrative;
  Storage.set(StorageKeys.AiNarrativeCache, cache);
}

/**
 * 云函数调用（占位实现 / 下次会话补充）
 *
 * 真实实现时这里应该：
 * 1. 调用微信小游戏云函数 `wx.cloud.callFunction({ name: 'narrateLevel', data: {...} })`
 * 2. 加 3s 超时（Promise.race）
 * 3. 服务端 prompt 应包含：禁敏感词、限制 30 字、不输出贬低话术（详见 SPEC 4.2）
 * 4. 输出后正则二次过滤（黑名单 + 长度截断）
 */
async function callAiCloudFunction(
  _config: LevelConfig,
  _timeoutMs: number,
): Promise<{ title: string; story: string; encourage: string } | null> {
  // MVP 占位：始终返回 null，触发兜底池
  return null;
}
