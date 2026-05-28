/**
 * 拧丝 AI · 颜色槽管理器（替换原 emoji SlotManager）
 *
 * MVP 设计（与原版花式拧螺丝一致）：
 * - 屏幕下方 6 格通用槽（不按颜色分格，先入先排）
 * - 同一颜色螺丝在槽内累计 ≥3 颗，立即消除该颜色全部螺丝
 * - 槽满 6 格且无可消同色组 → 游戏失败
 * - 接收的是从 BoardManager 拧出的螺丝节点（已在 BoardRoot 下、保持世界坐标）
 */

import {
  _decorator,
  Color,
  Component,
  Graphics,
  Node,
  UIOpacity,
  UITransform,
  Vec3,
  tween,
} from 'cc';
import type { GameManager } from './GameManager';
import { ScrewColor } from './LevelTypes';
import { prepUiNode, getVisibleSize } from './UiUtil';

const { ccclass } = _decorator;

const SLOT_CAPACITY = 6;
const SLOT_WIDTH = 90;
const SLOT_HEIGHT = 110;
const SLOT_GAP = 8;

interface SlotItem {
  node: Node;
  color: ScrewColor;
}

@ccclass('SlotManager')
export class SlotManager extends Component {
  private game!: GameManager;
  private slotRoot!: Node;
  private items: SlotItem[] = [];
  private slotMarkers: Node[] = [];

  bindGame(game: GameManager) {
    this.game = game;
  }

  ensureRoots() {
    this.slotRoot = this.findOrCreateByPath('Canvas/SlotRoot');
    this.ensureSlotMarkers();
  }

  resetSlots() {
    this.ensureRoots();
    this.items = [];
    this.sweepScrewNodes();
    this.layoutItems();
  }

  /** 接收一颗螺丝；返回 false 表示槽满（游戏失败） */
  pushScrew(screwNode: Node, color: ScrewColor): boolean {
    this.ensureRoots();
    if (this.items.length >= SLOT_CAPACITY) return false;

    this.items.push({ node: screwNode, color });
    // 重新绑定到 slotRoot，保持视觉位置不跳
    screwNode.setParent(this.slotRoot, true);
    screwNode.setSiblingIndex(1000); // 飞行中抬到顶层

    this.animateToSlot(screwNode, this.items.length - 1);
    this.tryEliminate();
    this.layoutItems();
    return true;
  }

  /** 槽满且无可消同色组 = 死局 */
  isDeadLockedFull(): boolean {
    if (this.items.length < SLOT_CAPACITY) return false;
    const counts = new Map<ScrewColor, number>();
    for (const it of this.items) counts.set(it.color, (counts.get(it.color) ?? 0) + 1);
    for (const c of counts.values()) if (c >= 3) return false;
    return true;
  }

  clearAll() {
    for (const it of this.items) {
      if (it.node?.isValid) {
        tween(it.node).stop();
        it.node.destroy();
      }
    }
    this.items = [];
    this.sweepScrewNodes();
    this.layoutItems();
  }

  // ============================================================
  // 内部：消除 / 布局 / 视觉
  // ============================================================

  /** 同色 ≥3 时一次性消除全部该色螺丝 */
  private tryEliminate() {
    const counts = new Map<ScrewColor, number>();
    for (const it of this.items) counts.set(it.color, (counts.get(it.color) ?? 0) + 1);

    const targetColor = [...counts.entries()].find(([, c]) => c >= 3)?.[0];
    if (targetColor === undefined) return;

    const remained: SlotItem[] = [];
    const removed: SlotItem[] = [];
    for (const it of this.items) {
      if (it.color === targetColor) removed.push(it);
      else remained.push(it);
    }
    this.items = remained;

    // 消除动画稍微延迟一点，让玩家看清"是被消除的"
    removed.forEach((it, idx) => {
      const node = it.node;
      const delay = idx * 0.04;
      const op = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
      tween(node).delay(delay).to(0.18, { scale: new Vec3(1.25, 1.25, 1) }, { easing: 'backOut' }).start();
      tween(op).delay(delay).to(0.22, { opacity: 0 }, { easing: 'quadIn' }).call(() => {
        if (node.isValid) node.destroy();
      }).start();
    });
  }

