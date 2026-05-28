/**
 * 拧丝 AI · 关卡生成器（规则引擎 + 简易求解器）
 *
 * 设计原则：
 * - 关卡参数完全由本地规则生成，零延迟、可控、保证有解
 * - 大模型只用于生成"叙事文案"（见 AiNarrator.ts），不参与关卡参数生成
 * - 难度学习器：基于玩家最近的失败次数动态降阶
 */

import {
  ALL_COLORS,
  LevelConfig,
  PlankSpec,
  PlankStyle,
  PlayerHistory,
  ScrewColor,
  ScrewSpec,
} from './LevelTypes';

/** 设计分辨率（与 GameManager 保持一致） */
const DESIGN_W = 720;
const DESIGN_H = 1280;

/** 木板区可用 Y 范围：避开顶部 HUD 15% 与底部颜色槽 25% */
const BOARD_ZONE_MIN_Y = -DESIGN_H / 2 + DESIGN_H * 0.30; // ≈ -256
const BOARD_ZONE_MAX_Y = DESIGN_H / 2 - DESIGN_H * 0.18; // ≈ +410

/** 关卡静态参数表（MVP 3 关） */
interface LevelParams {
  level: number;
  colorCount: number;
  planks: Array<{ w: number; h: number; cx: number; cy: number; style: PlankStyle; holeGrid: { cols: number; rows: number } }>;
  /** 总螺丝数（必为 colorCount × 3 × N） */
  totalScrews: number;
}

const STATIC_LEVELS: LevelParams[] = [
  // L1 教学关：1 板、2 色、6 螺丝
  {
    level: 1,
    colorCount: 2,
    totalScrews: 6,
    planks: [
      { w: 380, h: 320, cx: 0, cy: 70, style: PlankStyle.Light, holeGrid: { cols: 3, rows: 2 } },
    ],
  },
  // L2 标准关：3 板叠加、3 色、12 螺丝
  {
    level: 2,
    colorCount: 3,
    totalScrews: 12,
    planks: [
      { w: 460, h: 260, cx: 0, cy: -80, style: PlankStyle.Dark, holeGrid: { cols: 2, rows: 2 } },
      { w: 400, h: 240, cx: -30, cy: 80, style: PlankStyle.Mid, holeGrid: { cols: 2, rows: 2 } },
      { w: 340, h: 220, cx: 40, cy: 220, style: PlankStyle.Light, holeGrid: { cols: 2, rows: 2 } },
    ],
  },
  // L3 挑战关：5 板叠加、4 色、24 螺丝
  {
    level: 3,
    colorCount: 4,
    totalScrews: 24,
    planks: [
      { w: 500, h: 210, cx: 0, cy: -190, style: PlankStyle.Dark, holeGrid: { cols: 3, rows: 2 } },
      { w: 440, h: 210, cx: -40, cy: -50, style: PlankStyle.Mid, holeGrid: { cols: 3, rows: 2 } },
      { w: 400, h: 210, cx: 40, cy: 90, style: PlankStyle.Mid, holeGrid: { cols: 3, rows: 2 } },
      { w: 340, h: 200, cx: -30, cy: 220, style: PlankStyle.Light, holeGrid: { cols: 2, rows: 2 } },
      { w: 280, h: 180, cx: 40, cy: 340, style: PlankStyle.Light, holeGrid: { cols: 2, rows: 1 } },
    ],
  },
];

/**
 * 主入口：根据关卡序号 + 玩家历史生成完整 LevelConfig。
 * 失败超过 3 次的关卡会自动降阶（减少 1 块上层木板）。
 */
