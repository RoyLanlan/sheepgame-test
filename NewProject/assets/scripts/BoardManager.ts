/**
 * 拧丝 AI · 木板与螺丝管理器（v1.1）
 *
 * 变更点（vs v1.0）：
 * - 木板用 cells（矩形单元集合）绘制，支持 L / T / 十字 / 矩形等形状
 * - 螺丝节点挂在 BoardRoot 下（不再是板的子节点），位置用屏幕本地绝对坐标
 * - 一颗螺丝可穿透多块板（plankIds），所有穿透板都要从未拧螺丝列表中移除
 * - 当一块板的"未拧螺丝列表"清空 → 触发板掉落动画 → 销毁板 → recheckClickable
 * - 遮挡判定：螺丝可点 ⇔ 没有任何 layer > 它当前最顶层穿透板 layer 的板覆盖到它的坐标
 */

import {
  _decorator,
  Color,
  Component,
  EventTouch,
  Graphics,
  Node,
  Sprite,
  UIOpacity,
  UITransform,
  Vec3,
  tween,
} from 'cc';
import type { GameManager } from './GameManager';
import {
  COLOR_HEX,
  LevelConfig,
  PlankSpec,
  PlankStyle,
  RectCell,
  ScrewColor,
  ScrewSpec,
  isPointInPlank,
} from './LevelTypes';
import { prepUiNode } from './UiUtil';
import { AssetLoader } from './AssetLoader';

const { ccclass } = _decorator;

const SCREW_DIAMETER = 48;
const TAP_DEBOUNCE_MS = 100; // 见 SPEC U-1
const PLANK_DROP_DURATION = 0.45;

function hexToColor(hex: string, alpha = 255): Color {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return new Color(r, g, b, alpha);
}

const PLANK_FILLS: Record<PlankStyle, Color> = {
  [PlankStyle.Light]: hexToColor('#D4A574'),
  [PlankStyle.Mid]: hexToColor('#A07343'),
  [PlankStyle.Dark]: hexToColor('#7A4E2A'),
};

const PLANK_BORDER: Record<PlankStyle, Color> = {
  [PlankStyle.Light]: hexToColor('#8B6238'),
  [PlankStyle.Mid]: hexToColor('#6B4A26'),
  [PlankStyle.Dark]: hexToColor('#4A2D14'),
};

/** 木纹贴图(浅米色)的染色 tint（multiply）：三档木色深浅 */
const PLANK_TINT: Record<PlankStyle, Color> = {
  [PlankStyle.Light]: new Color(255, 236, 205, 255),
  [PlankStyle.Mid]: new Color(214, 168, 120, 255),
  [PlankStyle.Dark]: new Color(150, 110, 70, 255),
};

interface BoardScrewRuntime {
  spec: ScrewSpec;
  node: Node;
  /** 屏幕本地绝对坐标（与 spec.x/y 一致，缓存为字段方便遮挡运算） */
  worldX: number;
  worldY: number;
  /** 当前是否可点 */
  clickable: boolean;
  removed: boolean;
  lastTapMs: number;
}

interface PlankRuntime {
  spec: PlankSpec;
  node: Node;
  /** 该板"未拧螺丝"的 ID 集合 */
  remainingScrews: Set<number>;
  /** 是否正在掉落 / 已掉落 */
  dropped: boolean;
}

@ccclass('BoardManager')
export class BoardManager extends Component {
  private game!: GameManager;
  private boardRoot!: Node;
  private planks = new Map<number, PlankRuntime>();
  private screws: BoardScrewRuntime[] = [];

  bindGame(game: GameManager) {
    this.game = game;
  }

  ensureRoots() {
    this.boardRoot = this.findOrCreateByPath('Canvas/BoardRoot');
  }

