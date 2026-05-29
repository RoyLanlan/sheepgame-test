/**
 * 拧丝 AI · 关卡生成器（v1.2，E 改：10 关参数化生成）
 *
 * 变更点（vs v1.1）：
 * - 从 3 关静态模板升级为 10 关参数化难度曲线 + 程序化布局
 * - 颜色分配用"拆解序列分组着色法"：先用 LevelSolver.findStripOrder 求一条
 *   合法拆解序列，再把序列每连续 3 颗指定同色。这样数学上保证可解
 *   （拧的过程中槽内同色峰值恒为 2，永不触发死局）
 * - 生成后用 LevelSolver.solveLevel 双校验；极端失败时退回 forceSafeFallback
 * - 同一关使用确定性随机种子（seed=level），保证布局稳定、可复现、可调试
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
import { findStripOrder, solveLevel } from './LevelSolver';

const DESIGN_W = 720;
const DESIGN_H = 1280;

/** 板区可用范围（避开顶部 HUD 18% + 底部颜色槽 30%） */
const BOARD_ZONE_MIN_Y = -DESIGN_H / 2 + DESIGN_H * 0.30; // ≈ -256
const BOARD_ZONE_MAX_Y = DESIGN_H / 2 - DESIGN_H * 0.18;  // ≈ 410
const BOARD_ZONE_CENTER_Y = (BOARD_ZONE_MIN_Y + BOARD_ZONE_MAX_Y) / 2;

/** 螺丝撒点网格 */
const GRID_STEP = 64;
const GRID_JITTER = 12;
const SCREW_SPREAD_X = 300;

const MAX_GENERATE_ATTEMPTS = 80;

// ============================================================
// 难度曲线（10 关）
// ============================================================

interface LevelPlan {
  level: number;
  colorCount: number;
  layers: number;
  plankCount: number;
  /** 必须是 colorCount × 3 的整数倍 */
  screwCount: number;
}

const LEVEL_PLANS: LevelPlan[] = [
  { level: 1,  colorCount: 2, layers: 1, plankCount: 1, screwCount: 6 },
  { level: 2,  colorCount: 2, layers: 1, plankCount: 2, screwCount: 12 },
  { level: 3,  colorCount: 3, layers: 2, plankCount: 2, screwCount: 9 },
  { level: 4,  colorCount: 3, layers: 2, plankCount: 3, screwCount: 18 },
  { level: 5,  colorCount: 4, layers: 3, plankCount: 3, screwCount: 12 },
  { level: 6,  colorCount: 4, layers: 3, plankCount: 4, screwCount: 24 },
  { level: 7,  colorCount: 4, layers: 4, plankCount: 4, screwCount: 24 },
  { level: 8,  colorCount: 5, layers: 4, plankCount: 5, screwCount: 15 },
  { level: 9,  colorCount: 5, layers: 4, plankCount: 5, screwCount: 30 },
  { level: 10, colorCount: 5, layers: 5, plankCount: 6, screwCount: 30 },
];

// ============================================================
// 确定性随机数（mulberry32）
// ============================================================

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(randRange(rng, min, max + 1));
}

// ============================================================
// 形状模板
// ============================================================

function shapeRect(w: number, h: number): RectCell[] {
  return [{ x: 0, y: 0, w, h }];
}

function shapeL(w: number, h: number): RectCell[] {
  const armW = w * 0.55;
  const armH = h * 0.45;
  return [
    { x: 0, y: -h / 2 + armH / 2, w, h: armH },
    { x: -w / 2 + armW / 2, y: armH / 2, w: armW, h: h - armH },
  ];
}

function shapeT(w: number, h: number): RectCell[] {
  const barH = h * 0.4;
  const stemW = w * 0.4;
  return [
    { x: 0, y: h / 2 - barH / 2, w, h: barH },
    { x: 0, y: -barH / 2, w: stemW, h: h - barH },
  ];
}

function shapeCross(w: number, h: number): RectCell[] {
  const armW = w * 0.4;
  const armH = h * 0.4;
  return [
    { x: 0, y: 0, w, h: armH },
    { x: 0, y: 0, w: armW, h },
  ];
}

type ShapeKind = 'rect' | 'L' | 'T' | 'cross';

