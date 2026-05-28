/**
 * 拧丝 AI · UI 管理器（重写）
 *
 * 设计原则（见 SPEC 4.1 / 2.4）：
 * - 主界面仅 3 个入口（开始 / 选关 / 设置）
 * - 关卡开场显示 AI 叙事卡片（关卡名 + 30 字微故事）
 * - 结算页温和不胁迫：无广告复活、无分享炫耀、跳过本关免费
 * - 无道具按钮（MVP 不暴露道具）
 */

import {
  _decorator,
  BlockInputEvents,
  Color,
  Component,
  Graphics,
  Label,
  Node,
  UIOpacity,
  UITransform,
  Vec3,
  tween,
} from 'cc';
import type { GameManager } from './GameManager';
import { LevelNarrative } from './LevelTypes';
import { prepUiNode, prepLabel, getVisibleSize } from './UiUtil';

const { ccclass } = _decorator;

export interface StartPanelOpts {
  currentLevel: number;
  maxLevel: number;
  onStart: () => void;
  onChooseLevel: () => void;
  onSettings: () => void;
}

export interface LevelPickerOpts {
  maxLevel: number;
  currentLevel: number;
  onPick: (level: number) => void;
}

export interface LevelIntroOpts {
  level: number;
  narrative: LevelNarrative;
  onReady: () => void;
}

export interface HudOpts {
  level: number;
  maxLevel: number;
  narrative: LevelNarrative;
  onRestart: () => void;
  onHome: () => void;
}

export interface WinPanelOpts {
  level: number;
  timeSec: number;
  encourage: string;
  showNext: boolean;
  onNext: () => void;
  onRestart: () => void;
  onHome: () => void;
}

export interface LosePanelOpts {
  level: number;
  encourage: string;
  onRestart: () => void;
  onSkip: () => void;
  onHome: () => void;
}

@ccclass('UIManager')
export class UIManager extends Component {
  private game!: GameManager;
  private uiRoot!: Node;

  private hudRoot: Node | null = null;
  private startPanel: Node | null = null;
  private winPanel: Node | null = null;
  private losePanel: Node | null = null;
  private settingsPanel: Node | null = null;
  private levelPicker: Node | null = null;
  private introCard: Node | null = null;
  private mask: Node | null = null;
  private bootNode: Node | null = null;

  private timerLabel: Label | null = null;

  bindGame(game: GameManager) {
    this.game = game;
  }

  ensureRoots() {
    this.uiRoot = this.findOrCreateByPath('Canvas/UIRoot');
  }

  // ============================================================
  // 启动 / 主界面
  // ============================================================

  showBootSlogan(onDone: () => void) {
    this.ensureRoots();
    const slogan = new Node('BootSlogan');
    prepUiNode(slogan);
    slogan.setParent(this.uiRoot);
    slogan.setPosition(0, 100, 0);
    this.bootNode = slogan;

    const title = this.createLabel('拧丝 AI', 80, new Color(30, 30, 30, 255));
    title.node.setParent(slogan);
    title.node.setPosition(0, 60, 0);

    const sub = this.createLabel('不为输赢，只为这一刻嘴角上扬的轻松', 26, new Color(80, 80, 80, 255), 600);
    sub.node.setParent(slogan);
    sub.node.setPosition(0, -10, 0);

    const op = slogan.getComponent(UIOpacity) ?? slogan.addComponent(UIOpacity);
    op.opacity = 0;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (slogan.isValid) slogan.destroy();
      this.bootNode = null;
      onDone();
    };

    tween(op)
      .to(0.35, { opacity: 255 }, { easing: 'quadOut' })
      .delay(1.2)
      .to(0.3, { opacity: 0 }, { easing: 'quadIn' })
      .call(finish)
      .start();

