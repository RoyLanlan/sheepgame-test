import {
  _decorator,
  Component,
  Node,
  director,
  sys,
  game,
  view,
  ResolutionPolicy,
} from 'cc';
import { CardManager, LevelConfig } from './CardManager';
import { SlotManager } from './SlotManager';
import { UIManager } from './UIManager';
import { BackgroundLayer } from './BackgroundLayer';

const { ccclass } = _decorator;

export type GameResult = 'win' | 'lose';

export interface ScoreRecord {
  bestLevel: number;
  bestTimeSec: number;
}

@ccclass('GameManager')
export class GameManager extends Component {
  static readonly SCORE_KEY = 'yyx_score_v1';
  // 竖屏设计分辨率：720 * 1280
  static readonly DESIGN_W = 720;
  static readonly DESIGN_H = 1280;

  private cardManager!: CardManager;
  private slotManager!: SlotManager;
  private uiManager!: UIManager;
  private backgroundLayer!: BackgroundLayer;

  private levelIndex = 0; // 0-based
  private started = false;
  private elapsedMs = 0;
  /** 每关失败次数，用于动态降难度（>3 次则下一局少 1 层） */
  private failCounts: number[] = [];

  private toolShuffleUsed = false;
  private toolRemoveUsed = false;
  private toolUndoUsed = false;
  private reviveUsed = false;

  private ticking = false;
  private booted = false;

  onLoad() {
    // 场景只挂 GameManager；其余管理器由入口自动补齐（避免场景里多个脚本 Class ID 失效）
    this.cardManager = this.getComponent(CardManager) ?? this.addComponent(CardManager);
    this.slotManager = this.getComponent(SlotManager) ?? this.addComponent(SlotManager);
    this.uiManager = this.getComponent(UIManager) ?? this.addComponent(UIManager);
    this.backgroundLayer = this.getComponent(BackgroundLayer) ?? this.addComponent(BackgroundLayer);

    this.cardManager.bindGame(this);
    this.slotManager.bindGame(this);
    this.uiManager.bindGame(this);
    this.scheduleOnce(() => this.bootGame(), 0);
  }

  start() {
    this.bootGame();
  }

  private bootGame() {
    if (this.booted) return;
    this.booted = true;
    this.applyAutoFit();
    this.ensureSceneNodes();
    this.uiManager.showBootSlogan(() => {
      this.uiManager.showStartPanel(() => {
        this.startNewRun();
      });
    });
  }

  /** 运行时按屏幕比例等比缩放（不拉伸） */
  private applyAutoFit() {
    // 同时适配宽高：等比缩放，保证完整显示（不裁切、不拉伸）
    view.setDesignResolutionSize(GameManager.DESIGN_W, GameManager.DESIGN_H, ResolutionPolicy.SHOW_ALL);
    view.on('design-resolution-changed', () => {
      view.setDesignResolutionSize(GameManager.DESIGN_W, GameManager.DESIGN_H, ResolutionPolicy.SHOW_ALL);
    });
  }

  update(dt: number) {
    if (!this.started) return;
    this.elapsedMs += dt * 1000;
    this.uiManager.setTimerSec(Math.floor(this.elapsedMs / 1000));
    this.uiManager.setBestScore(this.getBestScore());
  }

  ensureSceneNodes() {
    this.backgroundLayer.ensureLayer();
    this.uiManager.ensureRoots();
    this.cardManager.ensureRoots();
    this.slotManager.ensureRoots();
    this.enforceZOrderStandard();
  }

  /** 强制执行全局层级标准（SiblingIndex） */
  private enforceZOrderStandard() {
    const canvas = this.node.scene?.getChildByName('Canvas');
    if (!canvas?.isValid) return;
    const bg = canvas?.getChildByName('BackgroundRoot');
    const board = canvas?.getChildByName('BoardRoot');
    const slot = canvas?.getChildByName('SlotRoot');
    const ui = canvas?.getChildByName('UIRoot');

    // 背景层 (-100) → 牌堆 (0~50) → 卡槽(500) → 弹窗UI(2000)
    if (bg?.isValid) bg.setSiblingIndex(0);
    if (board?.isValid) board.setSiblingIndex(1);
    if (slot?.isValid) slot.setSiblingIndex(2);
    if (ui?.isValid) ui.setSiblingIndex(3);
  }

  private startNewRun() {
    this.levelIndex = 0;
    this.beginLevel(this.levelIndex);
  }

