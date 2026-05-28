import {
  _decorator,
  Component,
  Node,
  UITransform,
  Vec3,
  Color,
  Label,
  Graphics,
  UIOpacity,
  BlockInputEvents,
  tween,
  view,
  sys,
  game,
} from 'cc';
import type { GameManager, ScoreRecord } from './GameManager';
import { prepUiNode, prepLabel, getVisibleSize } from './UiUtil';

const { ccclass } = _decorator;

export interface HudCallbacks {
  level: number;
  maxLevel: number;
  onShuffle: () => void;
  onRemove: () => void;
  onUndo: () => void;
  onShare: () => void;
  onRestart: () => void;
}

export interface ToolStates {
  shuffleUsed: boolean;
  removeUsed: boolean;
  undoUsed: boolean;
}

export interface LosePanelOpts {
  canRevive: boolean;
  onRestart: () => void;
  onShare: () => void;
  onRevive: () => void;
}

export interface WinPanelOpts {
  message: string;
  showNext: boolean;
  onNext: () => void;
  onShare: () => void;
  onRestart: () => void;
}

export interface AdCallbacks {
  onStart: () => void;
  onFinish: () => void;
}

@ccclass('UIManager')
export class UIManager extends Component {
  private game!: GameManager;

  private canvas!: Node;
  private boardRoot!: Node;
  private slotRoot!: Node;
  private uiRoot!: Node;

  // runtime refs
  private hudRoot: Node | null = null;
  private startPanel: Node | null = null;
  private losePanel: Node | null = null;
  private winPanel: Node | null = null;
  private mask: Node | null = null;
  private adMask: Node | null = null;

  private timerLabel: Label | null = null;
  private bestLabel: Label | null = null;

  private shuffleBtn: Node | null = null;
  private removeBtn: Node | null = null;
  private undoBtn: Node | null = null;

  private buttonEnabled = new Map<Node, boolean>();

  bindGame(game: GameManager) {
    this.game = game;
  }

  ensureRoots() {
    this.canvas = this.findOrCreateByPath('Canvas');
    this.boardRoot = this.findOrCreateByPath('Canvas/BoardRoot');
    this.slotRoot = this.findOrCreateByPath('Canvas/SlotRoot');
    this.uiRoot = this.findOrCreateByPath('Canvas/UIRoot');
  }

