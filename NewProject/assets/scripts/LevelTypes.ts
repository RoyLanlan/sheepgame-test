/**
 * 拧丝 AI · 关卡数据类型定义（v1.1）
 *
 * 设计变更（vs v1.0）：
 * - PlankSpec 改为 "轴对齐矩形单元集合"，可表达 矩形/L/T/十字/阶梯等任意形状
 * - 同 layer 可有多块板，互不重叠或部分重叠均允许
 * - ScrewSpec.plankIds 表达"一颗螺丝穿透多块板"（按 layer 降序）
 * - 螺丝坐标改为屏幕本地绝对坐标，与板解耦
 */

/** 6 种螺丝颜色（编号即唯一 ID） */
export enum ScrewColor {
  Red = 0,
  Orange = 1,
  Yellow = 2,
  Green = 3,
  Blue = 4,
  Purple = 5,
}

export const ALL_COLORS: ScrewColor[] = [
  ScrewColor.Red,
  ScrewColor.Orange,
  ScrewColor.Yellow,
  ScrewColor.Green,
  ScrewColor.Blue,
  ScrewColor.Purple,
];

/** 螺丝颜色对应的十六进制色（绘制用） */
export const COLOR_HEX: Record<ScrewColor, string> = {
  [ScrewColor.Red]: '#E64A4A',
  [ScrewColor.Orange]: '#F39A2B',
  [ScrewColor.Yellow]: '#F2D047',
  [ScrewColor.Green]: '#5BB85B',
  [ScrewColor.Blue]: '#4A8FE6',
  [ScrewColor.Purple]: '#9B65D8',
};

/** 木板纹理风格 */
export enum PlankStyle {
  Light = 0,
  Mid = 1,
  Dark = 2,
}

/** 轴对齐矩形单元（cell 的中心点为 (x, y)，宽 w 高 h） */
export interface RectCell {
  /** cell 中心点相对板原点的 X 偏移 */
  x: number;
  /** cell 中心点相对板原点的 Y 偏移 */
  y: number;
  w: number;
  h: number;
}

/**
 * 木板规格（v1.1）
 *
 * 板由若干轴对齐矩形单元（cells）组成，cells 的并集就是板的形状。
 * 单 cell = 矩形板；多 cell 组合 = L / T / 十字 / 阶梯 / 不规则板。
 *
 * 例：L 形板可以由 2 个 cell 组成：
 *   横边 cell：x=0, y=0, w=200, h=80
 *   竖边 cell：x=-60, y=80, w=80, h=120
 */
export interface PlankSpec {
  id: number;
  layer: number;
  style: PlankStyle;
  /** 板原点（所有 cells 的坐标都相对此点）在屏幕本地坐标系中的位置 */
  origin: { x: number; y: number };
  /** 矩形单元数组，长度 ≥ 1；并集表示整个板的形状 */
  cells: RectCell[];
}

/**
 * 螺丝规格（v1.1）
 *
 * 一颗螺丝可同时固定多块板（穿透 plankIds）。
 * 拧出螺丝 → 从所有 plankIds 板的"未拧螺丝集合"中移除自己；
 * 当某板的"未拧螺丝集合"为空 → 该板触发掉落 → 销毁 → 重算遮挡。
 *
 * 螺丝位置为屏幕本地绝对坐标，与任何板都不耦合（板掉落时螺丝早已飞走）。
 */
export interface ScrewSpec {
  id: number;
  /** 该螺丝穿透固定的板的 ID 集合，按 layer 降序（最上面那块板在前） */
  plankIds: number[];
  /** 屏幕本地绝对坐标 */
  x: number;
  y: number;
  color: ScrewColor;
}

/** 完整关卡配置 */
export interface LevelConfig {
  /** 关卡序号（从 1 开始） */
  level: number;
  /** 颜色种数（≤ 6） */
  colorCount: number;
  planks: PlankSpec[];
  screws: ScrewSpec[];
}

/** AI 叙事（不变） */
export interface LevelNarrative {
  title: string;
  story: string;
  encourage: string;
  source: 'ai' | 'fallback';
}

/** 玩家历史档案（不变） */
export interface PlayerHistory {
  bestLevel: number;
  bestTimeByLevel: Record<number, number>;
  failCountByLevel: Record<number, number>;
}

export function emptyHistory(): PlayerHistory {
  return {
    bestLevel: 0,
    bestTimeByLevel: {},
    failCountByLevel: {},
  };
}

// ============================================================
// 几何工具（v1.1 新增）
// ============================================================

/**
 * 判断点 (px, py) 是否位于板内（落在任一 cell 内即视为在板内）
 */
export function isPointInPlank(px: number, py: number, plank: PlankSpec): boolean {
  for (const cell of plank.cells) {
    const cx = plank.origin.x + cell.x;
    const cy = plank.origin.y + cell.y;
    if (
      px >= cx - cell.w / 2 &&
      px <= cx + cell.w / 2 &&
      py >= cy - cell.h / 2 &&
      py <= cy + cell.h / 2
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 板的世界包围盒（用于绘制范围、相机/HUD 安全区判断）
 */
export function getPlankBoundingBox(plank: PlankSpec): {
  minX: number; minY: number; maxX: number; maxY: number;
} {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of plank.cells) {
    const cx = plank.origin.x + c.x;
    const cy = plank.origin.y + c.y;
    minX = Math.min(minX, cx - c.w / 2);
    minY = Math.min(minY, cy - c.h / 2);
    maxX = Math.max(maxX, cx + c.w / 2);
    maxY = Math.max(maxY, cy + c.h / 2);
  }
  return { minX, minY, maxX, maxY };
}