  private animateToSlot(node: Node, index: number) {
    const target = this.slotMarkers[index]?.position?.clone() ?? new Vec3();
    const scale = 1; // 螺丝在槽内保持原大小
    tween(node)
      .to(0.32, { position: target, scale: new Vec3(scale, scale, 1) }, { easing: 'quadOut' })
      .start();
  }

  private layoutItems() {
    this.ensureSlotMarkers();
    for (let i = 0; i < this.items.length; i++) {
      const target = this.slotMarkers[i].position.clone();
      tween(this.items[i].node).to(0.14, { position: target }, { easing: 'quadOut' }).start();
    }
  }

  private ensureSlotMarkers() {
    if (this.slotMarkers.length > 0) return;
    this.slotRoot.removeAllChildren();
    this.slotMarkers = [];

    const design = getVisibleSize();
    // 槽位于屏幕底部、避开 80px 安全区
    const baseY = -design.height / 2 + 180;
    const totalW = SLOT_CAPACITY * SLOT_WIDTH + (SLOT_CAPACITY - 1) * SLOT_GAP;
    const startX = -totalW / 2 + SLOT_WIDTH / 2;

    // 槽底板（统一木色托盘感）
    const bar = new Node('SlotBar');
    prepUiNode(bar);
    bar.setParent(this.slotRoot);
    bar.setSiblingIndex(0);
    bar.addComponent(UITransform).setContentSize(totalW + 60, SLOT_HEIGHT + 36);
    const barG = bar.addComponent(Graphics);
    barG.fillColor = new Color(86, 60, 38, 200);
    barG.roundRect(-(totalW + 60) / 2, -(SLOT_HEIGHT + 36) / 2, totalW + 60, SLOT_HEIGHT + 36, 20);
    barG.fill();
    barG.lineWidth = 2;
    barG.strokeColor = new Color(50, 32, 18, 220);
    barG.roundRect(-(totalW + 60) / 2, -(SLOT_HEIGHT + 36) / 2, totalW + 60, SLOT_HEIGHT + 36, 20);
    barG.stroke();
    bar.setPosition(0, baseY, 0);

    // 6 个槽位框
    for (let i = 0; i < SLOT_CAPACITY; i++) {
      const marker = new Node(`Slot${i}`);
      prepUiNode(marker);
      marker.setParent(this.slotRoot);
      marker.setSiblingIndex(10 + i);
      marker.setPosition(startX + i * (SLOT_WIDTH + SLOT_GAP), baseY, 0);
      this.slotMarkers.push(marker);

      const frame = new Node('Frame');
      frame.setParent(marker);
      frame.addComponent(UITransform).setContentSize(SLOT_WIDTH, SLOT_HEIGHT);
      const fg = frame.addComponent(Graphics);
      fg.fillColor = new Color(255, 240, 220, 220);
      fg.roundRect(-SLOT_WIDTH / 2, -SLOT_HEIGHT / 2, SLOT_WIDTH, SLOT_HEIGHT, 14);
      fg.fill();
      fg.lineWidth = 2;
      fg.strokeColor = new Color(200, 170, 130, 255);
      fg.roundRect(-SLOT_WIDTH / 2, -SLOT_HEIGHT / 2, SLOT_WIDTH, SLOT_HEIGHT, 14);
      fg.stroke();
    }
  }

  /** 清掉 SlotRoot 下的 Screw_<id> 节点（保留 SlotBar / SlotN 等 UI 框架） */
  private sweepScrewNodes() {
    if (!this.slotRoot?.isValid) return;
    for (const child of this.slotRoot.children.slice()) {
      if (/^Screw_\d+$/.test(child.name)) {
        tween(child).stop();
        child.destroy();
      }
    }
  }

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
