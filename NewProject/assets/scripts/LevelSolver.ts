/**
 * 拧丝 AI · 关卡求解器（v1.2，B 改）
 *
 * 纯数据模块，**不依赖 cc**，可在 Node / 浏览器 / 微信环境直接跑，也便于单测。
 *
 * 精确模拟真实游戏规则（与 BoardManager + SlotManager + GameManager 一致）：
 *   1. 螺丝可点 ⇔ 没有任何"未掉落且 layer 高于该螺丝顶层穿透板"的板覆盖它的坐标
 *   2. 一块板的所有螺丝被拧出 → 板掉落（下层螺丝可能因此露出变可点）
 *   3. 拧出的螺丝进 6 格颜色槽；同色累计 3 颗立即整组消除
 *   4. 槽规则细节（来自 SlotManager / GameManager）：
 *      - pushScrew 在 len>=6 时直接失败（lose）
 *      - 某次拧出后槽内未消除螺丝数 == 6 ⇒ isDeadLockedFull ⇒ lose
 *      - isAllCleared 优先于死局判定 ⇒ "最后一颗即使填满槽也算赢"
 *
 * 求解策略：记忆化 DFS + 贪心（优先触发消除）+ 节点上限。
 * 在节点上限内找到一条通关序列 ⇒ solvable=true（一定真可解，因为给出了实际序列）。
 */

import { LevelConfig, isPointInPlank } from './LevelTypes';

const SLOT_CAPACITY = 6;
const DEFAULT_NODE_LIMIT = 200000;

export interface SolveResult {
  solvable: boolean;
  nodesExplored: number;
  /** 可解时给出一条螺丝拧出顺序（screw 在 config.screws 中的下标） */
  order?: number[];
}

interface SolverPre {
  n: number;
  colorOf: number[];
  /** 每颗螺丝穿透的板（板在 planks 中的下标） */
  piercedPlanks: number[][];
  /** 每颗螺丝的"遮挡威胁板"：这些板全部掉落后该螺丝才可点 */
  coverThreat: number[][];
  /** 每块板上的螺丝下标 */
  screwsOnPlank: number[][];
}

/** 预计算关卡的静态结构（遮挡关系、板-螺丝归属） */
function precompute(config: LevelConfig): SolverPre {
  const planks = config.planks;
  const screws = config.screws;
  const n = screws.length;

  const plankIdxById = new Map<number, number>();
  planks.forEach((p, i) => plankIdxById.set(p.id, i));

  const screwsOnPlank: number[][] = planks.map(() => []);
  const piercedPlanks: number[][] = screws.map(() => []);
  screws.forEach((s, si) => {
    for (const pid of s.plankIds) {
      const pi = plankIdxById.get(pid);
      if (pi !== undefined) {
        screwsOnPlank[pi].push(si);
        piercedPlanks[si].push(pi);
      }
    }
  });

  const coverThreat: number[][] = screws.map((s, si) => {
    const ownLayers = piercedPlanks[si].map((pi) => planks[pi].layer);
    const selfMaxLayer = ownLayers.length ? Math.max(...ownLayers) : 0;
    const threats: number[] = [];
    planks.forEach((p, pi) => {
      if (s.plankIds.includes(p.id)) return; // 自己穿透的板不会遮自己
      if (p.layer <= selfMaxLayer) return;   // 只有更高层的板才可能遮挡
      if (isPointInPlank(s.x, s.y, p)) threats.push(pi);
    });
    return threats;
  });

  return {
    n,
    colorOf: screws.map((s) => s.color as number),
    piercedPlanks,
    coverThreat,
    screwsOnPlank,
  };
}

/**
 * 完整求解：是否存在一条通关序列。
 */
