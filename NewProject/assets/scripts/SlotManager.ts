import {
  _decorator,
  Component,
  Node,
  UITransform,
  Vec3,
  Label,
  Color,
  Graphics,
  tween,
  UIOpacity,
  view,
  math,
} from 'cc';
import type { GameManager } from './GameManager';
import { prepUiNode, getVisibleSize } from './UiUtil';

const { ccclass } = _decorator;

export interface UndoResult {
  node: Node;
  emoji: string;
}

interface SlotItem {
  node: Node;
  emoji: string;
}

@ccclass('SlotManager')
export class SlotManager extends Component {
  private game!: GameManager;

  private canvas!: Node;
  private slotRoot!: Node;

  private capacity = 7;
  private items: SlotItem[] = [];
  private slotMarkers: Node[] = [];

  bindGame(game: GameManager) {
    this.game = game;
  }

  ensureRoots() {
    this.canvas = this.findOrCreateByPath('Canvas');
    this.slotRoot = this.findOrCreateByPath('Canvas/SlotRoot');
    this.ensureSlotMarkers();
  }

  resetSlots() {
    this.ensureRoots();
    this.items = [];
    this.sweepSlotCardNodes();
    this.layoutItems();
  }

  isDeadLockedFull() {
    if (this.items.length < this.capacity) return false;
    // 满 7 后仍有可三消机会则不算死
    const map = new Map<string, number>();
    for (const it of this.items) map.set(it.emoji, (map.get(it.emoji) ?? 0) + 1);
    for (const c of map.values()) if (c >= 3) return false;
    return true;
  }

  pushCard(cardNode: Node, emoji: string) {
    this.ensureRoots();
    if (this.items.length >= this.capacity) return false;

    this.items.push({ node: cardNode, emoji });
    cardNode.setParent(this.slotRoot);
    // 飞行中卡牌抬到最高层（同层内）
    cardNode.setSiblingIndex(1000);
    this.animateToSlot(cardNode, this.items.length - 1);

    this.tryEliminate();
    this.layoutItems();
    return true;
  }

  removeFront3() {
    if (this.items.length === 0) return;
    const count = Math.min(3, this.items.length);
    for (let i = 0; i < count; i++) {
      const it = this.items.shift()!;
      this.playRemoveAnim(it.node);
      it.node.destroy();
    }
    this.layoutItems();
  }

  undoLastToBoard(): UndoResult | null {
    if (this.items.length === 0) return null;
    const it = this.items.pop()!;
    // 先让它淡出一下，再交回 CardManager 放回 board
    const op = it.node.getComponent(UIOpacity) ?? it.node.addComponent(UIOpacity);
    tween(op).to(0.08, { opacity: 0 }).call(() => (op.opacity = 255)).start();
    this.layoutItems();
    return { node: it.node, emoji: it.emoji };
  }

  clearAll() {
    while (this.items.length > 0) {
      const it = this.items.pop()!;
      if (it.node && it.node.isValid) it.node.destroy();
    }
    // 兜底：防止 items 与实际节点不同步
    this.sweepSlotCardNodes();
    this.layoutItems();
  }

  /** 卡槽里的牌节点名为 Card_<id>（与 CardManager 一致） */
  private isCardNodeName(name: string): boolean {
    return /^Card_\d+$/.test(name);
  }

  /** 清理 SlotRoot 下的卡牌节点（保留 SlotBar / Slot0~6 等 UI） */
  private sweepSlotCardNodes() {
    if (!this.slotRoot || !this.slotRoot.isValid) return;
    const children = this.slotRoot.children.slice();
    for (const c of children) {
      if (this.isCardNodeName(c.name)) {
        tween(c).stop();
        c.destroy();
      }
    }
  }

  private tryEliminate() {
    // 三消：任意相同 emoji 满 3 直接消除（优先从最靠前的开始）
    const counts = new Map<string, number>();
    for (const it of this.items) counts.set(it.emoji, (counts.get(it.emoji) ?? 0) + 1);
    const target = [...counts.entries()].find(([, c]) => c >= 3)?.[0];
    if (!target) return;

    const removed: SlotItem[] = [];
    const kept: SlotItem[] = [];
    let need = 3;
    for (const it of this.items) {
      if (it.emoji === target && need > 0) {
        removed.push(it);
        need--;
      } else {
        kept.push(it);
      }
    }
    this.items = kept;
    removed.forEach((it) => {
      this.playEliminateAnim(it.node);
      it.node.destroy();
    });
  }

