/**
 * 拧丝 AI · 木板与螺丝管理器（替换原 CardManager）
 *
 * 职责：
 * - 根据 LevelConfig 绘制木板 + 螺丝
 * - 处理螺丝点击（带 100ms 防误触）
 * - 计算"被上层木板遮挡"的螺丝（不可点 + 灰度）
 * - 螺丝被拧出时：detach 到 BoardRoot（保持世界坐标），由 SlotManager 接管飞行动画
 */

import {
  _decorator,
  Color,
  Component,
  EventTouch,
  Graphics,
  Node,
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
  ScrewColor,
  ScrewSpec,
} from './LevelTypes';
import { prepUiNode } from './UiUtil';

const { ccclass } = _decorator;

const SCREW_DIAMETER = 50;
const TAP_DEBOUNCE_MS = 100; // 见 SPEC U-1

/** 解析十六进制 → cc.Color */
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

interface BoardScrewRuntime {
  spec: ScrewSpec;
  node: Node;
  /** 屏幕本地坐标（板心 + 孔偏移） */
  worldLocalX: number;
  worldLocalY: number;
  /** 当前是否可点（被上层板遮挡时为 false） */
  clickable: boolean;
  removed: boolean;
  lastTapMs: number;
}

@ccclass('BoardManager')
export class BoardManager extends Component {
  private game!: GameManager;
  private boardRoot!: Node;
  private planks: PlankSpec[] = [];
  private screws: BoardScrewRuntime[] = [];
  private plankNodes = new Map<number, Node>();

  bindGame(game: GameManager) {
    this.game = game;
  }

  ensureRoots() {
    this.boardRoot = this.findOrCreateByPath('Canvas/BoardRoot');
  }