  beginLevel(levelIndex: number) {
    this.levelIndex = levelIndex;
    this.started = true;
    this.elapsedMs = 0;
    this.toolShuffleUsed = false;
    this.toolRemoveUsed = false;
    this.toolUndoUsed = false;
    this.reviveUsed = false;

    const config = this.getLevelConfig(levelIndex);

    // 先清卡槽再重建牌堆，避免槽内 Card_<id> 残留
    this.slotManager.clearAll();
    this.cardManager.buildLevel(config);

    this.uiManager.showHud({
      level: levelIndex + 1,
      maxLevel: this.levelConfigs.length,
      onShuffle: () => this.useToolShuffle(),
      onRemove: () => this.useToolRemoveFront3(),
      onUndo: () => this.useToolUndo(),
      onShare: () => this.shareChallenge(),
      onRestart: () => this.beginLevel(this.levelIndex),
    });

    this.uiManager.setToolStates({
      shuffleUsed: this.toolShuffleUsed,
      removeUsed: this.toolRemoveUsed,
      undoUsed: this.toolUndoUsed,
    });
  }

  /** 基础关卡配置表：只存 totalLayers/totalCards/bottomCardCount（其余运行时生成） */
  private levelConfigs: Array<{ totalLayers: number; totalCards: number; bottomCardCount: number }> = [
    { totalLayers: 4, totalCards: 18, bottomCardCount: 9 },
    { totalLayers: 6, totalCards: 45, bottomCardCount: 18 },
    { totalLayers: 7, totalCards: 54, bottomCardCount: 20 },
    { totalLayers: 8, totalCards: 63, bottomCardCount: 22 },
    { totalLayers: 9, totalCards: 72, bottomCardCount: 24 },
  ];

  getLevelConfig(levelIndex: number): LevelConfig {
    const level = levelIndex + 1;

    // 教学关：5×5 网格底层（允许空位）
    if (levelIndex === 0) {
      // 从 5×5=25 个潜在位置中随机选择，且必须为 3 的倍数
      const candidates = [12, 15, 18, 21, 24];
      const totalCards = candidates[Math.floor(Math.random() * candidates.length)];
      const totalLayers = 1;
      const bottomCardCount = totalCards; // 底层从 5×5 中抽取（允许空位）

      const emojiPool = ['🐑', '🍀', '🍓', '🍋', '🍉', '🍇', '🍑', '🍒', '🍪', '🧋', '🌼', '⭐', '🎈', '🎮', '🧸'];
      const kindCount = Math.min(15, 3 + level);
      const patterns = emojiPool.slice(0, kindCount);
      const typeIds = this.buildTypeIds(totalCards, kindCount);

      return { level, patterns, totalLayers, totalCards, bottomCardCount, typeIds };
    }

    const base = this.levelConfigs[Math.max(0, Math.min(levelIndex, this.levelConfigs.length - 1))];

    // 动态难度：某关失败超过 3 次，下一局少 1 层
    const fails = this.failCounts[levelIndex] ?? 0;
    const totalLayers = Math.max(2, base.totalLayers - (fails > 3 ? 1 : 0));

    // 图案种类数 = min(15, 3 + level)
    const emojiPool = ['🐑', '🍀', '🍓', '🍋', '🍉', '🍇', '🍑', '🍒', '🍪', '🧋', '🌼', '⭐', '🎈', '🎮', '🧸'];
    const kindCount = Math.min(15, 3 + level);
    const patterns = emojiPool.slice(0, kindCount);

    // 总牌数必须是 3 的倍数：不足则向下取整（避免破坏三消）
    const totalCards = Math.max(0, Math.floor(base.totalCards / 3) * 3);
    const bottomCardCount = Math.max(0, Math.min(base.bottomCardCount, totalCards));

    const typeIds = this.buildTypeIds(totalCards, kindCount);
    return { level, patterns, totalLayers, totalCards, bottomCardCount, typeIds };
  }

  /** 随机分配类型，但保证每种出现次数为 3 的倍数 */
  private buildTypeIds(totalCards: number, kindCount: number): number[] {
    const groups = Math.floor(totalCards / 3);
    const typeIds: number[] = [];
    for (let i = 0; i < groups; i++) {
      const t = Math.floor(Math.random() * kindCount);
      typeIds.push(t, t, t);
    }
    // 洗牌
    for (let i = typeIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [typeIds[i], typeIds[j]] = [typeIds[j], typeIds[i]];
    }
    return typeIds;
  }

  /** 牌被点中 -> 入槽 */
  onCardPicked(cardNode: Node, emoji: string) {
    if (!this.started) return;
    const ok = this.slotManager.pushCard(cardNode, emoji);
    if (!ok) {
      this.finishGame('lose');
      return;
    }

    this.cardManager.onCardMovedToSlot(cardNode);
    // 牌被移走后：立刻重算遮挡与可点击状态（含视觉同步）
    this.cardManager.checkAllCardsCovered();

    if (this.cardManager.isAllCleared()) {
      this.finishGame('win');
    } else if (this.slotManager.isDeadLockedFull()) {
      this.finishGame('lose');
    }
  }

