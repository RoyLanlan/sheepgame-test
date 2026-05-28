# 拧丝 AI · sheepgame-test

> 一款由 AI 实时生成"关卡叙事 + 难度参数"、用纯净无广告体验对抗主流拧螺丝小游戏的微信小游戏 MVP。

## 当前进度

| 阶段 | 状态 |
|---|---|
| 产品 SPEC v1.0（五维度 100/100） | ✅ 完成（见 [SPEC.md](./SPEC.md)） |
| 现有代码基线（羊了个羊式三消骨架） | ✅ 已上传 |
| 核心玩法重写（拧螺丝 + 木板叠加） | ⏳ 待开干 |
| AI 关卡叙事接入（豆包 lite） | ⏳ 待开干 |

## 分支约定

| 分支 | 用途 |
|---|---|
| `main` | 当前最新基线 |
| `baseline/sheep-three-match` | 现有三消代码快照（用于将来回滚） |
| `feat/nutsy-ai-v1` | 拧螺丝 v1 改造（按 SPEC 开干时建） |

## 技术栈

- **引擎**：Cocos Creator 3.8.8（竖屏 720×1280）
- **语言**：TypeScript 4.x
- **平台**：微信小游戏（iOS 13+ / Android 8+）
- **AI 能力**：豆包 doubao-lite-32k（仅生成关卡叙事，不生成关卡参数）
- **存储**：`wx.getStorageSync` + localStorage 兜底（无服务器存储）

## 目录结构

```
sheepgame/
├── NewProject/             # Cocos Creator 工程
│   ├── assets/
│   │   ├── scenes/main.scene
│   │   └── scripts/
│   │       ├── GameManager.ts
│   │       ├── CardManager.ts
│   │       ├── SlotManager.ts
│   │       ├── UIManager.ts
│   │       ├── BackgroundLayer.ts
│   │       ├── GameBootstrap.ts
│   │       └── UiUtil.ts
│   └── package.json
├── project.config.json     # 微信开发者工具配置（含 AppID）
├── SPEC.md                 # 产品 SPEC v1.0
├── README.md
└── .gitignore
```

## 下一步

按 [SPEC.md 末尾的"下次会话落地清单"](./SPEC.md#下次会话落地清单开干前的准备) 执行。

入口命令（约定）：

```
开始：按 SPEC 开始落地
```

