import {
  _decorator,
  Color,
  Component,
  EventTouch,
  Graphics,
  Label,
  Node,
  UITransform,
} from 'cc';
import { GameManager } from './GameManager';
import { getVisibleSize } from './UiUtil';

const { ccclass, property } = _decorator;

export interface LevelConfig {
  level: number;
  patterns: string[];
  /** 总层数（包含顶/中/底） */
  totalLayers: number;
  /** 总牌数（必须为 3 的倍数） */
  totalCards: number;
  /** 底层牌数（随机散布） */
  bottomCardCount: number;
  /** 已按 3 的倍数分配并打乱的类型序列（长度 = totalCards） */
  typeIds: number[];
}

export type CardState = 'board' | 'slot' | 'removed';

export interface CardData {
  id: number;
  typeId: number;
  emoji: string;
  state: CardState;
  /** 牌堆本地坐标（boardRoot 中心为原点） */
  x: number;
  y: number;
  /** 越大越靠上，用于遮挡判定与绘制顺序 */
  zIndex: number;
  layer: number;
  indexInLayer: number;
  isClickable: boolean;
}

interface LayerPlacement {
  x: number;
  y: number;
  layer: number;
  indexInLayer: number;
  zIndex: number;
}

@ccclass('CardManager')
export class CardManager extends Component {
  @property(Node)
  boardRoot: Node | null = null;

  private gameManager: GameManager | null = null;
  private cards: CardData[] = [];
  private cardNodes = new Map<number, Node>();
  private patternEmojis: string[] = [];
  private nextId = 1;
  private cardSize = { w: 88, h: 88 };
  private readonly shadeName = 'Shade';

  bindGame(game: GameManager) {
    this.gameManager = game;
  }

  ensureRoots() {
    if (!this.boardRoot) {
      this.boardRoot = this.findOrCreateByPath('Canvas/BoardRoot');
    }
  }

  onLoad() {
    if (!this.gameManager) this.gameManager = this.getComponent(GameManager);
    this.ensureRoots();
  }

  buildLevel(config: LevelConfig) {
    this.clearAll();
    this.patternEmojis = config.patterns;
    const placements = config.level === 1 ? this.makeTutorialPlacements(config) : this.makeSpindlePlacementsByConfig(config);
    for (let i = 0; i < config.typeIds.length; i++) {
      const p = placements[i];
      const typeId = config.typeIds[i];
      this.cards.push({
        id: this.nextId++,
        typeId,
        emoji: config.patterns[typeId],
        state: 'board',
        x: p.x,
        y: p.y,
        zIndex: p.zIndex,
        layer: p.layer,
        indexInLayer: p.indexInLayer,
        isClickable: false,
      });
    }
    this.rebuildCardNodes();
    this.checkAllCardsCovered();
  }