function buildCells(shape: ShapeKind, w: number, h: number): RectCell[] {
  switch (shape) {
    case 'rect': return shapeRect(w, h);
    case 'L': return shapeL(w, h);
    case 'T': return shapeT(w, h);
    case 'cross': return shapeCross(w, h);
  }
}

// ============================================================
// 主入口
// ============================================================

export function generateLevel(levelIndex: number, _history: PlayerHistory): LevelConfig {
  const plan = LEVEL_PLANS[Math.max(0, Math.min(LEVEL_PLANS.length - 1, levelIndex - 1))];

  for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
    const rng = makeRng(plan.level * 100003 + attempt * 7919 + 1);
    const config = tryGenerate(plan, rng);
    if (config) return config;
  }

  // 兜底：保证 100% 可解
  return forceSafeFallback(plan);
}

/** 单次尝试：布局 → 撒点 → 拆解序列着色 → 求解双校验 */
function tryGenerate(plan: LevelPlan, rng: () => number): LevelConfig | null {
  // 1. 布局木板
  const planks = buildPlanks(plan, rng);

  // 2. 撒螺丝点（网格 + 抖动），推导 plankIds
  const candidates = scatterScrewCandidates(planks, rng);
  if (candidates.length < plan.screwCount) return null;

  // 3. 取 screwCount 个点（打乱后取前 N），优先点都在板上
  shuffleInPlace(candidates, rng);
  const picked = candidates.slice(0, plan.screwCount);

  // 4. 组装"无颜色"占位 config，求合法拆解序列
  const placeholder: LevelConfig = {
    level: plan.level,
    colorCount: plan.colorCount,
    planks,
    screws: picked.map((c, i) => ({
      id: i + 1,
      plankIds: c.plankIds,
      x: c.x,
      y: c.y,
      color: ScrewColor.Red,
    })),
  };
  const order = findStripOrder(placeholder);
  if (!order || order.length !== plan.screwCount) return null;

  // 5. 拆解序列分组着色：每连续 3 颗同色，组轮流分配 colorCount 种颜色
  const colors = ALL_COLORS.slice(0, plan.colorCount);
  const colorByIdx = new Array<ScrewColor>(plan.screwCount);
  const groupCount = plan.screwCount / 3;
  for (let g = 0; g < groupCount; g++) {
    const col = colors[g % plan.colorCount];
    for (let k = 0; k < 3; k++) colorByIdx[order[g * 3 + k]] = col;
  }

  const screws: ScrewSpec[] = picked.map((c, i) => ({
    id: i + 1,
    plankIds: c.plankIds,
    x: c.x,
    y: c.y,
    color: colorByIdx[i],
  }));

  const config: LevelConfig = {
    level: plan.level,
    colorCount: plan.colorCount,
    planks,
    screws,
  };

  // 6. 求解器双校验（分组着色法理论必过，这里防御性兜底）
  if (!solveLevel(config).solvable) return null;
  return config;
}

// ============================================================
// 木板布局
// ============================================================

function buildPlanks(plan: LevelPlan, rng: () => number): PlankSpec[] {
  const layerOfPlank = distributeLayers(plan.plankCount, plan.layers);
  const maxLayer = plan.layers - 1;
  const planks: PlankSpec[] = [];

  for (let i = 0; i < plan.plankCount; i++) {
    const layer = layerOfPlank[i];
    const depthFromBottom = layer; // 0 = 底层

    // 越高层的板越小
    const w = clamp(500 - depthFromBottom * 80 + randRange(rng, -20, 20), 180, 520);
    const h = clamp(400 - depthFromBottom * 65 + randRange(rng, -20, 20), 150, 440);

    const shape = pickShape(layer, maxLayer, rng);
    const cells = buildCells(shape, w, h);

    // 底层居中，高层错落（但都靠近中心，保证与下层重叠 → 螺丝可穿透多板）
    const ox = layer === 0 ? randRange(rng, -40, 40) : randRange(rng, -140, 140);
    const oy = BOARD_ZONE_CENTER_Y + (layer === 0 ? randRange(rng, -30, 30) : randRange(rng, -100, 100));
    const origin = clampOriginToZone({ x: ox, y: oy }, cells);

    const style = styleForLayer(layer, maxLayer);

    planks.push({ id: i + 1, layer, style, origin, cells });
  }

  return planks;
}

