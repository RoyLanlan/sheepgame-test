import { _decorator, Component } from 'cc';
import { GameManager } from './GameManager';
import { CardManager } from './CardManager';
import { SlotManager } from './SlotManager';
import { UIManager } from './UIManager';
import { BackgroundLayer } from './BackgroundLayer';

const { ccclass } = _decorator;

/**
 * 场景唯一入口：运行时挂载其余 4 个管理器，避免场景里手写多个脚本引用失效。
 */
@ccclass('GameBootstrap')
export class GameBootstrap extends Component {
  onLoad() {
    const host = this.node;
    if (!host.getComponent(GameManager)) host.addComponent(GameManager);
    if (!host.getComponent(CardManager)) host.addComponent(CardManager);
    if (!host.getComponent(SlotManager)) host.addComponent(SlotManager);
    if (!host.getComponent(UIManager)) host.addComponent(UIManager);
    if (!host.getComponent(BackgroundLayer)) host.addComponent(BackgroundLayer);
  }
}