  /**
   * 教学关（第一关）布局：
   * - 底层严格遵循 5×5 矩阵（25 潜在位置，允许空位）
   * - 卡牌为正方形（W=H），尺寸按 (canvasWidth - 2*sidePadding)/9 统一计算
   * - 5×5 整体在水平方向严格居中
   */
  private makeTutorialPlacements(config: LevelConfig): LayerPlacement[] {
    const vis = getVisibleSize();

    // 屏幕分区：中部牌堆区（60%），禁止进入顶部15%/底部25%
    const { minY, maxY } = this.getBoardZoneYRange(vis);

    // 正方形尺寸（全局统一公式）
    const sidePadding = 30;
    const cardSize = Math.floor((vis.width - sidePadding * 2) / 9);
    this.cardSize = { w: cardSize, h: cardSize };

    const N = 5;
    // 计算网格间隙：确保 5×5 在屏幕水平严格居中且不侵占 sidePadding
    const usableW = vis.width - sidePadding * 2;
    const rawGap = (usableW - N * cardSize) / (N - 1);
    const gap = Math.max(2, Math.floor(rawGap));

    const gridW = N * cardSize + (N - 1) * gap;
    const gridH = N * cardSize + (N - 1) * gap;
    const startX = -gridW / 2 + cardSize / 2;
    let startY = -gridH / 2 + cardSize / 2; // 让整组中心在 y=0（垂直中心）

    // 禁区约束：保证整个网格不侵入顶部/底部（整体平移）
    const gridBottom = startY - cardSize / 2;
    const gridTop = startY + (N - 1) * (cardSize + gap) + cardSize / 2;
    if (gridBottom < minY) startY += minY - gridBottom;
    if (gridTop > maxY) startY -= gridTop - maxY;

    const totalCards = Math.max(0, Math.floor(config.totalCards));
    const bottomCount = Math.max(0, Math.min(Math.floor(config.bottomCardCount), totalCards));
    const topCount = Math.max(0, totalCards - bottomCount);

    // 底层：严格按 row/col 计算坐标（坐标不随机），再从 25 个位置中选子集（允许空位）
    const bottomAll: Array<{ x: number; y: number }> = [];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        bottomAll.push({
          x: startX + c * (cardSize + gap),
          y: startY + r * (cardSize + gap),
        });
      }
    }
    const bottomChosen = this.shuffle(bottomAll).slice(0, bottomCount);

    // 教学关目前只用底层 5×5（topCount 会是 0）
    const placements: LayerPlacement[] = [];
    let z = 0;
    for (let i = 0; i < bottomChosen.length; i++) {
      const p = bottomChosen[i];
      placements.push({ x: p.x, y: p.y, layer: 0, indexInLayer: i, zIndex: z++ });
    }

    return placements;
  }

  private getBoardZoneYRange(vis: { width: number; height: number }) {
    const topHudH = vis.height * 0.15;
    const bottomInteractH = vis.height * 0.25;
    // boardRoot 原点在屏幕中心
    const maxY = vis.height / 2 - topHudH;
    const minY = -vis.height / 2 + bottomInteractH;
    // 留一点安全余量
    return { minY: minY + 12, maxY: maxY - 12 };
  }

  private shuffle<T>(arr: T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * 纺锤形（按配置生成）：
   * - 底层：屏幕中心区域随机散布 bottomCardCount
   * - 中层：数量最多、向中心靠拢、重叠度最高
   * - 顶层：3-6 张，作为初始可点入口
   *
   * zIndex：自底向上递增（数值越大越靠上）。
   */
  private makeSpindlePlacementsByConfig(config: LevelConfig): LayerPlacement[] {
    const { w: cardW, h: cardH } = this.configureForScreen();
    const vis = getVisibleSize();
    const halfGridX = cardW / 2;
    const halfGridY = cardH / 2;
    const { minY, maxY } = this.getBoardZoneYRange(vis);

    const totalLayers = Math.max(2, Math.floor(config.totalLayers));
    const totalCards = Math.max(0, Math.floor(config.totalCards));
    const bottomCount = Math.max(0, Math.min(Math.floor(config.bottomCardCount), totalCards));

    // 顶层入口：3~6，但不能超过剩余牌
    const topTarget = Math.min(6, Math.max(3, 3 + Math.floor(Math.random() * 4)));
    const topCount = Math.min(topTarget, Math.max(0, totalCards - bottomCount));
    const midLayers = Math.max(0, totalLayers - 2);
    const midTotal = totalCards - topCount - bottomCount;

    const layerCounts: number[] = new Array(totalLayers).fill(0);
    layerCounts[0] = topCount;
    layerCounts[totalLayers - 1] = bottomCount;

    if (midLayers > 0 && midTotal > 0) {
      // 三角形权重：中间层最大
      const weights: number[] = [];
      const peak = (midLayers - 1) / 2;
      for (let i = 0; i < midLayers; i++) {
        const d = Math.abs(i - peak);
        weights.push(1 + (peak - d)); // >=1
      }
      const sumW = weights.reduce((a, b) => a + b, 0);
      let assigned = 0;
      for (let i = 0; i < midLayers; i++) {
        const c = i === midLayers - 1 ? midTotal - assigned : Math.floor((midTotal * weights[i]) / sumW);
        layerCounts[1 + i] = c;
        assigned += c;
      }
      // 兜底：若有未分配，补到最中间
      const left = midTotal - assigned;
      if (left > 0) {
        const midIdx = 1 + Math.floor(midLayers / 2);
        layerCounts[midIdx] += left;
      }
    }

    const placements: LayerPlacement[] = [];
    const layerStepY = cardH * 0.45;
    // 牌堆中心点必须在屏幕垂直中心
    const baseCenterY = 0;

    let zCounter = 0;
    // 生成顺序：从底到顶，zIndex 递增
    for (let layer = totalLayers - 1; layer >= 0; layer--) {
      const count = layerCounts[layer];
      const layerRankFromTop = layer; // 0 顶，越大越靠下
      const centerY = baseCenterY - layerRankFromTop * layerStepY;

      const t = totalLayers <= 1 ? 0 : layer / (totalLayers - 1);
      const spreadX = this.lerp(vis.width * 0.42, vis.width * 0.22, 1 - t); // 底更散、上更聚
      const spreadY = this.lerp(vis.height * 0.18, vis.height * 0.10, 1 - t);

      for (let i = 0; i < count; i++) {
        let x = 0;
        let y = 0;

        if (layer === totalLayers - 1) {
          // 底层：中心区域随机散布（椭圆）
          const rx = vis.width * 0.38;
          const ry = vis.height * 0.20;
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random());
          x = Math.cos(a) * rx * r;
          y = (Math.sin(a) * ry * r) + centerY - vis.height * 0.06;
          // 底层也允许半格偏移，形成压边
          x += (Math.random() < 0.5 ? -0.5 : 0.5) * cardW * (Math.random() * 0.6);
          y += (Math.random() < 0.5 ? -0.5 : 0.5) * cardH * (Math.random() * 0.6);
        } else if (layer === 0) {
          // 顶层：少量入口，集中在上中部
          const localSpreadX = Math.min(spreadX, cardW * 2.6);
          x = (Math.random() - 0.5) * localSpreadX;
          y = centerY + vis.height * 0.08 + (Math.random() - 0.5) * cardH * 0.6;
        } else {
          // 中层：最密，向中心靠拢 + 更高重叠
          x = (Math.random() - 0.5) * spreadX * 0.75;
          y = centerY + (Math.random() - 0.5) * spreadY * 0.55;
          // 强制 0.5 格偏移的一部分，制造“一张压边多张”
          if (Math.random() < 0.55) x += (Math.random() < 0.5 ? -0.5 : 0.5) * cardW;
          if (Math.random() < 0.40) y += (Math.random() < 0.5 ? -0.5 : 0.5) * cardH;
          // 小抖动
          x += (Math.random() - 0.5) * cardW * 0.35;
          y += (Math.random() - 0.5) * cardH * 0.35;
        }

        // 半格对齐：保证 x/y 都是 (半格单位 * 整数)
        x = Math.round(x / halfGridX) * halfGridX;
        y = Math.round(y / halfGridY) * halfGridY;
        // 禁区：禁止进入顶部 HUD(15%) 与底部交互区(25%)
        y = Math.min(maxY, Math.max(minY, y));

        placements.push({
          x,
          y,
          layer,
          indexInLayer: i,
          zIndex: zCounter++,
        });
      }
    }

    return placements;
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private configureForScreen(): { w: number; h: number } {
    const { width: vw } = getVisibleSize();
    // 正方形约束 + 动态尺寸：sidePadding=30, cardSize=(canvasWidth-60)/9
    const sidePadding = 30;
    const size = Math.floor((vw - sidePadding * 2) / 9);
    this.cardSize = { w: size, h: size };
    return this.cardSize;
  }

  /** B 遮挡 A：B 在上层且中心距小于牌宽/高 */
  private isOccludedBy(a: CardData, b: CardData): boolean {
    if (b.state !== 'board' || a.state !== 'board') return false;
    if (b.zIndex <= a.zIndex) return false;
    // 矩形交叉判定（AABB）：两张牌都以中心点为矩形中心
    // 容错：阈值略小于真实宽高（90%），允许边缘轻微接触不触发遮挡
    const CARD_WIDTH = this.cardSize.w * 0.9;
    const CARD_HEIGHT = this.cardSize.h * 0.9;
    return Math.abs(b.x - a.x) < CARD_WIDTH && Math.abs(b.y - a.y) < CARD_HEIGHT;
  }

  /**
   * 重新计算遮挡与可点击状态（并同步层级/视觉）
   * 若没有任何一张卡牌遮挡，则 isClickable=true。
   */
  checkAllCardsCovered() {
    this.applyZOrder();
    const boardCards = this.cards.filter((c) => c.state === 'board');
    for (const a of boardCards) {
      let blocked = false;
      for (const b of boardCards) {
        if (b.id === a.id) continue;
        if (this.isOccludedBy(a, b)) {
          blocked = true;
          break;
        }
      }
      a.isClickable = !blocked;
      this.applyCardVisual(a);
    }
  }

  private applyCardVisual(card: CardData) {
    const node = this.cardNodes.get(card.id);
    if (!node) return;
    const clickable = card.state === 'board' && card.isClickable;
    const bg = node.getChildByName('Bg')?.getComponent(Graphics);
    const label = node.getChildByName('Emoji')?.getComponent(Label);
    const shade = node.getChildByName(this.shadeName);

    if (bg) {
      const base = this.colorForType(card.typeId);
      const fill = clickable ? base : this.dimDesat(base, 0.6, 0.55); // 亮度降低40%+降饱和
      bg.fillColor = fill;
      bg.clear();
      this.drawCardBg(bg, this.cardSize.w, this.cardSize.h, clickable);
    }
    if (label) {
      label.color = clickable ? new Color(40, 40, 40, 255) : new Color(120, 120, 120, 255);
    }
    if (shade) shade.active = card.state === 'board' && !clickable;
  }

  private drawCardBg(g: Graphics, w: number, h: number, clickable: boolean) {
    const r = 8;
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill();
    // 轻微外描边（可点击更明显）
    g.lineWidth = clickable ? 1 : 2;
    g.strokeColor = clickable ? new Color(255, 255, 255, 210) : new Color(35, 25, 20, 150);
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.stroke();
  }

  private dimDesat(base: Color, brightness: number, saturation: number): Color {
    // 亮度：整体乘 brightness；饱和度：向灰度插值
    const r0 = base.r * brightness;
    const g0 = base.g * brightness;
    const b0 = base.b * brightness;
    const gray = 0.299 * r0 + 0.587 * g0 + 0.114 * b0;
    const r = gray + (r0 - gray) * saturation;
    const g = gray + (g0 - gray) * saturation;
    const b = gray + (b0 - gray) * saturation;
    return new Color(Math.round(r), Math.round(g), Math.round(b), base.a);
  }

  private colorForType(typeId: number): Color {
    const palette = [
      new Color(255, 230, 200, 255),
      new Color(200, 240, 220, 255),
      new Color(255, 210, 230, 255),
      new Color(220, 210, 255, 255),
      new Color(255, 240, 180, 255),
      new Color(200, 230, 255, 255),
    ];
    return palette[typeId % palette.length];
  }

  private rebuildCardNodes() {
    for (const [, node] of this.cardNodes) node.destroy();
    this.cardNodes.clear();
    if (!this.boardRoot) return;

    const { w, h } = this.cardSize;
    for (const card of this.cards) {
      if (card.state !== 'board') continue;
      const node = this.createCardNode(card, w, h);
      node.setPosition(card.x, card.y, 0);
      this.boardRoot.addChild(node);
      this.cardNodes.set(card.id, node);
    }
    this.applyZOrder();
    for (const card of this.cards) {
      if (card.state === 'board') this.applyCardVisual(card);
    }
  }

  private createCardNode(card: CardData, w: number, h: number): Node {
    const node = new Node(`Card_${card.id}`);
    const ut = node.addComponent(UITransform);
    ut.setContentSize(w, h);

    const bgNode = new Node('Bg');
    bgNode.addComponent(UITransform).setContentSize(w, h);
    const g = bgNode.addComponent(Graphics);
    this.drawCardBg(g, w, h);
    node.addChild(bgNode);

    const labelNode = new Node('Emoji');
    labelNode.addComponent(UITransform).setContentSize(w, h);
    const label = labelNode.addComponent(Label);
    label.string = card.emoji;
    label.fontSize = Math.floor(w * 0.62);
    label.lineHeight = Math.floor(w * 0.66);
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.useSystemFont = true;
    node.addChild(labelNode);

    const shade = new Node(this.shadeName);
    shade.addComponent(UITransform).setContentSize(w, h);
    const sg = shade.addComponent(Graphics);
    sg.fillColor = new Color(0, 0, 0, 120);
    sg.roundRect(-w / 2, -h / 2, w, h, 10);
    sg.fill();
    shade.active = false;
    node.addChild(shade);

    node.on(Node.EventType.TOUCH_END, (e: EventTouch) => this.onCardTap(card.id, e), this);
    return node;
  }

  private applyZOrder() {
    if (!this.boardRoot) return;
    const board = this.cards.filter((c) => c.state === 'board');
    board.sort((a, b) => a.zIndex - b.zIndex);
    board.forEach((card, idx) => {
      const node = this.cardNodes.get(card.id);
      if (node) node.setSiblingIndex(idx);
    });
  }

  private cardFromNode(node: Node): CardData | undefined {
    const m = /^Card_(\d+)$/.exec(node.name);
    if (!m) return undefined;
    return this.getCard(Number(m[1]));
  }

  private onCardTap(cardId: number, e: EventTouch) {
    e.propagationStopped = true;
    const card = this.cards.find((c) => c.id === cardId);
    const node = this.cardNodes.get(cardId);
    if (!card || !node || card.state !== 'board' || !card.isClickable) return;
    this.gameManager?.onCardPicked(node, card.emoji);
  }

  /** 牌已进入卡槽：从牌堆节点表移除并刷新遮挡 */
  onCardMovedToSlot(cardNode: Node) {
    const card = this.cardFromNode(cardNode);
    if (!card) return;
    card.state = 'slot';
    this.cardNodes.delete(card.id);
  }

  restoreCardToBoard(cardNode: Node, _emoji: string) {
    const card = this.cardFromNode(cardNode);
    if (!card || !this.boardRoot) return;
    card.state = 'board';
    cardNode.setParent(this.boardRoot);
    cardNode.setPosition(card.x, card.y, 0);
    cardNode.setScale(1, 1, 1);
    this.cardNodes.set(card.id, cardNode);
    this.applyZOrder();
    this.checkAllCardsCovered();
  }

  shuffleRemaining() {
    const board = this.cards.filter((c) => c.state === 'board');
    if (board.length < 2) return;
    const positions = board.map((c) => ({ x: c.x, y: c.y, z: c.zIndex }));
    this.shuffle(positions);
    for (let i = 0; i < board.length; i++) {
      board[i].x = positions[i].x;
      board[i].y = positions[i].y;
      board[i].zIndex = positions[i].z;
      const node = this.cardNodes.get(board[i].id);
      if (node) node.setPosition(board[i].x, board[i].y, 0);
    }
    this.applyZOrder();
    this.checkAllCardsCovered();
  }

  removeTopCardsFromBoard(count: number): CardData[] {
    const board = this.cards
      .filter((c) => c.state === 'board')
      .sort((a, b) => b.zIndex - a.zIndex);
    const picked = board.slice(0, count);
    for (const c of picked) {
      c.state = 'removed';
      const node = this.cardNodes.get(c.id);
      node?.destroy();
      this.cardNodes.delete(c.id);
    }
    this.checkAllCardsCovered();
    return picked;
  }

  getCard(id: number): CardData | undefined {
    return this.cards.find((c) => c.id === id);
  }

  getBoardCount(): number {
    return this.cards.filter((c) => c.state === 'board').length;
  }

  isAllCleared(): boolean {
    return this.getBoardCount() === 0;
  }

  clearAll() {
    for (const [, node] of this.cardNodes) node.destroy();
    this.cardNodes.clear();
    this.sweepBoardCardNodes();
    this.cards = [];
    this.nextId = 1;
  }

  /** 兜底：清掉 BoardRoot 下残留的 Card_<id>（含曾入槽后未销毁的节点） */
  private sweepBoardCardNodes() {
    if (!this.boardRoot?.isValid) return;
    for (const child of this.boardRoot.children.slice()) {
      if (/^Card_\d+$/.test(child.name)) child.destroy();
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
        child.setParent(parent);
      }
      cur = child;
    }
    return cur!;
  }
}