    this.scheduleOnce(finish, 2.4);
  }

  showStartPanel(opts: StartPanelOpts) {
    this.ensureRoots();
    this.closeAllPopups();

    const panel = this.createPanel('StartPanel', 600, 640);
    panel.setParent(this.uiRoot);
    panel.setPosition(0, 0, 0);
    this.startPanel = panel;

    const title = this.createLabel('拧丝 AI', 72, new Color(30, 30, 30, 255));
    title.node.setParent(panel);
    title.node.setPosition(0, 230, 0);

    const sub = this.createLabel(`当前进度：第 ${opts.currentLevel} 关 / 共 ${opts.maxLevel} 关`, 24, new Color(110, 110, 110, 255));
    sub.node.setParent(panel);
    sub.node.setPosition(0, 165, 0);

    // 主 CTA - 开始游戏
    const btnStart = this.createButton('开始游戏', 360, 92, 'primary', () => {
      panel.destroy();
      this.startPanel = null;
      opts.onStart();
    });
    btnStart.setParent(panel);
    btnStart.setPosition(0, 30, 0);

    const btnPick = this.createButton('选关', 280, 70, 'secondary', () => {
      opts.onChooseLevel();
    });
    btnPick.setParent(panel);
    btnPick.setPosition(0, -80, 0);

    const btnSettings = this.createButton('设置', 280, 70, 'secondary', () => {
      opts.onSettings();
    });
    btnSettings.setParent(panel);
    btnSettings.setPosition(0, -170, 0);

    const slogan = this.createLabel('无广告 · 无弹窗 · 永不打扰', 22, new Color(140, 140, 140, 255));
    slogan.node.setParent(panel);
    slogan.node.setPosition(0, -260, 0);

    this.fadeIn(panel, 0.18);
  }

  showLevelPicker(opts: LevelPickerOpts) {
    this.ensureRoots();
    this.dimMask(true);

    const panel = this.createPanel('LevelPicker', 560, 560);
    panel.setParent(this.uiRoot);
    panel.setPosition(0, 0, 0);
    this.levelPicker = panel;

    const title = this.createLabel('选 关', 44, new Color(30, 30, 30, 255));
    title.node.setParent(panel);
    title.node.setPosition(0, 220, 0);

    const cols = 3;
    const cellW = 130;
    const cellH = 130;
    const gap = 20;
    const startX = -((cols - 1) * (cellW + gap)) / 2;
    const startY = 80;

    for (let i = 1; i <= opts.maxLevel; i++) {
      const r = Math.floor((i - 1) / cols);
      const c = (i - 1) % cols;
      const cell = this.createLevelCell(i, opts.currentLevel === i, () => {
        panel.destroy();
        this.levelPicker = null;
        this.dimMask(false);
        opts.onPick(i);
      });
      cell.setParent(panel);
      cell.setPosition(startX + c * (cellW + gap), startY - r * (cellH + gap), 0);
    }

    const btnClose = this.createButton('返回', 200, 64, 'secondary', () => {
      panel.destroy();
      this.levelPicker = null;
      this.dimMask(false);
    });
    btnClose.setParent(panel);
    btnClose.setPosition(0, -220, 0);

    this.fadeIn(panel, 0.18);
  }

  showSettingsPanel() {
    this.ensureRoots();
    this.dimMask(true);

    const panel = this.createPanel('SettingsPanel', 540, 440);
    panel.setParent(this.uiRoot);
    panel.setPosition(0, 0, 0);
    this.settingsPanel = panel;

    const title = this.createLabel('设 置', 44, new Color(30, 30, 30, 255));
    title.node.setParent(panel);
    title.node.setPosition(0, 160, 0);

    const tip = this.createLabel('MVP 阶段：以下选项暂为占位，下次会话接入', 22, new Color(140, 140, 140, 255), 480);
    tip.node.setParent(panel);
    tip.node.setPosition(0, 90, 0);

    // 占位项
    const items: Array<[string, string]> = [
      ['音效', 'ON'],
      ['震动', 'ON'],
    ];
    items.forEach(([k, v], idx) => {
      const lb = this.createLabel(`${k}：${v}`, 26, new Color(60, 60, 60, 255));
      lb.node.setParent(panel);
      lb.node.setPosition(0, 30 - idx * 50, 0);
    });

    const btnReset = this.createButton('重置进度', 260, 72, 'secondary', () => {
      // 真实重置在下次会话接 Storage.remove
    });
    btnReset.setParent(panel);
    btnReset.setPosition(-100, -130, 0);

    const btnClose = this.createButton('关闭', 200, 72, 'primary', () => {
      panel.destroy();
      this.settingsPanel = null;
      this.dimMask(false);
    });
    btnClose.setParent(panel);
    btnClose.setPosition(120, -130, 0);

    this.fadeIn(panel, 0.18);
  }

  // ============================================================
  // 关卡叙事卡片（关卡开场）
  // ============================================================

  showLevelIntro(opts: LevelIntroOpts) {
    this.ensureRoots();
    this.closeAllPopups();

    const card = this.createPanel('LevelIntro', 620, 280);
    card.setParent(this.uiRoot);
    card.setPosition(0, 0, 0);
    this.introCard = card;

    const levelLabel = this.createLabel(`第 ${opts.level} 关`, 28, new Color(140, 100, 60, 255));
    levelLabel.node.setParent(card);
    levelLabel.node.setPosition(0, 90, 0);

    const titleLabel = this.createLabel(opts.narrative.title, 36, new Color(35, 35, 35, 255), 560);
    titleLabel.node.setParent(card);
    titleLabel.node.setPosition(0, 30, 0);

    const storyLabel = this.createLabel(opts.narrative.story, 22, new Color(100, 100, 100, 255), 560);
    storyLabel.node.setParent(card);
    storyLabel.node.setPosition(0, -40, 0);

    // 来源徽章（fallback / ai）
    const srcTag = opts.narrative.source === 'ai' ? 'AI · 现场生成' : '叙事 · 本地版本';
    const tag = this.createLabel(srcTag, 18, new Color(150, 150, 150, 255));
    tag.node.setParent(card);
    tag.node.setPosition(0, -110, 0);

    const op = card.getComponent(UIOpacity) ?? card.addComponent(UIOpacity);
    op.opacity = 0;
    tween(op).to(0.25, { opacity: 255 }, { easing: 'quadOut' }).start();

    // 1.2s 后自动消失
    this.scheduleOnce(() => {
      if (!card.isValid) return;
      tween(op).to(0.25, { opacity: 0 }, { easing: 'quadIn' }).call(() => {
        if (card.isValid) card.destroy();
        this.introCard = null;
        opts.onReady();
      }).start();
    }, 1.2);
  }

  // ============================================================
  // 游戏中 HUD
  // ============================================================

  showHud(opts: HudOpts) {
    this.ensureRoots();
    if (this.hudRoot) this.hudRoot.destroy();

    const hud = new Node('HudPanel');
    prepUiNode(hud);
    hud.setParent(this.uiRoot);
    this.hudRoot = hud;

    const vis = getVisibleSize();

    // 顶部条：关卡名 + 计时
    const topBar = new Node('TopBar');
    prepUiNode(topBar);
    topBar.setParent(hud);
    topBar.setPosition(0, vis.height / 2 - 70, 0);
    const tbUi = topBar.addComponent(UITransform);
    tbUi.setContentSize(vis.width - 80, 80);

    const levelText = this.createLabel(
      `第 ${opts.level} 关 · ${opts.narrative.title}`,
      24,
      new Color(35, 35, 35, 255),
      vis.width - 200,
    );
    levelText.node.setParent(topBar);
    levelText.node.setPosition(0, 14, 0);

    const timeLb = this.createLabel('0s', 22, new Color(120, 120, 120, 255));
    timeLb.node.setParent(topBar);
    timeLb.node.setPosition(0, -16, 0);
    this.timerLabel = timeLb;

    // 右上 - 重试按钮（小圆）
    const btnRestart = this.createIconButton('↻', () => opts.onRestart());
    btnRestart.setParent(hud);
    btnRestart.setPosition(vis.width / 2 - 60, vis.height / 2 - 70, 0);

    // 左上 - 回主页按钮（小圆）
    const btnHome = this.createIconButton('⌂', () => opts.onHome());
    btnHome.setParent(hud);
    btnHome.setPosition(-vis.width / 2 + 60, vis.height / 2 - 70, 0);
  }

  setTimerSec(sec: number) {
    if (this.timerLabel?.isValid) this.timerLabel.string = `${sec}s`;
  }

  // ============================================================
  // 结算页
  // ============================================================

  showWinPanel(opts: WinPanelOpts) {
    this.ensureRoots();
    this.closeAllPopups();
    this.dimMask(true);

    const panel = this.createPanel('WinPanel', 620, 540);
    panel.setParent(this.uiRoot);
    panel.setPosition(0, 0, 0);
    this.winPanel = panel;

    // 顶部温和的"通关"标识
    const icon = this.createCircleIcon('✓', new Color(91, 184, 91, 255));
    icon.setParent(panel);
    icon.setPosition(0, 200, 0);

    const title = this.createLabel('通 关', 52, new Color(30, 30, 30, 255));
    title.node.setParent(panel);
    title.node.setPosition(0, 130, 0);

    const sub = this.createLabel(`第 ${opts.level} 关 · 用时 ${opts.timeSec} 秒`, 24, new Color(110, 110, 110, 255));
    sub.node.setParent(panel);
    sub.node.setPosition(0, 80, 0);

    // AI 鼓励语卡片
    const encCard = this.createInlineCard(540, 90, opts.encourage);
    encCard.setParent(panel);
    encCard.setPosition(0, -10, 0);

    // 按钮
    if (opts.showNext) {
      const btnNext = this.createButton('下一关', 320, 86, 'primary', () => {
        panel.destroy();
        this.winPanel = null;
        this.dimMask(false);
        opts.onNext();
      });
      btnNext.setParent(panel);
      btnNext.setPosition(0, -130, 0);
    } else {
      const btnAgain = this.createButton('再来一次', 320, 86, 'primary', () => {
        panel.destroy();
        this.winPanel = null;
        this.dimMask(false);
        opts.onRestart();
      });
      btnAgain.setParent(panel);
      btnAgain.setPosition(0, -130, 0);
    }

    const btnHome = this.createButton('回主页', 220, 64, 'secondary', () => {
      panel.destroy();
      this.winPanel = null;
      this.dimMask(false);
      opts.onHome();
    });
    btnHome.setParent(panel);
    btnHome.setPosition(0, -220, 0);

    this.fadeIn(panel, 0.2);
  }

  showLosePanel(opts: LosePanelOpts) {
    this.ensureRoots();
    this.closeAllPopups();
    this.dimMask(true);

    const panel = this.createPanel('LosePanel', 620, 520);
    panel.setParent(this.uiRoot);
    panel.setPosition(0, 0, 0);
    this.losePanel = panel;

    // 温和图标（不用大红叉）
    const icon = this.createCircleIcon('↻', new Color(220, 170, 80, 255));
    icon.setParent(panel);
    icon.setPosition(0, 190, 0);

    const title = this.createLabel('再 试 一 次', 44, new Color(30, 30, 30, 255));
    title.node.setParent(panel);
    title.node.setPosition(0, 120, 0);

    const sub = this.createLabel(`第 ${opts.level} 关`, 22, new Color(120, 120, 120, 255));
    sub.node.setParent(panel);
    sub.node.setPosition(0, 80, 0);

    const encCard = this.createInlineCard(540, 80, opts.encourage);
    encCard.setParent(panel);
    encCard.setPosition(0, 0, 0);

    const btnRestart = this.createButton('重试', 320, 86, 'primary', () => {
      panel.destroy();
      this.losePanel = null;
      this.dimMask(false);
      opts.onRestart();
    });
    btnRestart.setParent(panel);
    btnRestart.setPosition(0, -120, 0);

    const btnSkip = this.createButton('跳过本关（免费）', 280, 60, 'secondary', () => {
      panel.destroy();
      this.losePanel = null;
      this.dimMask(false);
      opts.onSkip();
    });
    btnSkip.setParent(panel);
    btnSkip.setPosition(-100, -210, 0);

    const btnHome = this.createButton('回主页', 180, 60, 'secondary', () => {
      panel.destroy();
      this.losePanel = null;
      this.dimMask(false);
      opts.onHome();
    });
    btnHome.setParent(panel);
    btnHome.setPosition(140, -210, 0);

    this.fadeIn(panel, 0.2);
  }

  // ============================================================
  // 弹窗 / 蒙层管理
  // ============================================================

  closeAllPopups() {
    this.hudRoot?.destroy();
    this.hudRoot = null;
    this.timerLabel = null;
    this.startPanel?.destroy();
    this.startPanel = null;
    this.winPanel?.destroy();
    this.winPanel = null;
    this.losePanel?.destroy();
    this.losePanel = null;
    this.settingsPanel?.destroy();
    this.settingsPanel = null;
    this.levelPicker?.destroy();
    this.levelPicker = null;
    this.introCard?.destroy();
    this.introCard = null;
    this.dimMask(false);
  }

  dimMask(on: boolean) {
    if (!on) {
      if (this.mask?.isValid) this.mask.destroy();
      this.mask = null;
      return;
    }
    if (this.mask?.isValid) return;
    const mask = this.createFullscreenMask('DimMask', new Color(0, 0, 0, 130));
    mask.setParent(this.uiRoot);
    mask.setSiblingIndex(0);
    const op = mask.getComponent(UIOpacity) ?? mask.addComponent(UIOpacity);
    op.opacity = 0;
    tween(op).to(0.2, { opacity: 255 }, { easing: 'quadOut' }).start();
    this.mask = mask;
  }

  // ============================================================
  // 构件
  // ============================================================

  private createPanel(name: string, w: number, h: number) {
    const n = new Node(name);
    prepUiNode(n);
    const ui = n.addComponent(UITransform);
    ui.setContentSize(w, h);

    const g = n.addComponent(Graphics);
    g.fillColor = new Color(0, 0, 0, 30);
    g.roundRect(-w / 2 + 6, -h / 2 - 6, w, h, 26);
    g.fill();
    g.fillColor = new Color(255, 255, 255, 240);
    g.roundRect(-w / 2, -h / 2, w, h, 26);
    g.fill();
    g.lineWidth = 2;
    g.strokeColor = new Color(220, 220, 220, 255);
    g.roundRect(-w / 2, -h / 2, w, h, 26);
    g.stroke();

    n.addComponent(UIOpacity).opacity = 255;
    n.addComponent(BlockInputEvents);
    return n;
  }

  private createInlineCard(w: number, h: number, text: string) {
    const n = new Node('InlineCard');
    prepUiNode(n);
    const ui = n.addComponent(UITransform);
    ui.setContentSize(w, h);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(252, 245, 230, 255);
    g.roundRect(-w / 2, -h / 2, w, h, 16);
    g.fill();
    g.lineWidth = 2;
    g.strokeColor = new Color(220, 195, 140, 255);
    g.roundRect(-w / 2, -h / 2, w, h, 16);
    g.stroke();
    const lb = this.createLabel(text, 24, new Color(80, 60, 40, 255), w - 40);
    lb.node.setParent(n);
    lb.node.setPosition(0, 0, 0);
    return n;
  }

  private createButton(text: string, w: number, h: number, kind: 'primary' | 'secondary', onClick: () => void) {
    const n = new Node(`Btn_${text}`);
    prepUiNode(n);
    const ui = n.addComponent(UITransform);
    ui.setContentSize(w, h);

    const g = n.addComponent(Graphics);
    if (kind === 'primary') {
      g.fillColor = new Color(255, 200, 90, 255);
      g.roundRect(-w / 2, -h / 2, w, h, 22);
      g.fill();
      g.lineWidth = 2;
      g.strokeColor = new Color(220, 160, 50, 255);
      g.roundRect(-w / 2, -h / 2, w, h, 22);
      g.stroke();
    } else {
      g.fillColor = new Color(245, 245, 245, 255);
      g.roundRect(-w / 2, -h / 2, w, h, 22);
      g.fill();
      g.lineWidth = 2;
      g.strokeColor = new Color(210, 210, 210, 255);
      g.roundRect(-w / 2, -h / 2, w, h, 22);
      g.stroke();
    }

    const color = kind === 'primary' ? new Color(55, 35, 10, 255) : new Color(60, 60, 60, 255);
    const fontSize = h >= 80 ? 30 : 24;
    const lb = this.createLabel(text, fontSize, color);
    lb.node.setParent(n);
    lb.node.setPosition(0, 0, 0);

    n.on(Node.EventType.TOUCH_START, (e) => {
      (e as any).propagationStopped = true;
      tween(n).to(0.05, { scale: new Vec3(0.97, 0.97, 1) }).start();
    });
    n.on(Node.EventType.TOUCH_CANCEL, () => {
      tween(n).to(0.08, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
    });
    n.on(Node.EventType.TOUCH_END, (e) => {
      (e as any).propagationStopped = true;
      tween(n).to(0.08, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
      onClick();
    });
    return n;
  }

  private createIconButton(icon: string, onClick: () => void) {
    const size = 76;
    const n = new Node(`Icon_${icon}`);
    prepUiNode(n);
    const ui = n.addComponent(UITransform);
    ui.setContentSize(size, size);

    const g = n.addComponent(Graphics);
    g.fillColor = new Color(255, 255, 255, 235);
    g.circle(0, 0, size / 2);
    g.fill();
    g.lineWidth = 2;
    g.strokeColor = new Color(210, 210, 210, 255);
    g.circle(0, 0, size / 2);
    g.stroke();

    const lb = this.createLabel(icon, 36, new Color(60, 60, 60, 255));
    lb.node.setParent(n);
    lb.node.setPosition(0, 0, 0);

    n.on(Node.EventType.TOUCH_END, (e) => {
      (e as any).propagationStopped = true;
      onClick();
    });
    return n;
  }

  private createLevelCell(level: number, isCurrent: boolean, onClick: () => void) {
    const n = new Node(`LevelCell_${level}`);
    prepUiNode(n);
    const ui = n.addComponent(UITransform);
    ui.setContentSize(130, 130);

    const g = n.addComponent(Graphics);
    if (isCurrent) {
      g.fillColor = new Color(255, 200, 90, 255);
      g.roundRect(-65, -65, 130, 130, 20);
      g.fill();
      g.lineWidth = 3;
      g.strokeColor = new Color(220, 160, 50, 255);
      g.roundRect(-65, -65, 130, 130, 20);
      g.stroke();
    } else {
      g.fillColor = new Color(245, 245, 245, 255);
      g.roundRect(-65, -65, 130, 130, 20);
      g.fill();
      g.lineWidth = 2;
      g.strokeColor = new Color(200, 200, 200, 255);
      g.roundRect(-65, -65, 130, 130, 20);
      g.stroke();
    }

    const lb = this.createLabel(`${level}`, 48, isCurrent ? new Color(55, 35, 10, 255) : new Color(80, 80, 80, 255));
    lb.node.setParent(n);
    lb.node.setPosition(0, 0, 0);

    n.on(Node.EventType.TOUCH_END, (e) => {
      (e as any).propagationStopped = true;
      onClick();
    });
    return n;
  }

  private createCircleIcon(symbol: string, fill: Color) {
    const size = 86;
    const n = new Node(`Icon_${symbol}`);
    prepUiNode(n);
    const ui = n.addComponent(UITransform);
    ui.setContentSize(size, size);
    const g = n.addComponent(Graphics);
    g.fillColor = fill;
    g.circle(0, 0, size / 2);
    g.fill();
    const lb = this.createLabel(symbol, 50, new Color(255, 255, 255, 255));
    lb.node.setParent(n);
    lb.node.setPosition(0, 0, 0);
    return n;
  }

  private createFullscreenMask(name: string, color: Color) {
    const n = new Node(name);
    prepUiNode(n);
    const ui = n.addComponent(UITransform);
    const vis = getVisibleSize();
    ui.setContentSize(vis.width, vis.height);
    n.addComponent(BlockInputEvents);
    const g = n.addComponent(Graphics);
    g.fillColor = color;
    g.rect(-vis.width / 2, -vis.height / 2, vis.width, vis.height);
    g.fill();
    n.addComponent(UIOpacity).opacity = 255;
    return n;
  }

  private createLabel(text: string, fontSize: number, color: Color, maxWidth = 0) {
    const n = new Node('Label');
    const ui = n.addComponent(UITransform);
    ui.setContentSize(maxWidth > 0 ? maxWidth : 600, fontSize + 12);
    const label = n.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.floor(fontSize * 1.25);
    label.color = color;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    if (maxWidth > 0) label.overflow = Label.Overflow.RESIZE_HEIGHT;
    prepLabel(label);
    return label;
  }

  private fadeIn(node: Node, duration: number) {
    const op = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
    op.opacity = 0;
    node.setScale(0.94, 0.94, 1);
    tween(op).to(duration, { opacity: 255 }, { easing: 'quadOut' }).start();
    tween(node).to(duration, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
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
