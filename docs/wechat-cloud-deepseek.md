# 微信云开发（云函数）接入 DeepSeek：API Key 配置流程

本指南适用于：

- **微信云开发 - 云函数（旧版 Cloud Functions）**
- **DeepSeek 官方 API（`api.deepseek.com`）**
- 小游戏端只负责 `wx.cloud.callFunction`，**不在客户端保存/使用 API Key**

---

## 你最终要达到的状态

- 云函数环境变量里有：`DEEPSEEK_API_KEY`
- 云函数 `narrateLevel` 能成功调用 DeepSeek 并返回结构化结果：

```json
{ "title": "...", "story": "...", "encourage": "...", "source": "ai" }
```

- 小游戏端调用云函数时 **不需要也不允许**携带 Key
- 调用失败/超时时，小游戏端使用本地兜底文案池（你项目里 `AiNarrator.ts` 已有 fallback）

---

## Step 0：准备工作（建议先做）

- 你需要一个 **DeepSeek API Key**
- 确认你使用的是 **微信云开发环境**（已有 envId）
- 推荐把云函数运行时选到 **Node.js 18**（或至少 Node.js 16）

---

## Step 1：开通/选择云开发环境（envId）

在微信开发者工具中：

1. 打开你的小游戏项目
2. 进入 **云开发**
3. 创建或选择一个云环境（得到 `envId`）

> 之后小游戏端要 `wx.cloud.init({ env: envId })` 才能调用云函数。

---

## Step 2：创建云函数 `narrateLevel`

在云开发（控制台或开发者工具）里：

1. 进入 **云函数**
2. 新建云函数：**`narrateLevel`**
3. 选择运行环境：**Node.js**

---

## Step 3：配置云函数环境变量（把 Key 放这里）

在云函数 `narrateLevel` 的配置里找到 **环境变量**（或“配置/环境变量”），新增：

- **`DEEPSEEK_API_KEY`**：你的 DeepSeek API Key（必填）
- （可选）`DEEPSEEK_BASE_URL`：`https://api.deepseek.com`
- （可选）`DEEPSEEK_MODEL`：例如 `deepseek-chat`

### 为什么 Key 必须放云函数环境变量？

- 小游戏端资源可被抓包/反编译，Key 放客户端基本等于公开
- 云函数环境变量不会下发给客户端，泄露风险低很多

---

## Step 4：云函数里读取环境变量（校验 Key 是否生效）

在云函数代码中读取：

```js
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) throw new Error('Missing DEEPSEEK_API_KEY');
```

部署后可以在云函数日志里确认：

```js
console.log('hasKey', Boolean(process.env.DEEPSEEK_API_KEY));
```

看到 `hasKey true` 说明环境变量已生效。

---

## Step 5：云函数调用 DeepSeek（推荐接口形状）

建议云函数只做一件事：**根据关卡摘要生成叙事文案**，不要让客户端传自由 prompt。

### 云函数入参（data）

只传“关卡摘要”，例如：

- `level`：关卡号
- `colorCount`：颜色种数
- `plankCount`：木板数
- `screwCount`：螺丝总数
- `failCount`：该关失败次数（用于更鼓励的语气）

### 云函数出参（result）

固定结构：

- `title`：≤ 18 中文字符
- `story`：≤ 30 中文字符
- `encourage`：≤ 16 中文字符
- `source`：`"ai"`

### 关键处理（必须做）

- **超时**：云函数对 DeepSeek 请求建议 2.5~3 秒超时，超时直接报错（客户端降级）
- **结构化输出**：让模型输出 JSON；解析失败视为失败
- **内容过滤**：禁词/URL/超长截断（避免模型偶发越界）
- **日志最小化**：只记录耗时/成功失败/错误码，不记录完整输出

---

## Step 6：小游戏端调用云函数（不需要 Key）

小游戏端流程：

1. 初始化云能力：

```js
wx.cloud.init({ env: '你的envId' });
```

2. 调用云函数：

```js
const res = await wx.cloud.callFunction({
  name: 'narrateLevel',
  data: { level: 1, colorCount: 2, plankCount: 1, screwCount: 6, failCount: 0 }
});
console.log(res.result);
```

### 失败/超时怎么办？

客户端必须“无阻塞降级”：

- 云函数失败/超时：直接用本地兜底文案池（你项目中 `AiNarrator.ts` 的 fallback）

---

## 常见问题排查（Troubleshooting）

### 1）云函数提示找不到 `DEEPSEEK_API_KEY`

- 确认环境变量是加在 **云函数** 上，而不是别的地方
- 确认修改后 **已重新部署**云函数（某些情况下需要重新部署才能生效）
- 在代码里 `console.log(Boolean(process.env.DEEPSEEK_API_KEY))` 看是否为 `true`

### 2）云函数能跑，但小游戏端 `callFunction` 失败

- 确认小游戏端已经 `wx.cloud.init({ env })`
- 确认 envId 与云函数所在环境一致
- 确认云函数名称完全一致：`narrateLevel`

### 3）模型返回文本不符合长度/格式

必须在云函数里做：

- JSON 解析失败 → 直接返回错误（客户端降级）
- 超长 → 截断到目标长度
- 命中禁词/包含 URL → 直接失败（客户端降级）

---

## 安全清单（上线前必须过一遍）

- [ ] API Key 只存在于云函数环境变量（客户端代码、仓库、日志均无 Key）
- [ ] 云函数对外请求带超时（≤ 3s）
- [ ] 云函数输出经过长度限制与禁词过滤
- [ ] 客户端默认兜底（云函数挂了也能玩）
- [ ] 云函数加简单限流（防止被刷爆成本）