  private finishGame(result: GameResult) {
    if (!this.started) return;
    this.started = false;

    const timeSec = Math.floor(this.elapsedMs / 1000);

    if (result === 'win') {
      this.failCounts[this.levelIndex] = 0;
      const reachedLevel = this.levelIndex + 1;
      this.tryUpdateBestScore(reachedLevel, timeSec);

      const hasNext = this.levelIndex < this.levelConfigs.length - 1;
      if (hasNext) {
        this.uiManager.showWinPanel({
          message: this.uiManager.makeProvinceRankText(),
          showNext: true,
          onNext: () => this.beginLevel(this.levelIndex + 1),
          onShare: () => this.shareChallenge(),
          onRestart: () => this.beginLevel(this.levelIndex),
        });
      } else {
        this.uiManager.showWinPanel({
          message: `你已完成全部 ${this.levelConfigs.length} 关挑战！`,
          showNext: false,
          onNext: () => {},
          onShare: () => this.shareChallenge(),
          onRestart: () => this.beginLevel(0),
        });
      }
      return;
    }

    // lose
    this.failCounts[this.levelIndex] = (this.failCounts[this.levelIndex] ?? 0) + 1;
    this.tryUpdateBestScore(this.levelIndex, timeSec);
    this.uiManager.showLosePanel({
      canRevive: !this.reviveUsed,
      onRestart: () => this.beginLevel(this.levelIndex),
      onShare: () => this.shareChallenge(),
      onRevive: () => this.reviveByAd(),
    });
  }

  useToolShuffle() {
    if (!this.started) return;
    if (this.toolShuffleUsed) return;
    this.toolShuffleUsed = true;
    this.uiManager.setToolStates({
      shuffleUsed: this.toolShuffleUsed,
      removeUsed: this.toolRemoveUsed,
      undoUsed: this.toolUndoUsed,
    });
    this.cardManager.shuffleRemaining();
  }

  useToolRemoveFront3() {
    if (!this.started) return;
    if (this.toolRemoveUsed) return;
    this.toolRemoveUsed = true;
    this.uiManager.setToolStates({
      shuffleUsed: this.toolShuffleUsed,
      removeUsed: this.toolRemoveUsed,
      undoUsed: this.toolUndoUsed,
    });
    this.slotManager.removeFront3();
    if (this.cardManager.isAllCleared()) this.finishGame('win');
  }

  useToolUndo() {
    if (!this.started) return;
    if (this.toolUndoUsed) return;
    const undone = this.slotManager.undoLastToBoard();
    if (!undone) return;
    this.toolUndoUsed = true;
    this.uiManager.setToolStates({
      shuffleUsed: this.toolShuffleUsed,
      removeUsed: this.toolRemoveUsed,
      undoUsed: this.toolUndoUsed,
    });
    this.cardManager.restoreCardToBoard(undone.node, undone.emoji);
  }

  reviveByAd() {
    if (!this.started) return;
    if (this.reviveUsed) return;
    this.reviveUsed = true;

    this.uiManager.showAdMaskCountdown(5, {
      onStart: () => this.onAdStart(),
      onFinish: () => this.onAdFinish(),
    });
  }

  private onAdStart() {
    // 预留：未来替换为真实广告 SDK（加载/播放回调）
  }

  private onAdFinish() {
    this.slotManager.clearAll();
    this.started = true;
  }

  shareChallenge() {
    const timeSec = Math.floor(this.elapsedMs / 1000);
    this.uiManager.share(timeSec);
  }

  getBestScore(): ScoreRecord {
    try {
      const raw = sys.localStorage.getItem(GameManager.SCORE_KEY) ?? (typeof localStorage !== 'undefined' ? localStorage.getItem(GameManager.SCORE_KEY) : null);
      if (!raw) return { bestLevel: 0, bestTimeSec: 999999 };
      const obj = JSON.parse(raw);
      return {
        bestLevel: typeof obj.bestLevel === 'number' ? obj.bestLevel : 0,
        bestTimeSec: typeof obj.bestTimeSec === 'number' ? obj.bestTimeSec : 999999,
      };
    } catch {
      return { bestLevel: 0, bestTimeSec: 999999 };
    }
  }

  private tryUpdateBestScore(bestLevel: number, timeSec: number) {
    const cur = this.getBestScore();
    let next = cur;
    if (bestLevel > cur.bestLevel) {
      next = { bestLevel, bestTimeSec: timeSec };
    } else if (bestLevel === cur.bestLevel && timeSec < cur.bestTimeSec) {
      next = { bestLevel, bestTimeSec: timeSec };
    }
    if (next !== cur) {
      const raw = JSON.stringify(next);
      sys.localStorage.setItem(GameManager.SCORE_KEY, raw);
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(GameManager.SCORE_KEY, raw);
        } catch {}
      }
    }
  }
}

