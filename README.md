# 研究三：93 词多重排列任务

这是基于前一版 8 词 Demo 确认后制作的 **93 词正式材料版**。特征生成任务继续使用独立的 Qualtrics 问卷。本项目已有可运行网页、Yıldız Multiarrangement 后端、研究者设置页、本地 SQLite 数据库，以及 PostgreSQL + Caddy 的线上部署配置。

## 本地运行

1. 安装 Node.js 24+ 和 Python 3.12。进入本目录。
2. 若没有 `.venv`，执行 `python3.12 -m venv .venv` 和 `.venv/bin/python -m pip install -r backend/requirements.txt`。
3. 运行 `./start_local.sh`，保持终端窗口打开。
4. 研究者设置：`http://127.0.0.1:3500/setup`；测试被试入口：`http://127.0.0.1:3500/?participant_id=PILOT001`。不同测试者使用不同 ID。

本机预览不需要管理员密钥。线上模式要求管理员密钥，且被试需由 Prolific 带入 `PROLIFIC_PID`、`STUDY_ID`、`SESSION_ID`。

## 正式材料与参数

- `words.txt` 按原表 `choice2.word` 顺序列出 93 个唯一英文词，去除单元格首尾空格。`materials/choice2_93.json` 保留分类、domain、来源及原工作表行号。
- 第一轮展示全部 93 词；后续使用 Lift-the-Weakest 选择 15–25 词子集。按每个会话随机分配词语与起始位置；初始词卡不互相重叠。
- 默认加权尺度对齐 RDM；研究者可选加权 + inverse MDS。默认停止规则为 60 分钟或最弱词对证据阈值 0.5，先达到者生效。首轮无论时长都可提交，之后检查停止条件。
- 指导语是横屏单页图片，按窗口自动缩放，底部居中为 “I'm ready”。点击后浏览器请求全屏。研究者可改图片或文字指导语。
- 设置页还可改词表、同名词语图片、后续子集大小、最多轮数与结束跳转 URL。导出 JSON 包含逐轮位置、证据矩阵和 RDM；CSV 为逐轮记录。

## 数据和版本

本地数据在 `data/ma.sqlite3`（Yıldız 后端研究、会话、每轮数据、RDM）和 `data/participants.sqlite3`（被试 ID、邀请关联）。`data/study-manifest.formal.<version>.json` 固定每个材料版本的 study ID。当前本地数据库有测试 ID 和模拟结果，不属于正式研究数据；生产容器将使用全新持久化卷。

研究者**不要在正在收集被试数据时更改材料或参数**。当前仅一个版本处于活动状态，修改会让旧版作答链接停止工作；正式招募前锁定设置并进行 Prolific 预览。

## 线上部署

见 `DEPLOYMENT.md`。`Dockerfile.production` 把 Node 网页和 Python 算法打进同一个容器；`compose.production.yaml` 用于自有服务器的 PostgreSQL + Caddy HTTPS；`render.yaml` 用于无需自有服务器或域名的 Render 托管。两者都持久化材料与数据库。`.gitlab-ci.yml` 提供静态检查及容器镜像构建。当前尚无托管账户或 GitLab 项目，因此尚未生成公网链接，也未在 Docker 内实测镜像。

## 参考实现与差异

`backend/` 中的 Yıldız Multiarrangement Web API 提供 Lift-the-Weakest、逐轮证据更新、加权 RDM 与可选 inverse MDS；保留其 `backend/LICENSE`。前端根据本研究的词语任务重写，布局参考 Ansteeg、Leoné 与 Dijkstra（2022）在线排列任务和提供的界面图，不是逐行移植 Ansteeg 代码。这里的后续子集由证据最弱词对驱动，**没有运行显式聚类**。

## 已验证

- `python3 browser_formal_smoke.py`：真实 Chrome 展示 93 词首轮，初始词卡无重叠，Done 在未放入时禁用；输出 `formal-first-round.png`。
- `python3 browser_formal_smoke.py --submit`：真实 Chrome 逐张拖入 93 词、启用 Done 并进入 15–25 词的下一轮。该浏览器测试脚本需安装 `websocket-client`，且仅在 Mac Chrome 路径上验证；应用本身不需要此包。
- `python3 smoke_formal.py`：93 词首轮保存后生成 25 词自适应子集，并导出 93×93 RDM。
- 使用隔离数据目录模拟了生产启动脚本：材料目录持久化，网页/API 同时启动；无密钥导出返回 403、有密钥返回 200。
- 此电脑没有 Docker，因此 Docker 镜像、PostgreSQL 和公网 HTTPS 仍需在可用服务器上实测。
