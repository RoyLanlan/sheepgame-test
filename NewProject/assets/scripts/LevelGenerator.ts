/**
 * 拧丝 AI · 关卡生成器（v1.1）
 *
 * 变更点（vs v1.0）：
 * - 木板支持多 cell 形状（矩形 / L / T / 十字）
 * - 同 layer 可多块板
 * - 螺丝按"屏幕绝对坐标"放置，自动检测穿透了哪些板（plankIds 自动推导）
 * - 求解器仍是充分条件版（生成成本可控），BFS 升级留待 v1.2
 */

import {
  ALL_COLORS,
  LevelConfig,
  PlankSpec,
  PlankStyle,
  PlayerHistory,
  RectCell,
  ScrewColor,
  ScrewSpec,
  isPointInPlank,
} from './LevelTypes';

const DESIGN_W = 720;
const DESIGN_H = 1280;

/** 板区可用 Y 范围（避开顶部 HUD 18% + 底部颜色槽 30%） */
const BOARD_ZONE_MIN_Y = -DESIGN_H / 2 + DESIGN_H * 0.30;
const BOARD_ZONE_MAX_Y = DESIGN_H / 2 - DESIGN_H * 0.18;

// ============================================================
// 形状模板（每个模板返回 cells，相对板原点）
// ============================================================

function shapeRect(w: number, h: number): RectCell[] {
  return [{ x: 0, y: 0, w, h }];
}

/** L 形：横边在底部，竖边在左上 */
function shapeL(w: number, h: number): RectCell[] {
  const armW = w * 0.55;
  const armH = h * 0.45;
  return [
    { x: 0, y: -h / 2 + armH / 2, w, h: armH },                // 底部横
    { x: -w / 2 + armW / 2, y: armH / 2, w: armW, h: h - armH }, // 左上竖
  ];
}

/** T 形：横边在顶部，竖边在中下 */
function shapeT(w: number, h: number): RectCell[] {
  const barH = h * 0.4;
  const stemW = w * 0.4;
  return [
    { x: 0, y: h / 2 - barH / 2, w, h: barH },                  // 顶部横
    { x: 0, y: -barH / 2, w: stemW, h: h - barH },              // 中下竖
  ];
}

/** 十字形 */
function shapeCross(w: number, h: number): RectCell[] {
  const armW = w * 0.4;
  const armH = h * 0.4;
  return [
    { x: 0, y: 0, w, h: armH },           // 横
    { x: 0, y: 0, w: armW, h },           // 竖
  ];
}

// ============================================================
// 关卡静态模板（3 关）
// ============================================================

interface PlankTemplate {
  layer: number;
  style: PlankStyle;
  shape: 'rect' | 'L' | 'T' | 'cross';
  w: number;
  h: number;
  /** 板原点（origin）相对屏幕中心的坐标 */
  ox: number;
  oy: number;
}

interface LevelTemplate {
  level: number;
  colorCount: number;
  planks: PlankTemplate[];
  /**
   * 螺丝坐标（屏幕本地绝对坐标）；plankIds 在生成阶段自动从 (x, y) 推导
   * （只要点落在哪些板的 cells 内，就属于哪些 plankIds）
   */
  screws: Array<{ x: number; y: number }>;
}

/**
 * L1 教学关：1 块大矩形板，6 颗螺丝，2 色
 */
const L1_TEMPLATE: LevelTemplate = {
  level: 1,
  colorCount: 2,
  planks: [
    { layer: 0, style: PlankStyle.Light, shape: 'rect', w: 440, h: 360, ox: 0, oy: 50 },
  ],
  screws: [
    // 2x3 网格
    { x: -120, y: 150 }, { x: 0, y: 150 }, { x: 120, y: 150 },
    { x: -120, y: -50 }, { x: 0, y: -50 }, { x: 120, y: -50 },
  ],
};

/**
 * L2 标准关：3 板叠加（L 形底 + 矩形中 + T 形顶），12 颗螺丝，3 色
 */
const L2_TEMPLATE: LevelTemplate = {
  level: 2,
  colorCount: 3,
  planks: [
    { layer: 0, style: PlankStyle.Dark, shape: 'L', w: 500, h: 380, ox: 0, oy: 0 },
    { layer: 1, style: PlankStyle.Mid, shape: 'rect', w: 320, h: 200, ox: 80, oy: 60 },
    { layer: 2, style: PlankStyle.Light, shape: 'T', w: 280, h: 240, ox: -40, oy: 100 },
  ],
  screws: [
    // 顶层 T 顶部横边（可见）
    { x: -150, y: 200 }, { x: -40, y: 200 }, { x: 70, y: 200 },
    // 顶层 T 竖边（可见）
    { x: -40, y: 30 },
    // 中层矩形（部分被 T 遮挡，部分露出右侧）
    { x: 180, y: 100 }, { x: 220, y: 0 },
    // 底层 L 形（露出右下区域和左下底边）
    { x: 220, y: -120 }, { x: 140, y: -150 },
    { x: -200, y: -120 }, { x: -100, y: -150 },
    { x: 60, y: -150 }, { x: -200, y: 100 },
  ],
};