  buildLevel(config: LevelConfig) {
    this.ensureRoots();
    this.clearAll();

    // 1. 绘制木板（按 layer 升序入场，layer 大者后渲染 = 视觉在上）
    const planksOrdered = [...config.planks].sort((a, b) => a.layer - b.layer);
    for (const plank of planksOrdered) {
      const node = this.createPlankNode(plank);
      node.setParent(this.boardRoot);
      node.setPosition(plank.origin.x, plank.origin.y, 0);
      node.setSiblingIndex(100 + plank.layer);
      this.planks.set(plank.id, {
        spec: plank,
        node,
        remainingScrews: new Set<number>(),
        dropped: false,
      });
    }

    // 2. 绘制螺丝（挂在 BoardRoot 下，绝对坐标）
    for (const screwSpec of config.screws) {
      const node = this.createScrewNode(screwSpec);
      node.setParent(this.boardRoot);
      node.setPosition(screwSpec.x, screwSpec.y, 0);
      node.setSiblingIndex(10000 + screwSpec.id); // 螺丝永远在木板上方

      this.screws.push({
        spec: screwSpec,
        node,
        worldX: screwSpec.x,
        worldY: screwSpec.y,
        clickable: false,
        removed: false,
        lastTapMs: 0,
      });

      // 把这颗螺丝挂到它穿透的所有板的 remainingScrews 上
      for (const pid of screwSpec.plankIds) {
        const pr = this.planks.get(pid);
        if (pr) pr.remainingScrews.add(screwSpec.id);
      }
    }

    this.recheckClickable();
  }

  /** 重算所有螺丝的可点击状态 */
  recheckClickable() {
    for (const s of this.screws) {
      if (s.removed) continue;
      s.clickable = !this.isOccluded(s);
      this.applyScrewVisual(s);
    }
  }

  /**
   * 一颗螺丝是否被覆盖：
   *   存在任意一块"未掉落且 layer 大于该螺丝当前最顶层穿透板 layer"的板，
   *   且这块板的 cells 任意一个矩形覆盖到螺丝坐标 → 视为被遮挡
   */
  private isOccluded(screw: BoardScrewRuntime): boolean {
    // 该螺丝当前实际仍存在的穿透板（已掉落的板忽略）
    const alivePiercedLayers = screw.spec.plankIds
      .map((pid) => this.planks.get(pid))
      .filter((pr) => pr && !pr.dropped)
      .map((pr) => pr!.spec.layer);
    if (alivePiercedLayers.length === 0) return false; // 所有穿透板都掉了，理论上不会发生（螺丝早被拧走）
    const selfMaxLayer = Math.max(...alivePiercedLayers);

    for (const pr of this.planks.values()) {
      if (pr.dropped) continue;
      if (pr.spec.layer <= selfMaxLayer) continue;
      if (isPointInPlank(screw.worldX, screw.worldY, pr.spec)) return true;
    }
    return false;
  }

  isAllCleared(): boolean {
    return this.screws.every((s) => s.removed);
  }

  /** 道具预留：洗牌剩余螺丝颜色 */
  shuffleRemaining() {
    const alive = this.screws.filter((s) => !s.removed);
    if (alive.length < 2) return;
    const colors = alive.map((s) => s.spec.color);
    for (let i = colors.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [colors[i], colors[j]] = [colors[j], colors[i]];
    }
    alive.forEach((s, idx) => {
      s.spec.color = colors[idx];
      this.applyScrewVisual(s);
    });
  }

  clearAll() {
    this.planks.forEach((pr) => pr.node?.destroy());
    this.planks.clear();
    for (const s of this.screws) s.node?.destroy();
    this.screws = [];
    if (this.boardRoot?.isValid) {
      for (const child of this.boardRoot.children.slice()) {
        if (/^Plank_\d+$/.test(child.name) || /^Screw_\d+$/.test(child.name)) {
          child.destroy();
        }
      }
    }
  }

  // ============================================================
  // 节点创建 / 绘制
  // ============================================================

  private createPlankNode(plank: PlankSpec): Node {
    const node = new Node(`Plank_${plank.id}`);
    prepUiNode(node);
    // 板的 UITransform 用包围盒尺寸（便于布局/调试）
    const ui = node.addComponent(UITransform);
    const bbox = this.getPlankBBox(plank.cells);
    ui.setContentSize(bbox.w, bbox.h);

    const tile = AssetLoader.get('plankTile');
    if (tile) {
      // 有图：每个 cell 贴一张九宫格木纹 Sprite，cells 并集即板形状
      const tint = PLANK_TINT[plank.style];
      for (const c of plank.cells) {
        const cellNode = new Node('Cell');
        prepUiNode(cellNode);
        cellNode.setParent(node);
        cellNode.setPosition(c.x, c.y, 0);
        cellNode.addComponent(UITransform).setContentSize(c.w, c.h);
        const sp = cellNode.addComponent(Sprite);
        sp.spriteFrame = tile;
        sp.type = Sprite.Type.SLICED; // 九宫格（border 在编辑器里设）
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.color = tint;
      }
    } else {
      // 无图：回退 Graphics 绘制
      const g = node.addComponent(Graphics);
      this.drawPlank(g, plank);
    }

    return node;
  }

