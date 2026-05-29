# 美术资产接入说明（D 改：PNG 替换 Graphics）

本项目已从纯 `Graphics` 绘制升级为 **PNG 优先 + Graphics 回退** 的渲染管线。
本文档说明你在 Cocos Creator 里需要做的几步操作。

## 资产清单

| 文件 | 路径 | 用途 | 渲染方式 |
|---|---|---|---|
| `screw.png` | `assets/resources/art/screw.png` | 螺丝（白色主体，引擎内用顶点色染成 6 色） | Sprite SIMPLE |
| `plank_tile.png` | `assets/resources/art/plank_tile.png` | 木板纹理（每个 cell 贴一张，拼出任意形状） | Sprite SLICED（九宫格） |

代码里通过 `AssetLoader`（`resources.load`）异步加载，加载路径：
- `art/screw/spriteFrame`
- `art/plank_tile/spriteFrame`

> **回退机制**：若图未导入 / `.meta` 未生成 / 加载失败，`AssetLoader.get()` 返回 `null`，
> `BoardManager` 自动回退到原来的 `Graphics` 绘制，游戏照常运行，不会崩溃。

## 你需要在 Cocos Creator 里操作的步骤

### 1. 让 Cocos 导入图片（生成 .meta）

打开 Cocos Creator 工程后，编辑器会自动扫描 `assets/resources/art/` 下的两张 png，
并生成对应的 `screw.png.meta` / `plank_tile.png.meta`。

> **必须这一步**：没有 `.meta`，`resources.load` 找不到 SpriteFrame，会一直走 Graphics 回退。

### 2. 配置 `screw.png`

1. 在 **资源管理器** 选中 `screw.png`
2. 右侧 **属性检查器**：
   - `Type` = `sprite-frame`
   - `Trim` = **勾选（开启）** ← 重要！自动裁掉透明边，让圆形螺丝缩放后保持正圆不变形
   - `Filter Mode` 建议 `Bilinear`（缩放更平滑）
3. 点右上角 **应用 / Apply**

### 3. 配置 `plank_tile.png`（九宫格，关键）

1. 在 **资源管理器** 选中 `plank_tile.png`
2. 右侧属性检查器：`Type` = `sprite-frame`
3. 点击 SpriteFrame 子资源 → 找到 **编辑九宫格 / Edit Border** 按钮
4. 设置四边 border（内边距，单位 px），建议：
   - `Left` = `60`，`Right` = `60`，`Top` = `60`，`Bottom` = `60`
   - 含义：图四角 60px 区域（圆角+木边框）拉伸时保持不变，只拉伸中间木纹区
5. 点 **应用 / Apply**

> 不设九宫格也能跑（会退化成整体拉伸），但板的圆角和边框会被拉变形，建议设。

### 4. 预览验证

运行预览，进入任意关卡：
- 螺丝应为**彩色圆形带深色十字槽**（6 色由代码染色，不需要 6 张图）
- 木板应为**木纹质感**，底层深、顶层浅（由 `PLANK_TINT` 三档 multiply 染色）
- 不可点（被遮挡）的螺丝会**压暗 + 半透明**

### 5. 提交 .meta

设置完成后，把新生成的 `.meta` 文件一起提交 Git（含图片的 meta 和 art 目录 meta），
否则其他设备 / CI 上 UUID 不一致会导致加载失败：

```
git add NewProject/assets/resources
git commit -m "chore: add art asset .meta (screw + plank_tile + 9-slice border)"
```

## 后续优化（非阻塞）

- **压缩包体**：两张图原始约 3.5MB，微信小游戏首包限 4MB。上线前用 tinypng 压缩，
  或在 Cocos 纹理压缩设置里开启 `astc` / `etc` 压缩。
- **螺丝高光**：当前白色高光会被染色，若想保留纯白高光，可把高光拆成独立子节点贴图。
- **背景 / 槽位框**：目前仍是 Graphics，可按相同模式（资产 + 回退）后续替换。
