/**
 * 拧丝 AI · 关卡数据类型定义
 *
 * 设计原则：
 * - 纯数据类型，零 Cocos 依赖，便于在 GameManager / LevelGenerator / BoardManager 之间安全传递
 * - 所有坐标都是"设计分辨率 720×1280 下、以屏幕中心为原点"的本地坐标
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

/** 木板纹理风格（MVP 仅用色块区分） */
export enum PlankStyle {
  Light = 0,
  Mid = 1,
  Dark = 2,
}

/**
 * 木板生成参数
 * - layer：层级，0 = 最底层，数值越大越靠上（越后摆放、越先被拧光）
 * - x/y：木板中心点的屏幕本地坐标
 * - w/h：木板宽高（像素）
 * - holeOffsets：木板上每个螺丝孔相对板中心的偏移坐标
 */
export interface PlankSpec {
  id: number;
  layer: number;
  style: PlankStyle;
  x: number;
  y: number;
  w: number;
  h: number;
  holeOffsets: Array<{ dx: number; dy: number }>;
}

/**
 * 螺丝生成参数
 * - plankId：所属木板 ID
 * - holeIndex：在该木板 holeOffsets 数组中的索引（用于定位最终位置）
 * - color：颜色（决定进哪个颜色槽）
 */
export interface ScrewSpec {
  id: number;
  plankId: number;
  holeIndex: number;
  color: ScrewColor;
}

/** 完整关卡配置（由 LevelGenerator 产出） */
export interface LevelConfig {
  /** 关卡序号（从 1 开始） */
  level: number;
  /** 颜色种数（≤ 6） */
  colorCount: number;
  planks: PlankSpec[];
  screws: ScrewSpec[];
}

/** AI 叙事（由 AiNarrator 产出，含本地兜底） */
export interface LevelNarrative {
  /** 关卡名，例："拧下时光机的最后一颗螺丝" */
  title: string;
  /** 30 字微叙事 */
  story: string;
  /** 通关时显示的一句鼓励 */
  encourage: string;
  /** 来源：ai = 大模型，fallback = 本地兜底池 */
  source: 'ai' | 'fallback';
}

/** 玩家历史档案（用于难度学习器 + 续玩） */
export interface PlayerHistory {
  /** 全局最高到达过的关卡 */
  bestLevel: number;
  /** 各关最佳通关耗时（秒）；未通过为 0 */
  bestTimeByLevel: Record<number, number>;
  /** 各关失败次数（用于动态降难度） */
  failCountByLevel: Record<number, number>;
}

export function emptyHistory(): PlayerHistory {
  return {
    bestLevel: 0,
    bestTimeByLevel: {},
    failCountByLevel: {},
  };
}