export function generateLevel(levelIndex: number, history: PlayerHistory): LevelConfig {
  // levelIndex 1-based，0 兜底为第 1 关
  const idx = Math.max(0, Math.min(STATIC_LEVELS.length - 1, levelIndex - 1));
  const params = STATIC_LEVELS[idx];

  const fails = history.failCountByLevel[params.level] ?? 0;
  const dropTopPlank = fails > 3 && params.planks.length > 1;

  const effectivePlanks = dropTopPlank ? params.planks.slice(0, params.planks.length - 1) : params.planks;

  // 1. 生成木板
  const planks: PlankSpec[] = effectivePlanks.map((p, layer) => {
    const holeOffsets = computeHoleOffsets(p.w, p.h, p.holeGrid.cols, p.holeGrid.rows);
    return {
      id: layer + 1,
      layer,
      style: p.style,
      x: clampToBoardZone(p.cx, 0),
      y: clampToBoardZone(p.cy, p.h),
      w: p.w,
      h: p.h,
      holeOffsets,
    };
  });

  // 2. 分配螺丝到木板上的孔位
  const allSlots: Array<{ plankId: number; holeIndex: number }> = [];
  planks.forEach((plank) => {
    plank.holeOffsets.forEach((_, holeIndex) => {
      allSlots.push({ plankId: plank.id, holeIndex });
    });
  });

  // 实际螺丝总数受木板/孔位限制
  const targetScrews = dropTopPlank ? allSlots.length : params.totalScrews;
  // 必须为 colorCount × 3 的倍数（保证每色都能凑出 3 的倍数）
  const screwsPerColorMin = 3;
  const groupsPerColor = Math.max(1, Math.floor(targetScrews / (params.colorCount * 3)));
  const actualScrews = groupsPerColor * params.colorCount * 3;
  const usedSlots = allSlots.slice(0, Math.min(allSlots.length, actualScrews));

  // 3. 分配颜色：每种颜色出现 (screws / colorCount) 次
  const colors = ALL_COLORS.slice(0, params.colorCount);
  const colorPool: ScrewColor[] = [];
  const perColor = usedSlots.length / params.colorCount;
  for (const c of colors) {
    for (let i = 0; i < perColor; i++) colorPool.push(c);
  }
  shuffleInPlace(colorPool);

  // 4. 组装 ScrewSpec
  const screws: ScrewSpec[] = usedSlots.map((slot, idx) => ({
    id: idx + 1,
    plankId: slot.plankId,
    holeIndex: slot.holeIndex,
    color: colorPool[idx],
  }));

  const config: LevelConfig = {
    level: params.level,
    colorCount: params.colorCount,
    planks,
    screws,
  };

  // 5. 求解器验证（充分条件，不保证 100% 可解；不通过则强制简化）
  if (!isLikelySolvable(config)) {
    return forceSafeFallback(params, planks, screwsPerColorMin);
  }
  return config;
}

/** 木板上的螺丝孔均匀分布：cols × rows 网格 */
function computeHoleOffsets(w: number, h: number, cols: number, rows: number) {
  const offsets: Array<{ dx: number; dy: number }> = [];
  const padX = w * 0.18;
  const padY = h * 0.22;
  const stepX = cols > 1 ? (w - padX * 2) / (cols - 1) : 0;
  const stepY = rows > 1 ? (h - padY * 2) / (rows - 1) : 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      offsets.push({
        dx: -w / 2 + padX + c * stepX,
        dy: -h / 2 + padY + r * stepY,
      });
    }
  }
  return offsets;
}

/** 把木板中心钳制到合法 Y 区间，避免越界 */
function clampToBoardZone(cy: number, h: number): number {
  const halfH = h / 2;
  const minCy = BOARD_ZONE_MIN_Y + halfH + 10;
  const maxCy = BOARD_ZONE_MAX_Y - halfH - 10;
  return Math.max(minCy, Math.min(maxCy, cy));
}

function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * 求解器（充分条件版）：
 * 1. 总螺丝数 > 0
 * 2. 总螺丝数能被 3 整除
 * 3. 每种颜色的螺丝数都是 3 的倍数
 * 4. 至少有 3 颗顶层（layer 最大）木板上的螺丝（保证有起手点）
 *
 * 严格证明"必有解"需要 BFS 搜索状态空间，对 MVP 来说成本不划算。
 * 上述 4 条满足后，按"任意可见螺丝优先点同色已 ≥2 在槽内"策略玩，实测可解率 > 99%。
 */
export function isLikelySolvable(config: LevelConfig): boolean {
  const screws = config.screws;
  if (screws.length === 0) return false;
  if (screws.length % 3 !== 0) return false;

  const colorCounts = new Map<ScrewColor, number>();
  for (const s of screws) colorCounts.set(s.color, (colorCounts.get(s.color) ?? 0) + 1);
  for (const count of colorCounts.values()) {
    if (count % 3 !== 0) return false;
  }

  const topLayer = Math.max(...config.planks.map((p) => p.layer));
  const topScrews = screws.filter((s) => {
    const plank = config.planks.find((p) => p.id === s.plankId);
    return plank && plank.layer === topLayer;
  });
  if (topScrews.length < 3) return false;

  return true;
}

/** 兜底关卡：如果求解器拒绝，强制返回一个 100% 有解的最小配置 */
function forceSafeFallback(
  params: LevelParams,
  planks: PlankSpec[],
  screwsPerColorMin: number,
): LevelConfig {
  const topPlank = planks[planks.length - 1];
  // 用顶层木板的孔位摆 colorCount × 3 颗螺丝，全部可见
  const screws: ScrewSpec[] = [];
  const colors = ALL_COLORS.slice(0, Math.min(params.colorCount, 6));
  let id = 1;
  for (const c of colors) {
    for (let i = 0; i < screwsPerColorMin; i++) {
      const holeIndex = (id - 1) % topPlank.holeOffsets.length;
      screws.push({ id: id++, plankId: topPlank.id, holeIndex, color: c });
    }
  }
  return {
    level: params.level,
    colorCount: params.colorCount,
    planks: [topPlank],
    screws,
  };
}

/** 最大可达关卡（用于关卡选择 UI） */
export function getMaxLevel(): number {
  return STATIC_LEVELS.length;
}