  buildLevel(config: LevelConfig) {
    this.ensureRoots();
    this.clearAll();
    this.planks = config.planks.slice();

    // 1. 绘制木板（按 layer 升序，layer 大者后渲染 = 视觉上"在上")
    const planksOrdered = [...config.planks].sort((a, b) => a.layer - b.layer);
    for (const plank of planksOrdered) {
      const node = this.createPlankNode(plank);
      node.setParent(this.boardRoot);
      node.setPosition(plank.x, plank.y, 0);
      node.setSiblingIndex(100 + plank.layer); // layer 大者在前
      this.plankNodes.set(plank.id, node);
    }

    // 2. 绘制螺丝（作为对应木板的子节点）
    for (const screwSpec of config.screws) {
      const plank = this.planks.find((p) => p.id === screwSpec.plankId)!;
      const hole = plank.holeOffsets[screwSpec.holeIndex];
      const parentNode = this.plankNodes.get(plank.id)!;

      const node = this.createScrewNode(screwSpec);
      node.setParent(parentNode);
      node.setPosition(hole.dx, hole.dy, 0);

      this.screws.push({
        spec: screwSpec,
        node,
        worldLocalX: plank.x + hole.dx,
        worldLocalY: plank.y + hole.dy,
        clickable: false,
        removed: false,
        lastTapMs: 0,
      });
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

  /** 一颗螺丝是否被任何 layer 更高的木板矩形覆盖 */
  private isOccluded(screw: BoardScrewRuntime): boolean {
    const selfPlank = this.planks.find((p) => p.id === screw.spec.plankId)!;
    for (const other of this.planks) {
      if (other.layer <= selfPlank.layer) continue; // 上方层才可能遮挡
      // 因为某个 layer 上的木板可能已经被全拧光并被消除？MVP 阶段不会删除木板，但保留接口
      const left = other.x - other.w / 2;
      const right = other.x + other.w / 2;
      const bottom = other.y - other.h / 2;
      const top = other.y + other.h / 2;
      if (
        screw.worldLocalX >= left &&
        screw.worldLocalX <= right &&
        screw.worldLocalY >= bottom &&
        screw.worldLocalY <= top
      ) {
        return true;
      }
    }
    return false;
  }

  isAllCleared(): boolean {
    return this.screws.every((s) => s.removed);
  }

  /** 道具：洗牌剩余螺丝的颜色（位置不变，重新随机分配颜色） */
  shuffleRemaining() {
    const alive = this.screws.filter((s) => !s.removed);
    if (alive.length < 2) return;
    const colors = alive.map((s) => s.spec.color);
    // shuffle in place
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
    this.planks = [];
    this.screws = [];
    this.plankNodes.forEach((n) => n.destroy());
    this.plankNodes.clear();
    if (this.boardRoot?.isValid) {
      // 兜底：清掉残留
      for (const child of this.boardRoot.children.slice()) {
        if (/^Plank_\d+$/.test(child.name) || /^Screw_\d+$/.test(child.name)) {
          child.destroy();
        }
      }
    }
  }

  // ============================================================
  // 节点创建
  // ============================================================

  private createPlankNode(plank: PlankSpec): Node {
    const node = new Node(`Plank_${plank.id}`);
    prepUiNode(node);
    const ui = node.addComponent(UITransform);
    ui.setContentSize(plank.w, plank.h);

    const g = node.addComponent(Graphics);
    this.drawPlank(g, plank);

    return node;
  }

  private drawPlank(g: Graphics, plank: PlankSpec) {
    const w = plank.w;
    const h = plank.h;
    const fill = PLANK_FILLS[plank.style];
    const border = PLANK_BORDER[plank.style];

    // 主体（圆角矩形）
    g.fillColor = fill;
    g.roundRect(-w / 2, -h / 2, w, h, 18);
    g.fill();

    // 边框
    g.lineWidth = 4;
    g.strokeColor = border;
    g.roundRect(-w / 2, -h / 2, w, h, 18);
    g.stroke();

    // 木纹（3 条水平细线）
    g.lineWidth = 2;
    g.strokeColor = new Color(border.r, border.g, border.b, 100);
    const lines = 3;
    for (let i = 1; i <= lines; i++) {
      const y = -h / 2 + (h / (lines + 1)) * i;
      g.moveTo(-w / 2 + 16, y);
      g.lineTo(w / 2 - 16, y);
    }
    g.stroke();
  }

  private createScrewNode(spec: ScrewSpec): Node {
    const node = new Node(`Screw_${spec.id}`);
    prepUiNode(node);
    const ui = node.addComponent(UITransform);
    ui.setContentSize(SCREW_DIAMETER, SCREW_DIAMETER);

    const g = node.addComponent(Graphics);
    this.drawScrew(g, spec.color, true);

    // 点击事件（在自己节点上即可）
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

    // 外圈金属感
    g.fillColor = fill;
    g.circle(0, 0, r);
    g.fill();
    g.lineWidth = 2.5;
    g.strokeColor = stroke;
    g.circle(0, 0, r);
    g.stroke();

    // 十字凹槽
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

    // 高光小点（可点击时更亮）
    if (clickable) {
      g.fillColor = new Color(255, 255, 255, 180);
      g.circle(-r * 0.35, r * 0.35, r * 0.14);
      g.fill();
    }
  }

  private applyScrewVisual(s: BoardScrewRuntime) {
    const g = s.node.getComponent(Graphics);
    if (!g) return;
    this.drawScrew(g, s.spec.color, s.clickable);
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

    // 防误触（SPEC U-1）
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - s.lastTapMs < TAP_DEBOUNCE_MS) return;
    s.lastTapMs = now;

    if (!this.game?.canAcceptScrewTap()) return;

    s.removed = true;
    // detach 到 BoardRoot（保持视觉位置不跳），等 SlotManager 接管
    s.node.off(Node.EventType.TOUCH_END);
    s.node.setParent(this.boardRoot, true);
    s.node.setSiblingIndex(9999);

    // 拧出小动画：旋转 + 上飘 + 缩放
    tween(s.node)
      .by(0.18, { angle: 360, position: new Vec3(0, 30, 0), scale: new Vec3(0.1, 0.1, 0) }, { easing: 'sineOut' })
      .start();

    // 立即上报给 GameManager，由其转交 SlotManager（保证响应感）
    this.game.onScrewPicked(s.node, s.spec.color);

    // 重算遮挡（被这颗螺丝的板子下方的螺丝可能因此变可点 - MVP 阶段木板未消失，无变化；预留接口）
    this.recheckClickable();
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