/** 把 plankCount 块板分配到 layers 层，保证每层至少 1 块，多余的加到中高层 */
function distributeLayers(plankCount: number, layers: number): number[] {
  const res: number[] = [];
  for (let l = 0; l < layers; l++) res.push(l);
  const extra = plankCount - layers;
  for (let k = 0; k < extra; k++) {
    if (layers === 1) res.push(0);
    else res.push(1 + (k % (layers - 1))); // 加到 layer 1..layers-1
  }
  return res.slice(0, plankCount);
}

function pickShape(layer: number, maxLayer: number, rng: () => number): ShapeKind {
  if (layer === 0) {
    // 底层偏向大块（矩形 / 十字）
    return rng() < 0.5 ? 'rect' : 'cross';
  }
  const pool: ShapeKind[] = ['rect', 'L', 'T', 'cross'];
  return pool[randInt(rng, 0, pool.length - 1)];
}

function styleForLayer(layer: number, maxLayer: number): PlankStyle {
  if (maxLayer === 0) return PlankStyle.Mid;
  if (layer === 0) return PlankStyle.Dark;
  if (layer === maxLayer) return PlankStyle.Light;
  return PlankStyle.Mid;
}

// ============================================================
// 螺丝撒点
// ============================================================

interface ScrewCandidate {
  x: number;
  y: number;
  plankIds: number[]; // 按 layer 降序
}

function scatterScrewCandidates(planks: PlankSpec[], rng: () => number): ScrewCandidate[] {
  const out: ScrewCandidate[] = [];
  for (let gx = -SCREW_SPREAD_X; gx <= SCREW_SPREAD_X; gx += GRID_STEP) {
    for (let gy = BOARD_ZONE_MIN_Y; gy <= BOARD_ZONE_MAX_Y; gy += GRID_STEP) {
      const x = gx + randRange(rng, -GRID_JITTER, GRID_JITTER);
      const y = gy + randRange(rng, -GRID_JITTER, GRID_JITTER);
      const hit = planks
        .filter((p) => isPointInPlank(x, y, p))
        .sort((a, b) => b.layer - a.layer);
      if (hit.length === 0) continue;
      out.push({ x, y, plankIds: hit.map((p) => p.id) });
    }
  }
  return out;
}

// ============================================================
// 工具
// ============================================================

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

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function shuffleInPlace<T>(arr: T[], rng: () => number) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * 兜底：单块大矩形板 + 网格螺丝，按"从上到下从左到右"顺序分组着色。
 * 单板无遮挡，任意顺序都合法，分组着色 100% 可解。
 */
function forceSafeFallback(plan: LevelPlan): LevelConfig {
  const w = 480;
  const h = 380;
  const cells = shapeRect(w, h);
  const origin = clampOriginToZone({ x: 0, y: BOARD_ZONE_CENTER_Y }, cells);
  const plank: PlankSpec = { id: 1, layer: 0, style: PlankStyle.Mid, origin, cells };

  // 在板内网格排布 screwCount 颗
  const n = plan.screwCount;
  const cols = Math.ceil(Math.sqrt(n * (w / h)));
  const rows = Math.ceil(n / cols);
  const padX = w * 0.14;
  const padY = h * 0.14;
  const usableW = w - padX * 2;
  const usableH = h - padY * 2;
  const stepX = cols > 1 ? usableW / (cols - 1) : 0;
  const stepY = rows > 1 ? usableH / (rows - 1) : 0;

  const positions: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < rows && positions.length < n; r++) {
    for (let c = 0; c < cols && positions.length < n; c++) {
      positions.push({
        x: origin.x - usableW / 2 + c * stepX,
        y: origin.y + usableH / 2 - r * stepY, // 从上往下
      });
    }
  }

  const colors = ALL_COLORS.slice(0, plan.colorCount);
  const screws: ScrewSpec[] = positions.map((p, i) => ({
    id: i + 1,
    plankIds: [plank.id],
    x: p.x,
    y: p.y,
    color: colors[Math.floor(i / 3) % plan.colorCount],
  }));

  return {
    level: plan.level,
    colorCount: plan.colorCount,
    planks: [plank],
    screws,
  };
}

export function getMaxLevel(): number {
  return LEVEL_PLANS.length;
}