  private getPlankBBox(cells: RectCell[]): { w: number; h: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of cells) {
      minX = Math.min(minX, c.x - c.w / 2);
      minY = Math.min(minY, c.y - c.h / 2);
      maxX = Math.max(maxX, c.x + c.w / 2);
      maxY = Math.max(maxY, c.y + c.h / 2);
    }
    return { w: maxX - minX, h: maxY - minY };
  }

  /** 把若干轴对齐矩形 cell 用 Graphics 绘制成"看起来像一整块板" */
  private drawPlank(g: Graphics, plank: PlankSpec) {
    const fill = PLANK_FILLS[plank.style];
    const border = PLANK_BORDER[plank.style];
    const innerShade = new Color(border.r, border.g, border.b, 90);

    // 1. 先把所有 cell 用 fillColor 实心填一遍（圆角矩形，重叠区会自然合并）
    g.fillColor = fill;
    for (const c of plank.cells) {
      g.roundRect(c.x - c.w / 2, c.y - c.h / 2, c.w, c.h, 14);
      g.fill();
    }

    // 2. 木纹（每个 cell 内画 2 条横线）
    g.lineWidth = 2;
    g.strokeColor = innerShade;
    for (const c of plank.cells) {
      const lines = c.h > 120 ? 3 : 2;
      for (let i = 1; i <= lines; i++) {
        const ly = c.y - c.h / 2 + (c.h / (lines + 1)) * i;
        g.moveTo(c.x - c.w / 2 + 14, ly);
        g.lineTo(c.x + c.w / 2 - 14, ly);
      }
    }
    g.stroke();

    // 3. 每个 cell 描一圈边框（重叠处会有"内骨架"效果，更接近真实板感）
    g.lineWidth = 3;
    g.strokeColor = border;
    for (const c of plank.cells) {
      g.roundRect(c.x - c.w / 2, c.y - c.h / 2, c.w, c.h, 14);
      g.stroke();
    }
  }

  private createScrewNode(spec: ScrewSpec): Node {
    const node = new Node(`Screw_${spec.id}`);
    prepUiNode(node);
    const ui = node.addComponent(UITransform);
    ui.setContentSize(SCREW_DIAMETER, SCREW_DIAMETER);

    const sf = AssetLoader.get('screw');
    if (sf) {
      // 有图：白色螺丝贴图 × 顶点色 = 染色螺丝
      const sp = node.addComponent(Sprite);
      sp.spriteFrame = sf;
      sp.type = Sprite.Type.SIMPLE;
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      sp.color = hexToColor(COLOR_HEX[spec.color]);
    } else {
      // 无图：回退 Graphics 绘制
      const g = node.addComponent(Graphics);
      this.drawScrew(g, spec.color, true);
    }

    node.on(Node.EventType.TOUCH_END, (e: EventTouch) => this.onScrewTap(spec.id, e), this);
    return node;
  }

  private drawScrew(g: Graphics, color: ScrewColor, clickable: boolean) {
    g.clear();
    const r = SCREW_DIAMETER / 2;
    const base = hexToColor(COLOR_HEX[color]);
    const fill = clickable ? base : this.dimDesat(base, 0.55, 0.5);
    const stroke = clickable
      ? new Color(Math.max(0, base.r - 60), Math.max(0, base.g - 60), Math.max(0, base.b - 60), 255)
      : new Color(80, 80, 80, 200);

    g.fillColor = fill;
    g.circle(0, 0, r);
    g.fill();
    g.lineWidth = 2.5;
    g.strokeColor = stroke;
    g.circle(0, 0, r);
    g.stroke();

    const slot = r * 0.42;
    g.lineWidth = 4;
    g.strokeColor = clickable
      ? new Color(255, 255, 255, 220)
      : new Color(220, 220, 220, 160);
    g.moveTo(-slot, 0);
    g.lineTo(slot, 0);
    g.moveTo(0, -slot);
    g.lineTo(0, slot);
    g.stroke();

    if (clickable) {
      g.fillColor = new Color(255, 255, 255, 180);
      g.circle(-r * 0.35, r * 0.35, r * 0.14);
      g.fill();
    }
  }

  private applyScrewVisual(s: BoardScrewRuntime) {
    const sp = s.node.getComponent(Sprite);
    if (sp) {
      // Sprite 版：顶点色染色，不可点时压暗
      const base = hexToColor(COLOR_HEX[s.spec.color]);
      sp.color = s.clickable ? base : this.dimDesat(base, 0.55, 0.5);
    } else {
      const g = s.node.getComponent(Graphics);
      if (g) this.drawScrew(g, s.spec.color, s.clickable);
    }
    const op = s.node.getComponent(UIOpacity) ?? s.node.addComponent(UIOpacity);
    op.opacity = s.clickable ? 255 : 180;
  }

  private dimDesat(base: Color, brightness: number, saturation: number): Color {
    const r0 = base.r * brightness;
    const g0 = base.g * brightness;
    const b0 = base.b * brightness;
    const gray = 0.299 * r0 + 0.587 * g0 + 0.114 * b0;
    const r = gray + (r0 - gray) * saturation;
    const gV = gray + (g0 - gray) * saturation;
    const b = gray + (b0 - gray) * saturation;
    return new Color(Math.round(r), Math.round(gV), Math.round(b), base.a);
  }

  // ============================================================
  // 用户交互
  // ============================================================

  private onScrewTap(screwId: number, e: EventTouch) {
    e.propagationStopped = true;
    const s = this.screws.find((x) => x.spec.id === screwId);
    if (!s || s.removed || !s.clickable) return;

    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - s.lastTapMs < TAP_DEBOUNCE_MS) return;
    s.lastTapMs = now;

    if (!this.game?.canAcceptScrewTap()) return;

    s.removed = true;

    // 从所有穿透板的 remainingScrews 中移除
    const plankIdsToCheckDrop: number[] = [];
    for (const pid of s.spec.plankIds) {
      const pr = this.planks.get(pid);
      if (!pr || pr.dropped) continue;
      pr.remainingScrews.delete(s.spec.id);
      if (pr.remainingScrews.size === 0) plankIdsToCheckDrop.push(pid);
    }

    // 螺丝节点已挂在 BoardRoot 下（绝对坐标），直接播飞出动画
    s.node.off(Node.EventType.TOUCH_END);
    s.node.setSiblingIndex(99999);

    tween(s.node)
      .by(0.18, { angle: 360, position: new Vec3(0, 30, 0), scale: new Vec3(0.1, 0.1, 0) }, { easing: 'sineOut' })
      .start();

    // 立即上报 GameManager（飞入颜色槽 + 胜负判定）
    this.game.onScrewPicked(s.node, s.spec.color);

    // 触发空板掉落（异步，掉完会 recheckClickable）
    for (const pid of plankIdsToCheckDrop) {
      this.dropPlank(pid);
    }

    // 螺丝拧出后立刻 recheckClickable（在板掉落动画播放期间也有变化）
    this.recheckClickable();
  }

  /** 当一块板的所有螺丝都拧光：播放下落+缩小+渐隐 → 销毁 → 重算遮挡 */
  private dropPlank(plankId: number) {
    const pr = this.planks.get(plankId);
    if (!pr || pr.dropped) return;
    pr.dropped = true;

    const op = pr.node.getComponent(UIOpacity) ?? pr.node.addComponent(UIOpacity);

    tween(pr.node)
      .by(PLANK_DROP_DURATION, { position: new Vec3(0, -200, 0), scale: new Vec3(-0.15, -0.15, 0) }, { easing: 'quadIn' })
      .start();

    tween(op)
      .to(PLANK_DROP_DURATION, { opacity: 0 }, { easing: 'quadIn' })
      .call(() => {
        if (pr.node?.isValid) pr.node.destroy();
        // 板已彻底消失，重算遮挡（下层螺丝可能变可点）
        this.recheckClickable();
      })
      .start();
  }

  // ============================================================
  // 工具
  // ============================================================

  private findOrCreateByPath(path: string): Node {
    const parts = path.split('/').filter(Boolean);
    let cur: Node | null = null;
    for (const name of parts) {
      const parent = cur ?? this.node.scene;
      if (!parent) {
        cur = new Node(name);
        continue;
      }
      let child = parent.getChildByName(name);
      if (!child) {
        child = new Node(name);
        prepUiNode(child);
        child.setParent(parent);
      }
      cur = child;
    }
    return cur!;
  }
}
