import { Node, Label, Layers, Size, view } from 'cc';

/** UI_2D 层，与 Canvas 子节点一致，确保相机可见 */
export const UI_LAYER = Layers.Enum.UI_2D;

export function prepUiNode(node: Node) {
  node.layer = UI_LAYER;
}

export function prepLabel(label: Label) {
  label.useSystemFont = true;
  label.fontFamily = 'Arial';
}

/** 当前可视区域大小（用于适配黑边/裁切） */
export function getVisibleSize(): Size {
  return view.getVisibleSize();
}
