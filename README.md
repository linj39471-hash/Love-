# 游戏人生：空白 VS 特图 Stockfish 国际象棋

这是一个 SillyTavern 第三方前端扩展。

- 你操作“空白”，执白先行。
- 特图执黑，由 Stockfish 18 控制。
- 使用现实中的标准国际象棋规则。
- 每个酒馆聊天拥有独立棋局存档。
- 支持王车易位、吃过路兵、兵升变、将军、将死、逼和、三次重复、五十回合与子力不足和棋。

## 最简单安装方法

### 一、上传到 GitHub

1. 在 GitHub 创建一个新的公开仓库。
2. 不要在仓库外面再套一层文件夹。
3. 将本项目中的所有文件上传到仓库根目录。
4. 上传后，仓库首页第一层必须直接看到：

```text
manifest.json
index.js
engine.js
stockfish-client.js
style.css
README.md
```

### 二、在酒馆安装

进入 SillyTavern：

```text
扩展
→ 安装扩展
→ 粘贴你的 GitHub 仓库地址
```

例如：

```text
https://github.com/你的用户名/NGNL-Stockfish-Chess
```

安装后刷新酒馆，右下角会出现一个圆形棋子按钮 `♟`。

## Stockfish 文件的两种使用方式

### 方式 A：直接使用

不需要额外操作。

扩展第一次打开时，会从 UNPKG 下载 Stockfish 18.0.8 的浏览器版。下载完成后，由浏览器在本地运行棋力计算。

这不会调用酒馆聊天模型，也不会消耗 API 额度。

### 方式 B：把 Stockfish 也存入你的 GitHub 仓库

这是更稳定的方式。

1. 打开你的 GitHub 仓库。
2. 点击 `Actions`。
3. 点击左边的 `Vendor Stockfish 18`。
4. 点击 `Run workflow`。
5. 等待绿色对勾。

该工作流会自动将下面两个文件下载并提交到仓库：

```text
stockfish/stockfish-18-lite-single.js
stockfish/stockfish-18-lite-single.wasm
```

以后扩展会优先使用仓库中的本地引擎文件，不再依赖 CDN。

## 操作方法

1. 点击右下角 `♟` 按钮。
2. 点击一个白色棋子。
3. 绿色圆点表示可以移动的位置。
4. 红色圆环表示可以吃子的目标。
5. 点击目标格完成走棋。
6. 特图会自动调用 Stockfish 思考并走黑棋。

## 棋力设置

- 高强度：每步约 2 秒。
- 魔王强度：每步约 5 秒，默认。
- 游戏之神：每步约 10 秒。

Stockfish.js 官方建议普通网页使用 lite single-threaded 版本。它的体积较小，但棋力仍远高于绝大多数人类玩家。

## 备用 AI

若浏览器无法加载 Stockfish，扩展会临时启用内置 JavaScript 备用 AI，避免棋局完全无法继续。

棋盘中的“特图的棋力核心”会显示当前使用的是：

- 本地 Stockfish 18；
- 在线加载 Stockfish 18；或
- 备用本地 AI。

## 酒馆宏

扩展注册了：

```text
{{ngnl_chess_state}}
```

可以把它写进世界书或提示词，让聊天模型读取当前棋局的 FEN 和 PGN。

## 文件说明

```text
manifest.json          酒馆扩展信息
index.js               棋盘、玩家操作、存档和界面控制
engine.js              完整国际象棋规则与备用 AI
stockfish-client.js    Stockfish WASM 加载与 UCI 通讯
style.css              游戏人生风格界面
stockfish/             可选的本地 Stockfish 文件目录
.github/workflows/     GitHub 自动下载 Stockfish 的工作流
```

## 许可证

本项目使用 GPL-3.0。Stockfish.js 与 Stockfish 同样使用 GPL-3.0。详情见 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`。