/**
 * L3 挑战关：5 板叠加（十字底 + 2 块中 + 2 块顶），24 颗螺丝，4 色
 */
const L3_TEMPLATE: LevelTemplate = {
  level: 3,
  colorCount: 4,
  planks: [
    // 底板十字形（覆盖大部分区域）
    { layer: 0, style: PlankStyle.Dark, shape: 'cross', w: 560, h: 540, ox: 0, oy: 30 },
    // 中层 2 板
    { layer: 1, style: PlankStyle.Mid, shape: 'rect', w: 280, h: 180, ox: -120, oy: -100 },
    { layer: 1, style: PlankStyle.Mid, shape: 'L', w: 280, h: 240, ox: 120, oy: 60 },
    // 顶层 2 板
    { layer: 2, style: PlankStyle.Light, shape: 'rect', w: 200, h: 140, ox: -100, oy: 80 },
    { layer: 2, style: PlankStyle.Light, shape: 'T', w: 220, h: 200, ox: 100, oy: 180 },
  ],
  screws: [
    // 顶层 layer=2 矩形（左上）的螺丝（可见）
    { x: -140, y: 110 }, { x: -60, y: 110 }, { x: -100, y: 50 },
    // 顶层 layer=2 T 形（右上）的螺丝（可见）
    { x: 40, y: 220 }, { x: 100, y: 220 }, { x: 160, y: 220 },
    { x: 100, y: 130 },
    // 中层 layer=1 矩形（左下）的螺丝（部分可见）
    { x: -200, y: -130 }, { x: -120, y: -130 }, { x: -40, y: -130 },
    { x: -200, y: -60 }, { x: -40, y: -60 },
    // 中层 layer=1 L 形（右）的螺丝（部分可见）
    { x: 180, y: -10 }, { x: 240, y: 80 }, { x: 240, y: 0 },
    // 底层十字的螺丝（露出的部分）
    { x: 0, y: -200 }, { x: 0, y: -250 },
    { x: -250, y: 30 }, { x: -250, y: 100 },
    { x: 0, y: 290 }, { x: 0, y: 250 },
    { x: 250, y: -100 }, { x: 250, y: -180 },
    { x: -100, y: -250 }, { x: 100, y: -250 },
  ],
};

const STATIC_LEVELS: LevelTemplate[] = [L1_TEMPLATE, L2_TEMPLATE, L3_TEMPLATE];

// ============================================================
// 主入口
// ============================================================

export function generateLevel(levelIndex: number, history: PlayerHistory): LevelConfig {
  const idx = Math.max(0, Math.min(STATIC_LEVELS.length - 1, levelIndex - 1));
  const tpl = STATIC_LEVELS[idx];

  // 1. 把 PlankTemplate 转成 PlankSpec
  const planks: PlankSpec[] = tpl.planks.map((p, i) => {
    let cells: RectCell[];
    switch (p.shape) {
      case 'rect':  cells = shapeRect(p.w, p.h); break;
      case 'L':     cells = shapeL(p.w, p.h); break;
      case 'T':     cells = shapeT(p.w, p.h); break;
      case 'cross': cells = shapeCross(p.w, p.h); break;
    }
    return {
      id: i + 1,
      layer: p.layer,
      style: p.style,
      origin: clampOriginToZone({ x: p.ox, y: p.oy }, cells),
      cells,
    };
  });

  // 2. 处理每颗螺丝：推导穿透的板（plankIds），过滤"无板"的位置
  const validScrews: Array<{ x: number; y: number; plankIds: number[] }> = [];
  for (const s of tpl.screws) {
    const hitPlanks = planks
      .filter((p) => isPointInPlank(s.x, s.y, p))
      .sort((a, b) => b.layer - a.layer); // 最上面那块板在前
    if (hitPlanks.length === 0) continue; // 螺丝不在任何板内 → 丢弃
    validScrews.push({
      x: s.x,
      y: s.y,
      plankIds: hitPlanks.map((p) => p.id),
    });
  }

  // 3. 调整螺丝数为 (colorCount × 3) 的倍数（多余的从尾部截掉，保证可消除）
  const total = Math.floor(validScrews.length / (tpl.colorCount * 3)) * (tpl.colorCount * 3);
  const used = validScrews.slice(0, total);

  // 4. 颜色分配：每色 (total / colorCount) 颗
  const colors = ALL_COLORS.slice(0, tpl.colorCount);
  const colorPool: ScrewColor[] = [];
  const perColor = used.length / tpl.colorCount;
  for (const c of colors) for (let i = 0; i < perColor; i++) colorPool.push(c);
  shuffleInPlace(colorPool);

  // 5. 组装 ScrewSpec
  const screws: ScrewSpec[] = used.map((s, i) => ({
    id: i + 1,
    plankIds: s.plankIds,
    x: s.x,
    y: s.y,
    color: colorPool[i],
  }));

  const config: LevelConfig = {
    level: tpl.level,
    colorCount: tpl.colorCount,
    planks,
    screws,
  };

  // 6. 求解器校验，不通过则退回最小可解配置
  if (!isLikelySolvable(config)) {
    return forceSafeFallback(tpl, planks);
  }
  return config;
}

