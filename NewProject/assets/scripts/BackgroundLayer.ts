import {
  _decorator,
  Color,
  Component,
  Graphics,
  Node,
  UITransform,
  view,
} from 'cc';
import { prepUiNode, getVisibleSize } from './UiUtil';

const { ccclass } = _decorator;

const TOP_COLOR = { r: 0x4f, g: 0xac, b: 0xfe };
const BOTTOM_COLOR = { r: 0x00, g: 0xf2, b: 0xfe };
// 降噪：云更淡
const CLOUD_ALPHA = 0.3;
const CLOUD_SPEED = 0.1;

interface CloudPuff {
  dx: number;
  dy: number;
  r: number;
}

interface CloudInstance {
  node: Node;
  puffs: CloudPuff[];
  speed: number;
}

@ccclass('BackgroundLayer')
export class BackgroundLayer extends Component {
  private canvas: Node | null = null;
  private bgRoot: Node | null = null;
  private gradientG: Graphics | null = null;
  private clouds: CloudInstance[] = [];
  private halfW = 360;
  private halfH = 640;
  private designListenerBound = false;

  ensureLayer() {
    this.canvas = this.findOrCreateByPath('Canvas');
    if (!this.canvas) return;

    const legacy = this.canvas.getChildByName('Background');
    if (legacy?.isValid) legacy.destroy();

    let root = this.canvas.getChildByName('BackgroundRoot');
    if (!root) {
      root = new Node('BackgroundRoot');
      prepUiNode(root);
      root.setParent(this.canvas);
    }
    root.setSiblingIndex(0);
    this.bgRoot = root;
    this.rebuild();
    if (!this.designListenerBound) {
      view.on('design-resolution-changed', this.onDesignChanged, this);
      this.designListenerBound = true;
    }
  }

  onDestroy() {
    view.off('design-resolution-changed', this.onDesignChanged, this);
  }

  private onDesignChanged = () => {
    this.rebuild();
  };

  private rebuild() {
    if (!this.bgRoot) return;
    const vis = getVisibleSize();
    this.halfW = vis.width / 2;
    this.halfH = vis.height / 2;

    const ui = this.bgRoot.getComponent(UITransform) ?? this.bgRoot.addComponent(UITransform);
    ui.setContentSize(vis.width, vis.height);
    this.bgRoot.setPosition(0, 0, 0);

    this.drawGradient(vis.width, vis.height);
    this.rebuildClouds(vis.width, vis.height);
  }

  /** 全屏线性渐变：顶 #4FACFE → 底 #00F2FE */
  private drawGradient(w: number, h: number) {
    if (!this.bgRoot) return;
    let gradNode = this.bgRoot.getChildByName('Gradient');
    if (!gradNode) {
      gradNode = new Node('Gradient');
      prepUiNode(gradNode);
      gradNode.setParent(this.bgRoot);
      gradNode.setSiblingIndex(0);
      gradNode.addComponent(UITransform).setContentSize(w, h);
    }
    const g = gradNode.getComponent(Graphics) ?? gradNode.addComponent(Graphics);
    this.gradientG = g;
    g.clear();

    const steps = 56;
    const stripH = h / steps;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      g.fillColor = this.lerpColor(TOP_COLOR, BOTTOM_COLOR, t);
      const y = -h / 2 + i * stripH;
      g.rect(-w / 2, y, w, stripH + 1);
      g.fill();
    }
  }

  private rebuildClouds(w: number, h: number) {
    if (!this.bgRoot) return;
    let cloudLayer = this.bgRoot.getChildByName('Clouds');
    if (!cloudLayer) {
      cloudLayer = new Node('Clouds');
      prepUiNode(cloudLayer);
      cloudLayer.setParent(this.bgRoot);
      cloudLayer.setSiblingIndex(1);
    }
    cloudLayer.removeAllChildren();
    this.clouds = [];

    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const cloud = this.createCloud(w, h);
      cloud.node.setParent(cloudLayer);
      this.clouds.push(cloud);
    }
  }

  private createCloud(w: number, h: number): CloudInstance {
    const scale = 0.85 + Math.random() * 0.5;
    const puffCount = 3 + Math.floor(Math.random() * 2);
    const puffs: CloudPuff[] = [];
    for (let i = 0; i < puffCount; i++) {
      puffs.push({
        dx: (i - (puffCount - 1) / 2) * (22 + Math.random() * 18) * scale,
        dy: (Math.random() - 0.5) * 16 * scale,
        r: (24 + Math.random() * 20) * scale,
      });
    }

    const node = new Node(`Cloud_${this.clouds.length}`);
    prepUiNode(node);
    const pad = 80 * scale;
    const ui = node.addComponent(UITransform);
    ui.setContentSize(pad * 2 + 120, pad * 2 + 80);

    const g = node.addComponent(Graphics);
    const fill = new Color(255, 255, 255, Math.floor(255 * CLOUD_ALPHA));
    g.fillColor = fill;
    for (const p of puffs) {
      g.circle(p.dx, p.dy, p.r);
      g.fill();
    }

    const x = (Math.random() - 0.5) * w * 0.85;
    const y = (Math.random() - 0.5) * h * 0.55 + h * 0.08;
    node.setPosition(x, y, 0);

    return { node, puffs, speed: CLOUD_SPEED * (0.7 + Math.random() * 0.5) };
  }

  update() {
    if (this.clouds.length === 0) return;
    const wrap = this.halfW + 140;
    for (const c of this.clouds) {
      if (!c.node.isValid) continue;
      const p = c.node.position;
      let nx = p.x + c.speed;
      if (nx > wrap) nx = -wrap;
      c.node.setPosition(nx, p.y, p.z);
    }
  }

  private lerpColor(
    a: { r: number; g: number; b: number },
    b: { r: number; g: number; b: number },
    t: number,
  ): Color {
    // 背景色调略淡：在渐变结果上轻微混入白色
    const r0 = a.r + (b.r - a.r) * t;
    const g0 = a.g + (b.g - a.g) * t;
    const b0 = a.b + (b.b - a.b) * t;
    const mix = 0.18;
    const r = Math.round(r0 + (255 - r0) * mix);
    const g = Math.round(g0 + (255 - g0) * mix);
    const bl = Math.round(b0 + (255 - b0) * mix);
    return new Color(r, g, bl, 255);
  }

  private findOrCreateByPath(path: string): Node | null {
    const parts = path.split('/').filter(Boolean);
    let cur: Node | null = null;
    for (const name of parts) {
      const parent = cur ?? this.node.scene;
      if (!parent) return null;
      let child = parent.getChildByName(name);
      if (!child) {
        child = new Node(name);
        prepUiNode(child);
        child.setParent(parent);
      }
      cur = child;
    }
    return cur;
  }
}
