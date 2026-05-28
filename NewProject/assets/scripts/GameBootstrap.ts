/**
 * 拧丝 AI · 场景入口
 *
 * 场景仅挂载本组件，运行时由它补齐其余 4 个 manager，避免场景文件保存多个
 * 不稳定的 ClassID 引用（重构 manager 时可保持场景不变）。
 */

import { _decorator, Component } from 'cc';
import { GameManager } from './GameManager';
import { BoardManager } from './BoardManager';
import { SlotManager } from './SlotManager';
import { UIManager } from './UIManager';
import { BackgroundLayer } from './BackgroundLayer';

const { ccclass } = _decorator;

@ccclass('GameBootstrap')
export class GameBootstrap extends Component {
  onLoad() {
    const host = this.node;
    if (!host.getComponent(GameManager)) host.addComponent(GameManager);
    if (!host.getComponent(BoardManager)) host.addComponent(BoardManager);
    if (!host.getComponent(SlotManager)) host.addComponent(SlotManager);
    if (!host.getComponent(UIManager)) host.addComponent(UIManager);
    if (!host.getComponent(BackgroundLayer)) host.addComponent(BackgroundLayer);
  }
}