  showBootSlogan(onDone: () => void) {
    this.ensureRoots();
    const slogan = this.createPanel('BootSlogan', 520, 160);
    slogan.setParent(this.uiRoot);
    slogan.setPosition(0, 80, 0);
    const label = this.createLabel('加入羊群', 54, new Color(30, 30, 30, 255));
    label.node.setParent(slogan);
    label.node.setPosition(0, 0, 0);

    const op = slogan.getComponent(UIOpacity) ?? slogan.addComponent(UIOpacity);
    op.opacity = 255;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (slogan.isValid) slogan.destroy();
      onDone();
    };
    tween(op)
      .delay(2.4)
      .to(0.4, { opacity: 0 }, { easing: 'quadIn' })
      .call(finish)
      .start();
    this.scheduleOnce(finish, 3.2);
  }

  showStartPanel(onStart: () => void) {
    this.ensureRoots();
    this.closeAllPopups();

    const panel = this.createPanel('StartPanel', 760, 520);
    panel.setParent(this.uiRoot);
    panel.setPosition(0, 40, 0);
    this.startPanel = panel;

    const title = this.createLabel('羊羊消', 64, new Color(35, 35, 35, 255));
    title.node.setParent(panel);
    title.node.setPosition(0, 160, 0);

    const sub = this.createLabel('三消进槽，塔越高越紧张', 28, new Color(80, 80, 80, 255));
    sub.node.setParent(panel);
    sub.node.setPosition(0, 105, 0);

    const btn = this.createButton('开始游戏', 260, 74, () => {
      panel.destroy();
      this.startPanel = null;
      onStart();
    });
    btn.setParent(panel);
    btn.setPosition(0, -120, 0);

    const hint = this.createLabel('提示：只有没被遮挡的牌才能点击', 24, new Color(95, 95, 95, 255));
    hint.node.setParent(panel);
    hint.node.setPosition(0, -190, 0);

    this.fadeIn(panel, 0.15);
  }

  showHud(cb: HudCallbacks) {
    this.ensureRoots();
    if (this.hudRoot) this.hudRoot.destroy();

    const hud = new Node('HudPanel');
    prepUiNode(hud);
    hud.setParent(this.uiRoot);
    hud.setPosition(0, 0, 0);
    this.hudRoot = hud;

    const vis = getVisibleSize();

    // 顶部 HUD 区（15%）：只放关卡/计时/最高分；按钮缩小靠边并留出天空空白
    const topLeft = new Node('TopLeft');
    prepUiNode(topLeft);
    topLeft.setParent(hud);
    topLeft.setPosition(-vis.width / 2 + 70, vis.height / 2 - vis.height * 0.08, 0);

    const entries: Array<{ icon: string; text: string; onClick: () => void }> = [
      { icon: '≡', text: '菜单', onClick: () => {} },
      { icon: '★', text: '成就', onClick: () => {} },
      { icon: '🏆', text: '全国赛', onClick: () => cb.onShare() },
      { icon: '📣', text: '游戏圈', onClick: () => cb.onShare() },
    ];
    entries.forEach((e, idx) => {
      const col = idx % 2;
      const row = (idx / 2) | 0;
      const btn = this.createIconEntry(e.icon, e.text, e.onClick);
      btn.setParent(topLeft);
      btn.setPosition(col * 78, -row * 84, 0);
      btn.setScale(0.85, 0.85, 1);
    });

    // 顶部中间：关卡徽章
    const badge = this.createBadge(`第${cb.level}关`);
    badge.setParent(hud);
    badge.setPosition(0, vis.height / 2 - vis.height * 0.06, 0);

    // 顶部右侧：时间/最高分（两行，靠右）
    const topRight = new Node('TopRight');
    prepUiNode(topRight);
    topRight.setParent(hud);
    topRight.setPosition(vis.width / 2 - 150, vis.height / 2 - vis.height * 0.08, 0);

    const time = this.createLabel('用时 0s', 22, new Color(35, 35, 35, 255));
    time.node.setParent(topRight);
    time.node.setPosition(0, 18, 0);
    this.timerLabel = time;

    const best = this.createLabel('最高：-', 20, new Color(70, 70, 70, 255));
    best.node.setParent(topRight);
    best.node.setPosition(0, -10, 0);
    this.bestLabel = best;

    // 底部交互区（25%）：道具按钮在最底端（卡槽由 SlotManager 放置在其上方）
    const toolBar = new Node('ToolBar');
    prepUiNode(toolBar);
    toolBar.setParent(hud);
    toolBar.setPosition(0, -vis.height / 2 + 90, 0);

    const tools: Array<[string, string, () => void]> = [
      ['↻', '洗牌', cb.onShuffle],
      ['✦', '移除', cb.onRemove],
      ['↩', '撤回', cb.onUndo],
    ];
    const gap = 170;
    const startX = -gap;
    const btns: Node[] = [];
    tools.forEach(([icon, text, fn], idx) => {
      const b = this.createToolIconButton(icon, text, fn);
      b.setParent(toolBar);
      b.setPosition(startX + idx * gap, 0, 0);
      btns.push(b);
    });
    this.shuffleBtn = btns[0];
    this.removeBtn = btns[1];
    this.undoBtn = btns[2];

    // 右上角常驻“重新开始”（HUD 区靠边，避免遮挡天空空白）
    const restart = this.createSmallPill('重新开始', () => {
      this.closeAllPopups();
      cb.onRestart();
    });
    restart.setParent(hud);
    restart.setPosition(vis.width / 2 - 110, vis.height / 2 - vis.height * 0.10, 0);
    restart.setScale(0.85, 0.85, 1);
  }

  private createBadge(text: string) {
    const n = new Node('LevelBadge');
    prepUiNode(n);
    const ui = n.addComponent(UITransform);
    ui.setContentSize(160, 50);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(60, 48, 38, 220);
    this.roundRectPath(g, -80, -25, 160, 50, 16);
    g.fill();
    const label = this.createLabel(text, 24, new Color(255, 255, 255, 255));
    label.node.setParent(n);
    label.node.setPosition(0, 0, 0);
    return n;
  }

  private createIconEntry(icon: string, text: string, onClick: () => void) {
    const n = new Node(`Entry_${text}`);
    prepUiNode(n);
    const ui = n.addComponent(UITransform);
    ui.setContentSize(84, 92);

    const box = new Node('Box');
    prepUiNode(box);
    box.setParent(n);
    box.setPosition(0, 16, 0);
    const bui = box.addComponent(UITransform);
    bui.setContentSize(64, 64);
    const g = box.addComponent(Graphics);
    g.fillColor = new Color(255, 255, 255, 235);
    this.roundRectPath(g, -32, -32, 64, 64, 14);
    g.fill();
    g.lineWidth = 2;
    g.strokeColor = new Color(220, 220, 220, 255);
    this.roundRectPath(g, -32, -32, 64, 64, 14);
    g.stroke();

    const iconLb = this.createLabel(icon, 34, new Color(40, 40, 40, 255));
    iconLb.node.setParent(box);
    iconLb.node.setPosition(0, 0, 0);

    const textLb = this.createLabel(text, 18, new Color(40, 40, 40, 220));
    textLb.node.setParent(n);
    textLb.node.setPosition(0, -32, 0);

    n.on(Node.EventType.TOUCH_END, (e) => {
      (e as any).stopPropagation?.();
      onClick();
    });
    return n;
  }

  private createToolIconButton(icon: string, text: string, onClick: () => void) {
    // 圆角方按钮 + 上方小“+”提示（参考图）
    const root = new Node(`Tool_${text}`);
    prepUiNode(root);
    const ui = root.addComponent(UITransform);
    ui.setContentSize(120, 96);

    const btn = new Node('Btn');
    prepUiNode(btn);
    btn.setParent(root);
    btn.setPosition(0, 6, 0);
    const bui = btn.addComponent(UITransform);
    bui.setContentSize(108, 74);
    const g = btn.addComponent(Graphics);
    g.fillColor = new Color(255, 220, 120, 255);
    this.roundRectPath(g, -54, -37, 108, 74, 18);
    g.fill();

    const iconLb = this.createLabel(icon, 32, new Color(55, 35, 10, 255));
    iconLb.node.setParent(btn);
    iconLb.node.setPosition(-22, 0, 0);

    const textLb = this.createLabel(text, 22, new Color(55, 35, 10, 255));
    textLb.node.setParent(btn);
    textLb.node.setPosition(18, 0, 0);

    // 小 “+”
    const plus = new Node('Plus');
    prepUiNode(plus);
    plus.setParent(root);
    plus.setPosition(44, 42, 0);
    const pui = plus.addComponent(UITransform);
    pui.setContentSize(24, 24);
    const pg = plus.addComponent(Graphics);
    pg.fillColor = new Color(40, 40, 40, 220);
    this.roundRectPath(pg, -12, -12, 24, 24, 8);
    pg.fill();
    const plb = this.createLabel('+', 18, new Color(255, 255, 255, 255));
    plb.node.setParent(plus);
    plb.node.setPosition(0, 0, 0);

    // 让外层也可被 setToolStates 控制（UIOpacity 会加在 root 上）
    root.on(Node.EventType.TOUCH_END, (e) => {
      (e as any).stopPropagation?.();
      onClick();
    });
    return root;
  }

  private createSmallPill(text: string, onClick: () => void) {
    const n = new Node(`Pill_${text}`);
    prepUiNode(n);
    const ui = n.addComponent(UITransform);
    ui.setContentSize(150, 46);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(255, 220, 120, 255);
    this.roundRectPath(g, -75, -23, 150, 46, 18);
    g.fill();
    const lb = this.createLabel(text, 20, new Color(55, 35, 10, 255));
    lb.node.setParent(n);
    lb.node.setPosition(0, 0, 0);
    n.on(Node.EventType.TOUCH_END, (e) => {
      (e as any).stopPropagation?.();
      onClick();
    });
    return n;
  }

  setToolStates(states: ToolStates) {
    this.setButtonEnabled(this.shuffleBtn, !states.shuffleUsed);
    this.setButtonEnabled(this.removeBtn, !states.removeUsed);
    this.setButtonEnabled(this.undoBtn, !states.undoUsed);
  }

  setTimerSec(sec: number) {
    if (this.timerLabel) this.timerLabel.string = `用时 ${sec}s`;
  }

  setBestScore(score: ScoreRecord) {
    if (!this.bestLabel) return;
    if (score.bestLevel <= 0 || score.bestTimeSec >= 999999) {
      this.bestLabel.string = '最高：-';
      return;
    }
    this.bestLabel.string = `最高：到 ${score.bestLevel} 关 / ${score.bestTimeSec}s`;
  }

  showLosePanel(opts: LosePanelOpts) {
    this.ensureRoots();
    this.closeAllPopups();
    this.dimMask(true);

    const panel = this.createPanel('LosePanel', 760, 520);
    panel.setParent(this.uiRoot);
    panel.setPosition(0, 40, 0);
    this.losePanel = panel;

    const title = this.createLabel('好可惜', 60, new Color(35, 35, 35, 255));
    title.node.setParent(panel);
    title.node.setPosition(0, 150, 0);

    const btnRestart = this.createButton('再来一次', 260, 74, () => {
      this.closeAllPopups();
      opts.onRestart();
    });
    btnRestart.setParent(panel);
    btnRestart.setPosition(0, -60, 0);

    const btnShare = this.createButton('分享挑战给朋友', 320, 74, () => opts.onShare());
    btnShare.setParent(panel);
    btnShare.setPosition(0, -145, 0);

    if (opts.canRevive) {
      const btnAd = this.createButton('看广告复活', 280, 68, () => {
        this.closeAllPopups();
        opts.onRevive();
      });
      btnAd.setParent(panel);
      btnAd.setPosition(0, 15, 0);
    }

    this.fadeIn(panel, 0.2);
  }

  showWinPanel(opts: WinPanelOpts) {
    this.ensureRoots();
    this.closeAllPopups();
    this.dimMask(true);

    const panel = this.createPanel('WinPanel', 860, 560);
    panel.setParent(this.uiRoot);
    panel.setPosition(0, 40, 0);
    this.winPanel = panel;

    const title = this.createLabel('通关啦！', 60, new Color(35, 35, 35, 255));
    title.node.setParent(panel);
    title.node.setPosition(0, 185, 0);

    const msg = this.createLabel(opts.message, 28, new Color(60, 60, 60, 255), 720);
    msg.node.setParent(panel);
    msg.node.setPosition(0, 70, 0);

    const btnShare = this.createButton('分享挑战', 240, 70, () => opts.onShare());
    btnShare.setParent(panel);
    btnShare.setPosition(-150, -170, 0);

    const btnRestart = this.createButton('重新开始', 240, 70, () => {
      this.closeAllPopups();
      opts.onRestart();
    });
    btnRestart.setParent(panel);
    btnRestart.setPosition(150, -170, 0);

    if (opts.showNext) {
      const btnNext = this.createButton('下一关', 240, 72, () => {
        this.closeAllPopups();
        opts.onNext();
      });
      btnNext.setParent(panel);
      btnNext.setPosition(0, -90, 0);
    }

    this.fadeIn(panel, 0.2);
  }

  showAdMaskCountdown(seconds: number, cb: AdCallbacks) {
    this.ensureRoots();
    if (this.adMask) this.adMask.destroy();

    const mask = this.createFullscreenMask('AdMask', new Color(0, 0, 0, 180));
    mask.setParent(this.uiRoot);
    this.adMask = mask;
    cb.onStart();

    const box = this.createPanel('AdBox', 560, 240);
    box.setParent(mask);
    box.setPosition(0, 20, 0);

    const title = this.createLabel('广告播放中...', 34, new Color(35, 35, 35, 255));
    title.node.setParent(box);
    title.node.setPosition(0, 60, 0);

    const countdown = this.createLabel(`(${seconds})`, 46, new Color(35, 35, 35, 255));
    countdown.node.setParent(box);
    countdown.node.setPosition(0, -20, 0);

    const op = mask.getComponent(UIOpacity)!;
    op.opacity = 0;
    tween(op).to(0.15, { opacity: 255 }).start();

    let left = seconds;
    const tick = () => {
      left--;
      if (left <= 0) {
        this.fadeOutAndDestroy(mask, 0.15, () => {
          this.adMask = null;
          cb.onFinish();
        });
        return;
      }
      countdown.string = `(${left})`;
      this.scheduleOnce(tick, 1);
    };
    this.scheduleOnce(tick, 1);
  }

  share(timeSec: number) {
    const text = `我在《羊羊消》坚持了${timeSec}秒，你能超过我吗？`;
    const ok = this.tryShareViaGameCanvas(text);
    if (!ok) this.tryShareFallbackCanvas(text);
  }

  makeProvinceRankText() {
    const provinces = ['广东', '江苏', '浙江', '四川', '湖北', '山东', '福建', '河南', '河北', '湖南', '重庆', '北京', '上海', '陕西', '辽宁'];
    const p = provinces[(Math.random() * provinces.length) | 0];
    const rank = 100 + ((Math.random() * 900) | 0);
    return `恭喜！你已加入${p}省羊群战队，当前省份排名第${rank}名`;
  }

  private tryShareViaGameCanvas(text: string) {
    const anyDoc = typeof document !== 'undefined';
    if (!anyDoc) return false;
    try {
      const canvas = game.canvas as HTMLCanvasElement | null;
      if (!canvas) return false;
      const url = canvas.toDataURL('image/png');
      this.downloadPng(url, `yyx_share_${Date.now()}.png`, text);
      return true;
    } catch {
      return false;
    }
  }

  private tryShareFallbackCanvas(text: string) {
    if (typeof document === 'undefined') return;
    try {
      const c = document.createElement('canvas');
      c.width = 1080;
      c.height = 1920;
      const ctx = c.getContext('2d');
      if (!ctx) return;

      // soft gradient bg
      const grd = ctx.createLinearGradient(0, 0, 0, c.height);
      grd.addColorStop(0, '#FDF3FF');
      grd.addColorStop(1, '#ECF7FF');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, c.width, c.height);

      // title
      ctx.fillStyle = '#222';
      ctx.font = 'bold 78px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('羊羊消 · 挑战海报', c.width / 2, 260);

      // card-like panel
      ctx.fillStyle = 'rgba(255,255,255,0.86)';
      this.roundRect2D(ctx, 120, 420, 840, 520, 36);
      ctx.fill();
      ctx.fillStyle = '#333';
      ctx.font = 'bold 54px sans-serif';
      ctx.fillText('我的成绩', c.width / 2, 540);

      ctx.fillStyle = '#444';
      ctx.font = '44px sans-serif';
      this.wrapText(ctx, text, c.width / 2, 650, 720, 56);

      ctx.fillStyle = '#777';
      ctx.font = '32px sans-serif';
      ctx.fillText('来试试你能坚持多久？', c.width / 2, 900);

      const url = c.toDataURL('image/png');
      this.downloadPng(url, `yyx_share_${Date.now()}.png`, text);
    } catch {}
  }

  private downloadPng(dataUrl: string, filename: string, _text: string) {
    if (typeof document === 'undefined') return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.click();
  }

  private roundRect2D(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.min(r, Math.min(w, h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, centerX: number, startY: number, maxWidth: number, lineHeight: number) {
    const words = text.split('');
    let line = '';
    let y = startY;
    for (const w of words) {
      const test = line + w;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, centerX, y);
        line = w;
        y += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, centerX, y);
  }

  private createFullscreenMask(name: string, color: Color) {
    const n = new Node(name);
    prepUiNode(n);
    const ui = n.addComponent(UITransform);
    // 遮罩必须阻止点透，否则会造成“看得见但点不到”
    n.addComponent(BlockInputEvents);
    const vis = getVisibleSize();
    ui.setContentSize(vis.width, vis.height);
    const g = n.addComponent(Graphics);
    g.fillColor = color;
    g.rect(-vis.width / 2, -vis.height / 2, vis.width, vis.height);
    g.fill();
    const op = n.addComponent(UIOpacity);
    op.opacity = 255;
    return n;
  }

  private dimMask(on: boolean) {
    if (!on) {
      if (this.mask) {
        this.mask.destroy();
        this.mask = null;
      }
      return;
    }
    if (this.mask) this.mask.destroy();
    const mask = this.createFullscreenMask('DimMask', new Color(0, 0, 0, 130));
    mask.setParent(this.uiRoot);
    mask.setSiblingIndex(0);
    const op = mask.getComponent(UIOpacity)!;
    op.opacity = 0;
    tween(op).to(0.25, { opacity: 255 }, { easing: 'quadOut' }).start();
    this.mask = mask;
  }

  private closeAllPopups() {
    this.dimMask(false);
    this.startPanel?.destroy();
    this.startPanel = null;
    this.losePanel?.destroy();
    this.losePanel = null;
    this.winPanel?.destroy();
    this.winPanel = null;
  }

  private createPanel(name: string, w: number, h: number) {
    const n = new Node(name);
    prepUiNode(n);
    const ui = n.addComponent(UITransform);
    ui.setContentSize(w, h);

    const g = n.addComponent(Graphics);
    // shadow
    g.fillColor = new Color(0, 0, 0, 30);
    this.roundRectPath(g, -w / 2 + 6, -h / 2 - 6, w, h, 26);
    g.fill();
    // main
    g.fillColor = new Color(255, 255, 255, 235);
    this.roundRectPath(g, -w / 2, -h / 2, w, h, 26);
    g.fill();
    g.lineWidth = 2;
    g.strokeColor = new Color(220, 220, 220, 255);
    this.roundRectPath(g, -w / 2, -h / 2, w, h, 26);
    g.stroke();

    const op = n.addComponent(UIOpacity);
    op.opacity = 255;
    return n;
  }

  private createButton(text: string, w: number, h: number, onClick: () => void) {
    const n = new Node(`Btn_${text}`);
    prepUiNode(n);
    const ui = n.addComponent(UITransform);
    ui.setContentSize(w, h);

    const g = n.addComponent(Graphics);
    g.fillColor = new Color(255, 220, 120, 255);
    this.roundRectPath(g, -w / 2, -h / 2, w, h, 20);
    g.fill();
    g.lineWidth = 2;
    g.strokeColor = new Color(220, 170, 60, 255);
    this.roundRectPath(g, -w / 2, -h / 2, w, h, 20);
    g.stroke();

    const label = this.createLabel(text, 28, new Color(55, 35, 10, 255));
    label.node.setParent(n);
    label.node.setPosition(0, 0, 0);

    this.buttonEnabled.set(n, true);

    // simple touch handler
    n.on(Node.EventType.TOUCH_START, (e) => {
      (e as any).stopPropagation?.();
      if (this.buttonEnabled.get(n) === false) return;
      tween(n).to(0.05, { scale: new Vec3(0.97, 0.97, 1) }).start();
    });
    n.on(Node.EventType.TOUCH_CANCEL, (e) => {
      (e as any).stopPropagation?.();
      tween(n).to(0.08, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
    });
    n.on(Node.EventType.TOUCH_END, (e) => {
      (e as any).stopPropagation?.();
      if (this.buttonEnabled.get(n) === false) return;
      const op = n.getComponent(UIOpacity) ?? n.addComponent(UIOpacity);
      tween(n)
        .to(0.08, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
        .start();
      onClick();
    });
    return n;
  }

  private setButtonEnabled(btn: Node | null, enabled: boolean) {
    if (!btn) return;
    this.buttonEnabled.set(btn, enabled);
    btn.getComponent(UIOpacity) ?? btn.addComponent(UIOpacity);
    const op = btn.getComponent(UIOpacity)!;
    op.opacity = enabled ? 255 : 120;
  }

  private createLabel(text: string, fontSize: number, color: Color, maxWidth = 0) {
    const n = new Node('Label');
    const ui = n.addComponent(UITransform);
    ui.setContentSize(maxWidth > 0 ? maxWidth : 600, fontSize + 12);
    const label = n.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.floor(fontSize * 1.2);
    label.color = color;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    if (maxWidth > 0) label.overflow = Label.Overflow.RESIZE_HEIGHT;
    prepLabel(label);
    return label;
  }

  private fadeIn(node: Node, duration: number) {
    const op = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
    op.opacity = 255;
    node.setScale(0.96, 0.96, 1);
    tween(node).to(duration, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' }).start();
  }

  private fadeOutAndDestroy(node: Node, duration: number, onDone?: () => void) {
    const op = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
    tween(op)
      .to(duration, { opacity: 0 }, { easing: 'quadIn' })
      .call(() => {
        node.destroy();
        onDone?.();
      })
      .start();
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

