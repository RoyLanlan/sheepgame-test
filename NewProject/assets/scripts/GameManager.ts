/**
 * 拧丝 AI · 游戏主控（状态机）
 *
 * 职责：
 * - 持有当前关卡 / 玩家历史 / 计时
 * - 触发关卡生成（LevelGenerator）+ 关卡叙事（AiNarrator）
 * - 调度 BoardManager / SlotManager / UIManager 的协作
 * - 跨平台持久化（Storage）
 *
 * 不做：道具系统、广告复活、社交分享（见 SPEC F-2/F-3/F-4）
 */

import {
  _decorator,
  Component,
  ResolutionPolicy,
  view,
} from 'cc';
import { BoardManager } from './BoardManager';
import { SlotManager } from './SlotManager';
import { UIManager } from './UIManager';
import { BackgroundLayer } from './BackgroundLayer';
import { generateLevel, getMaxLevel } from './LevelGenerator';
import { narrate, pickFailEncourage } from './AiNarrator';
import { Storage, StorageKeys } from './Storage';
import { AssetLoader } from './AssetLoader';
import { LevelConfig, LevelNarrative, PlayerHistory, ScrewColor, emptyHistory } from './LevelTypes';
import type { Node } from 'cc';

const { ccclass } = _decorator;

export type GameResult = 'win' | 'lose';

@ccclass('GameManager')
export class GameManager extends Component {
  static readonly DESIGN_W = 720;
  static readonly DESIGN_H = 1280;

  private boardManager!: BoardManager;
  private slotManager!: SlotManager;
  private uiManager!: UIManager;
  private backgroundLayer!: BackgroundLayer;

  private levelIndex = 1; // 1-based
  private started = false;
  private elapsedMs = 0;
  private booted = false;

  private currentConfig: LevelConfig | null = null;
  private currentNarrative: LevelNarrative | null = null;
  private history: PlayerHistory = emptyHistory();

