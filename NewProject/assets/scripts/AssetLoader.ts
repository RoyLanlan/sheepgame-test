/**
 * 拧丝 AI · 资源加载层
 *
 * 统一从 resources 目录异步加载 SpriteFrame 并缓存。
 * 设计原则：**缺图不崩溃** —— 加载失败时缓存 null，调用方回退到 Graphics 绘制。
 *
 * 图片放在 assets/resources/art/ 下，加载路径形如 'art/screw/spriteFrame'。
 */

import { resources, SpriteFrame } from 'cc';

/** 美术资源路径表（resources 下，不含扩展名，SpriteFrame 需带 /spriteFrame 后缀） */
export const ArtPaths = {
  screw: 'art/screw/spriteFrame',
  plankTile: 'art/plank_tile/spriteFrame',
} as const;

export type ArtKey = keyof typeof ArtPaths;

const cache = new Map<string, SpriteFrame | null>();
const inflight = new Map<string, Promise<SpriteFrame | null>>();

/** 加载单个 SpriteFrame；失败返回 null（不抛错） */
function loadOne(path: string): Promise<SpriteFrame | null> {
  if (cache.has(path)) return Promise.resolve(cache.get(path) ?? null);
  const pending = inflight.get(path);
  if (pending) return pending;

  const p = new Promise<SpriteFrame | null>((resolve) => {
    resources.load(path, SpriteFrame, (err, sf) => {
      if (err || !sf) {
        cache.set(path, null);
        resolve(null);
      } else {
        cache.set(path, sf);
        resolve(sf);
      }
      inflight.delete(path);
    });
  });
  inflight.set(path, p);
  return p;
}

export class AssetLoader {
  /** 预加载全部美术资源（关卡开始前调用一次；已缓存则瞬时返回） */
  static async preloadAll(): Promise<void> {
    await Promise.all(Object.values(ArtPaths).map((p) => loadOne(p)));
  }

  /** 同步取已缓存的 SpriteFrame；未加载或加载失败返回 null */
  static get(key: ArtKey): SpriteFrame | null {
    return cache.get(ArtPaths[key]) ?? null;
  }

  /** 是否所有美术资源都已就绪（用于决定走 Sprite 还是 Graphics） */
  static get ready(): boolean {
    return (Object.keys(ArtPaths) as ArtKey[]).every((k) => AssetLoader.get(k) !== null);
  }
}