/**
 * 把板原点夹到屏幕板区，避免越界
 */
function clampOriginToZone(origin: { x: number; y: number }, cells: RectCell[]): { x: number; y: number } {
  let minY = Infinity, maxY = -Infinity;
  for (const c of cells) {
    minY = Math.min(minY, c.y - c.h / 2);
    maxY = Math.max(maxY, c.y + c.h / 2);
  }
  let oy = origin.y;
  if (origin.y + minY < BOARD_ZONE_MIN_Y) oy = BOARD_ZONE_MIN_Y - minY + 10;
  if (origin.y + maxY > BOARD_ZONE_MAX_Y) oy = BOARD_ZONE_MAX_Y - maxY - 10;
  return { x: origin.x, y: oy };
}

function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * 求解器（充分条件版，v1.1 与 v1.0 一致）：
 * 1. 螺丝总数 > 0 且 % 3 == 0
 * 2. 每色螺丝数都是 3 的倍数
 * 3. 至少 3 颗"顶层可见螺丝"（不被任何更高 layer 板覆盖）作为起手
 */
export function isLikelySolvable(config: LevelConfig): boolean {
  if (config.screws.length === 0) return false;
  if (config.screws.length % 3 !== 0) return false;

  const colorCounts = new Map<ScrewColor, number>();
  for (const s of config.screws) colorCounts.set(s.color, (colorCounts.get(s.color) ?? 0) + 1);
  for (const c of colorCounts.values()) if (c % 3 !== 0) return false;

  // 初始可见螺丝数 ≥ 3
  const visible = config.screws.filter((s) => isScrewInitiallyClickable(s, config));
  if (visible.length < 3) return false;

  return true;
}

/** 判断一颗螺丝在初始状态下是否可点 */
export function isScrewInitiallyClickable(s: ScrewSpec, config: LevelConfig): boolean {
  // 螺丝当前"穿透板集合的最大 layer"
  const maxOwnLayer = Math.max(
    ...s.plankIds.map((pid) => config.planks.find((p) => p.id === pid)?.layer ?? 0),
  );
  // 任何 layer 更高的板覆盖到这颗螺丝坐标 → 不可点
  for (const p of config.planks) {
    if (p.layer <= maxOwnLayer) continue;
    if (isPointInPlank(s.x, s.y, p)) return false;
  }
  return true;
}

/** 兜底：仅用顶层板 + colorCount×3 颗螺丝，保证 100% 有解 */
function forceSafeFallback(tpl: LevelTemplate, planks: PlankSpec[]): LevelConfig {
  const topPlank = planks[planks.length - 1];
  const colors = ALL_COLORS.slice(0, tpl.colorCount);
  const screws: ScrewSpec[] = [];
  let id = 1;
  // 把螺丝均匀放在顶层板的第一个 cell 内（一定可见）
  const cell = topPlank.cells[0];
  const cellCx = topPlank.origin.x + cell.x;
  const cellCy = topPlank.origin.y + cell.y;
  const cols = 3;
  const rows = tpl.colorCount;
  const padX = cell.w * 0.2;
  const padY = cell.h * 0.2;
  const stepX = (cell.w - padX * 2) / (cols - 1);
  const stepY = rows > 1 ? (cell.h - padY * 2) / (rows - 1) : 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      screws.push({
        id: id++,
        plankIds: [topPlank.id],
        x: cellCx - cell.w / 2 + padX + c * stepX,
        y: cellCy - cell.h / 2 + padY + r * stepY,
        color: colors[r % colors.length],
      });
    }
  }
  return {
    level: tpl.level,
    colorCount: tpl.colorCount,
    planks: [topPlank],
    screws,
  };
}

export function getMaxLevel(): number {
  return STATIC_LEVELS.length;
}