  onLoad() {
    this.boardManager = this.getComponent(BoardManager) ?? this.addComponent(BoardManager);
    this.slotManager = this.getComponent(SlotManager) ?? this.addComponent(SlotManager);
    this.uiManager = this.getComponent(UIManager) ?? this.addComponent(UIManager);
    this.backgroundLayer = this.getComponent(BackgroundLayer) ?? this.addComponent(BackgroundLayer);

    this.boardManager.bindGame(this);
    this.slotManager.bindGame(this);
    this.uiManager.bindGame(this);

    this.history = Storage.get<PlayerHistory>(StorageKeys.PlayerHistory, emptyHistory());
    this.levelIndex = Math.max(1, Storage.get<number>(StorageKeys.CurrentLevelIndex, 1));

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
      this.uiManager.showStartPanel({
        currentLevel: this.levelIndex,
        maxLevel: getMaxLevel(),
        onStart: () => this.beginLevel(this.levelIndex),
        onChooseLevel: () => this.uiManager.showLevelPicker({
          maxLevel: getMaxLevel(),
          currentLevel: this.levelIndex,
          onPick: (lv) => this.beginLevel(lv),
        }),
        onSettings: () => this.uiManager.showSettingsPanel(),
      });
    });
  }

  private applyAutoFit() {
    view.setDesignResolutionSize(GameManager.DESIGN_W, GameManager.DESIGN_H, ResolutionPolicy.SHOW_ALL);
    view.on('design-resolution-changed', () => {
      view.setDesignResolutionSize(GameManager.DESIGN_W, GameManager.DESIGN_H, ResolutionPolicy.SHOW_ALL);
    });
  }

  update(dt: number) {
    if (!this.started) return;
    this.elapsedMs += dt * 1000;
    this.uiManager.setTimerSec(Math.floor(this.elapsedMs / 1000));
  }

  private ensureSceneNodes() {
    this.backgroundLayer.ensureLayer();
    this.uiManager.ensureRoots();
    this.boardManager.ensureRoots();
    this.slotManager.ensureRoots();
    this.enforceZOrderStandard();
  }

  private enforceZOrderStandard() {
    const canvas = this.node.scene?.getChildByName('Canvas');
    if (!canvas?.isValid) return;
    const bg = canvas.getChildByName('BackgroundRoot');
    const board = canvas.getChildByName('BoardRoot');
    const slot = canvas.getChildByName('SlotRoot');
    const ui = canvas.getChildByName('UIRoot');
    if (bg?.isValid) bg.setSiblingIndex(0);
    if (board?.isValid) board.setSiblingIndex(1);
    if (slot?.isValid) slot.setSiblingIndex(2);
    if (ui?.isValid) ui.setSiblingIndex(3);
  }

  // ============================================================
  // 关卡生命周期
  // ============================================================

  /** 进入指定关卡（1-based） */
  async beginLevel(level: number) {
    this.levelIndex = Math.max(1, Math.min(getMaxLevel(), level));
    Storage.set(StorageKeys.CurrentLevelIndex, this.levelIndex);

    this.uiManager.closeAllPopups();
    this.uiManager.dimMask(false);

    this.currentConfig = generateLevel(this.levelIndex, this.history);

    // 并行：预加载美术资源(缺图自动回退 Graphics) + AI 叙事(本地兜底瞬时返回)
    const [, narrative] = await Promise.all([
      AssetLoader.preloadAll(),
      narrate(this.currentConfig),
    ]);
    this.currentNarrative = narrative;

    // 真正建关卡
    this.slotManager.resetSlots();
    this.boardManager.buildLevel(this.currentConfig);

    this.started = true;
    this.elapsedMs = 0;

    this.uiManager.showLevelIntro({
      level: this.levelIndex,
      narrative: this.currentNarrative,
      onReady: () => {
        this.uiManager.showHud({
          level: this.levelIndex,
          maxLevel: getMaxLevel(),
          narrative: this.currentNarrative!,
          onRestart: () => this.beginLevel(this.levelIndex),
          onHome: () => this.returnToHome(),
        });
      },
    });
  }

  private returnToHome() {
    this.started = false;
    this.uiManager.closeAllPopups();
    this.slotManager.clearAll();
    this.boardManager.clearAll();
    this.uiManager.showStartPanel({
      currentLevel: this.levelIndex,
      maxLevel: getMaxLevel(),
      onStart: () => this.beginLevel(this.levelIndex),
      onChooseLevel: () => this.uiManager.showLevelPicker({
        maxLevel: getMaxLevel(),
        currentLevel: this.levelIndex,
        onPick: (lv) => this.beginLevel(lv),
      }),
      onSettings: () => this.uiManager.showSettingsPanel(),
    });
  }

  // ============================================================
  // 用户交互入口（由 BoardManager 调用）
  // ============================================================

  /** 玩家是否可以接收点击（暂停 / 已结算时返回 false） */
  canAcceptScrewTap(): boolean {
    return this.started;
  }

  /** 一颗螺丝被拧出 */
  onScrewPicked(screwNode: Node, color: ScrewColor) {
    if (!this.started) return;

    const ok = this.slotManager.pushScrew(screwNode, color);
    if (!ok) {
      this.finishGame('lose');
      return;
    }

    // 检查胜负（消除可能改变了 isAllCleared / isDeadLockedFull 的判定）
    if (this.boardManager.isAllCleared()) {
      this.finishGame('win');
    } else if (this.slotManager.isDeadLockedFull()) {
      this.finishGame('lose');
    }
  }

  // ============================================================
  // 结算
  // ============================================================

  private finishGame(result: GameResult) {
    if (!this.started) return;
    this.started = false;
    const timeSec = Math.floor(this.elapsedMs / 1000);

    if (result === 'win') {
      this.recordWin(timeSec);
      const hasNext = this.levelIndex < getMaxLevel();
      this.uiManager.showWinPanel({
        level: this.levelIndex,
        timeSec,
        encourage: this.currentNarrative?.encourage ?? '稳，下一关。',
        showNext: hasNext,
        onNext: () => this.beginLevel(this.levelIndex + 1),
        onRestart: () => this.beginLevel(this.levelIndex),
        onHome: () => this.returnToHome(),
      });
    } else {
      this.recordLose();
      this.uiManager.showLosePanel({
        level: this.levelIndex,
        encourage: pickFailEncourage(),
        onRestart: () => this.beginLevel(this.levelIndex),
        onSkip: () => this.beginLevel(this.levelIndex + 1),
        onHome: () => this.returnToHome(),
      });
    }
  }

  private recordWin(timeSec: number) {
    const prev = this.history.bestTimeByLevel[this.levelIndex] ?? 0;
    if (prev === 0 || timeSec < prev) this.history.bestTimeByLevel[this.levelIndex] = timeSec;
    if (this.levelIndex > this.history.bestLevel) this.history.bestLevel = this.levelIndex;
    this.history.failCountByLevel[this.levelIndex] = 0;
    Storage.set(StorageKeys.PlayerHistory, this.history);
  }

  private recordLose() {
    this.history.failCountByLevel[this.levelIndex] = (this.history.failCountByLevel[this.levelIndex] ?? 0) + 1;
    Storage.set(StorageKeys.PlayerHistory, this.history);
  }

  // ============================================================
  // 查询接口（给 UIManager 用）
  // ============================================================

  getHistory(): PlayerHistory {
    return this.history;
  }

  getCurrentLevel(): number {
    return this.levelIndex;
  }
}