export function solveLevel(config: LevelConfig, nodeLimit = DEFAULT_NODE_LIMIT): SolveResult {
  const pre = precompute(config);
  const { n, colorOf, piercedPlanks, coverThreat, screwsOnPlank } = pre;

  if (n === 0) return { solvable: false, nodesExplored: 0 };

  const removed = new Array<boolean>(n).fill(false);
  const plankRemaining = screwsOnPlank.map((arr) => arr.length);
  const slot = new Array<number>(6).fill(0); // 每色当前在槽内的数量（0..2）
  const order: number[] = [];
  const visited = new Set<string>();
  let nodes = 0;

  const stateKey = (slotTotal: number): string => {
    // removed 位图（n ≤ ~30）+ 槽状态
    let mask = '';
    for (let i = 0; i < n; i++) mask += removed[i] ? '1' : '0';
    return mask + '|' + slot.join(',') + '|' + slotTotal;
  };

  const isClickable = (i: number): boolean => {
    if (removed[i]) return false;
    for (const pi of coverThreat[i]) {
      if (plankRemaining[pi] > 0) return false; // 还有遮挡板未掉落
    }
    return true;
  };

  const dfs = (removedCount: number, slotTotal: number): boolean => {
    if (removedCount === n) return true;
    if (++nodes > nodeLimit) return false;

    const key = stateKey(slotTotal);
    if (visited.has(key)) return false;
    visited.add(key);

    // 收集当前可点螺丝
    const cand: number[] = [];
    for (let i = 0; i < n; i++) if (isClickable(i)) cand.push(i);
    if (cand.length === 0) return false; // 无可点 = 卡死

    // 贪心：优先拧"能立即触发消除"(slot==2) 的颜色，其次 slot==1，最后 slot==0
    cand.sort((a, b) => slot[colorOf[b]] - slot[colorOf[a]]);

    for (const i of cand) {
      const c = colorOf[i];
      if (slotTotal >= SLOT_CAPACITY) continue; // 槽已满无法再放 = 该步 lose

      const prev = slot[c];
      // 应用
      removed[i] = true;
      order.push(i);
      for (const pi of piercedPlanks[i]) plankRemaining[pi]--;

      let eliminated = false;
      slot[c] = prev + 1;
      if (slot[c] === 3) {
        slot[c] = 0;
        eliminated = true;
      }
      const newTotal = eliminated ? slotTotal - 2 : slotTotal + 1;

      // 拧到最后一颗 ⇒ 直接赢（isAllCleared 优先）；否则槽满 6 = 死局，剪掉
      const proceed = removedCount + 1 === n || newTotal < SLOT_CAPACITY;
      if (proceed && dfs(removedCount + 1, newTotal)) return true;

      // 回溯
      slot[c] = prev;
      for (const pi of piercedPlanks[i]) plankRemaining[pi]++;
      order.pop();
      removed[i] = false;
    }
    return false;
  };

  const solvable = dfs(0, 0);
  return {
    solvable,
    nodesExplored: nodes,
    order: solvable ? order.slice() : undefined,
  };
}

/**
 * 仅按遮挡约束求一条"全剥离顺序"，忽略颜色与槽。
 *
 * 用于关卡生成的"分组着色法"：得到合法拆解序列后，每连续 3 颗指定同色，
 * 即可数学上保证关卡可解（拧的过程中槽内同色峰值恒为 2，永不死局）。
 *
 * 返回 null 表示该布局存在"环形遮挡"无法全部剥离（需要重新生成布局）。
 */
export function findStripOrder(config: LevelConfig): number[] | null {
  const pre = precompute(config);
  const { n, piercedPlanks, coverThreat, screwsOnPlank } = pre;
  if (n === 0) return null;

  const removed = new Array<boolean>(n).fill(false);
  const plankRemaining = screwsOnPlank.map((arr) => arr.length);
  const order: number[] = [];

  const isClickable = (i: number): boolean => {
    if (removed[i]) return false;
    for (const pi of coverThreat[i]) if (plankRemaining[pi] > 0) return false;
    return true;
  };

  for (let step = 0; step < n; step++) {
    // 贪心选最上层（coverThreat 最少）的可点螺丝，先剥顶层
    let pick = -1;
    let bestThreat = Infinity;
    for (let i = 0; i < n; i++) {
      if (!isClickable(i)) continue;
      const t = piercedPlanks[i].length;
      if (t < bestThreat) {
        bestThreat = t;
        pick = i;
      }
    }
    if (pick === -1) return null; // 卡死，布局非法
    removed[pick] = true;
    order.push(pick);
    for (const pi of piercedPlanks[pick]) plankRemaining[pi]--;
  }
  return order;
}