  private layoutItems() {
    this.ensureSlotMarkers();
    const scale = 0.92;
    for (let i = 0; i < this.items.length; i++) {
      const n = this.items[i].node;
      const targetPos = this.slotMarkers[i].position.clone();
      tween(n).to(0.12, { position: targetPos, scale: new Vec3(scale, scale, 1) }, { easing: 'quadOut' }).start();
    }
  }

  private animateToSlot(node: Node, index: number) {
    const scale = 0.92;
    const targetPos = this.slotMarkers[index].position.clone();
    tween(node).to(0.18, { position: targetPos, scale: new Vec3(scale, scale, 1) }, { easing: 'quadOut' }).start();
  }

  private ensureSlotMarkers() {
    if (this.slotMarkers.length > 0) return;
    this.slotRoot.removeAllChildren();
    this.slotMarkers = [];

    const design = getVisibleSize();
    // 底部交互区（25%）：卡槽位于道具按钮上方
    const baseY = -design.height / 2 + 210;
    const gap = 96;
    const totalW = (this.capacity - 1) * gap;
    const startX = -totalW / 2;

    // 背板
    const bar = new Node('SlotBar');
    prepUiNode(bar);
    bar.setParent(this.slotRoot);
    bar.setSiblingIndex(0);
    const barUI = bar.addComponent(UITransform);
    barUI.setContentSize(totalW + 220, 126);
    const g = bar.addComponent(Graphics);
    g.fillColor = new Color(120, 60, 40, 220);
    this.roundRectPath(g, -(totalW + 220) / 2, -63, totalW + 220, 126, 18);
    g.fill();
    bar.setPosition(0, baseY, 0);

    // 右侧“+”按钮（参考图）
    const plus = new Node('SlotPlus');
    prepUiNode(plus);
    plus.setParent(this.slotRoot);
    plus.setSiblingIndex(1);
    plus.setPosition(totalW / 2 + 78, baseY, 0);
    const pui = plus.addComponent(UITransform);
    pui.setContentSize(70, 70);
    const pg = plus.addComponent(Graphics);
    pg.fillColor = new Color(255, 255, 255, 240);
    this.roundRectPath(pg, -35, -35, 70, 70, 18);
    pg.fill();
    pg.lineWidth = 2;
    pg.strokeColor = new Color(220, 220, 220, 255);
    this.roundRectPath(pg, -35, -35, 70, 70, 18);
    pg.stroke();
    const plb = new Node('PlusLb');
    prepUiNode(plb);
    plb.setParent(plus);
    const lub = plb.addComponent(UITransform);
    lub.setContentSize(70, 70);
    const l = plb.addComponent(Label);
    l.string = '+';
    l.fontSize = 40;
    l.lineHeight = 44;
    l.color = new Color(60, 60, 60, 255);
    l.horizontalAlign = Label.HorizontalAlign.CENTER;
    l.verticalAlign = Label.VerticalAlign.CENTER;

    for (let i = 0; i < this.capacity; i++) {
      const marker = new Node(`Slot${i}`);
      prepUiNode(marker);
      marker.setParent(this.slotRoot);
      marker.setSiblingIndex(10 + i);
      marker.setPosition(startX + i * gap, baseY, 0);
      this.slotMarkers.push(marker);

      const frame = new Node('Frame');
      frame.setParent(marker);
      const ui = frame.addComponent(UITransform);
      ui.setContentSize(92, 118);
      const gg = frame.addComponent(Graphics);
      gg.fillColor = new Color(255, 255, 255, 230);
      this.roundRectPath(gg, -46, -59, 92, 118, 16);
      gg.fill();
      gg.lineWidth = 2;
      gg.strokeColor = new Color(210, 210, 210, 255);
      this.roundRectPath(gg, -46, -59, 92, 118, 16);
      gg.stroke();
    }
  }

  private playEliminateAnim(node: Node) {
    const op = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
    tween(node).to(0.12, { scale: new Vec3(1.08, 1.08, 1) }, { easing: 'backOut' }).start();
    tween(op).to(0.16, { opacity: 0 }).start();
  }

  private playRemoveAnim(node: Node) {
    const op = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
    tween(node).to(0.12, { position: node.position.clone().add(new Vec3(0, 60, 0)) }, { easing: 'quadOut' }).start();
    tween(op).to(0.12, { opacity: 0 }).start();
  }

  private roundRectPath(g: Graphics, x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.min(r, Math.min(w, h) / 2);
    g.roundRect(x, y, w, h, rr);
  }

  private findOrCreateByPath(path: string) {
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

