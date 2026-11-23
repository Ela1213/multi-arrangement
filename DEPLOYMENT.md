# 线上部署操作

本项目必须有持续运行的后端和数据库。GitLab 用于保存源代码和构建镜像；GitLab Pages 只能托管静态网页，不能单独运行本任务的 Python 算法与数据库。本项目也支持 GitHub → 阿里云 ECS 部署，逐步说明见 `阿里云ECS上线与Prolific流程.md`。真实公网链接须在域名、ECS 和 HTTPS 配好后产生。

## 路线 A：Render 托管（无需自有服务器或域名）

`render.yaml` 会申请一个 Docker 网页服务、一块持久化磁盘和一个 PostgreSQL 数据库；Render 提供 `https://…onrender.com` 地址。应用和数据库都选 Frankfurt 区域，供英国被试访问。持续部署已关闭，招募期间的代码更新需手动执行。由于持久化磁盘及长期数据库需要付费，创建 Blueprint 前请在 Render 页面核对资源规格与费用。

1. 创建 GitLab 空项目并推送本目录（下方有 Git 命令）。
2. 创建 Render 账户，连接 GitLab；在 Render 的 Blueprints 中选择该仓库和 `render.yaml`。
3. 创建时输入单独生成的 `RESEARCHER_ADMIN_KEY`；`EXPERIMENTER_KEY_SECRET` 由平台生成。等网页服务和数据库均健康后，记录自动生成的 HTTPS 地址。
4. 打开该地址的 `/setup`，输入管理员密钥，检查 93 词和参数，填入 Prolific completion URL 并保存。最后通过 Prolific Preview 完整试跑。

`PUBLIC_BASE_URL` 在 Render 自动使用平台提供的 `RENDER_EXTERNAL_URL`。如果以后改用自己的域名，再在服务环境变量中显式设置 `PUBLIC_BASE_URL=https://<域名>`。

## 路线 B：自有 Linux 服务器 + 域名

### 需要准备

- 一个可运行 Docker Engine + Compose 插件的 Linux 云服务器，开放 80/443 端口；建议先在小规模预试中测负载与备份。
- 一个域名或子域名，将 DNS A/AAAA 记录指向服务器。
- 一个 GitLab 项目。把本目录提交并推送。`.gitlab-ci.yml` 会做语法检查和构建 GitLab Container Registry 镜像；服务器也可以直接从仓库 `docker compose ... up --build` 构建。
- 在 Prolific 建立研究后取得该研究的 completion URL，填入线上设置页。不要把真实管理员密钥或数据库密码提交到 Git。

### 服务器上首次启动

创建空的 GitLab 项目后，在本目录执行以下命令（将地址换成自己的项目）：

```bash
git init -b main
git add .
git commit -m "Add 93-word multi-arrangement experiment"
git remote add origin git@gitlab.com:<用户名或组>/<项目名>.git
git push -u origin main
```

首次提交前检查 `git status --short`，确认没有 `data/`、`.venv/`、`.env.production` 或测试截图。GitLab CI 只构建镜像；实际运行仍由服务器上的 Compose 完成。

在服务器克隆项目后，在项目根目录执行：

```bash
cp .env.production.example .env.production
# 编辑 .env.production：填入真实 DOMAIN、POSTGRES_PASSWORD、EXPERIMENTER_KEY_SECRET、RESEARCHER_ADMIN_KEY
chmod 600 .env.production
docker compose --env-file .env.production -f compose.production.yaml up -d --build
docker compose --env-file .env.production -f compose.production.yaml ps
```

三个密钥请分别生成，例如各执行一次 `openssl rand -hex 32`，不可共用。PostgreSQL 只在 Compose 内网开放。Caddy 对公网提供 HTTPS 并反向代理到应用。首次启动会把 93 词、指导语图和配置写入持久化 `app_data` 卷；之后从研究者设置页修改材料会保存到该卷，重建容器也会保留。

检查 `https://<域名>/api/health` 和 `https://<域名>/setup`。在设置页输入 `RESEARCHER_ADMIN_KEY`，先检查 93 词和参数，再填 Prolific completion URL 并保存。设置页导出也要求此密钥。

## Prolific 连接

把 `https://<域名>/` 填为外部研究 URL，并在 Prolific 选择通过 URL 自动记录被试 ID、用完成 URL 返回。Prolific 会传入 `PROLIFIC_PID`、`STUDY_ID`、`SESSION_ID`；本系统将三者关联保存。完成 URL 必须在招募前配置，否则被试不会自动返回 Prolific。通过 Prolific 的 Preview 完整测试一次：指导语 → 首轮 93 词 → 后续子集 → 自动完成/跳转 → 研究者 JSON/CSV 导出。

如由 Qualtrics 跳转到本任务，请让 Qualtrics 保留并转发上述三个参数；两任务可分开运行，无需合并程序。

## 更新、备份与恢复

Render 路线：招募期间不要手动部署新版本；通过研究者设置页定期导出 JSON/CSV，并在 Render 控制台确认数据库备份与持久化磁盘的备份选项和保留期。JSON/CSV 是实验数据导出，不代替材料和数据库的完整备份。

以下命令仅用于自有服务器路线。更新前暂停新招募，备份数据库和应用材料。代码更新后：

```bash
git pull
docker compose --env-file .env.production -f compose.production.yaml up -d --build
./backup_production.sh
```

`backup_production.sh` 在 `backups/` 生成 PostgreSQL SQL 压缩备份和应用卷压缩备份（含版本材料、邀请映射）。备份文件含被试标识，应限制访问。建议安排定期备份并在另一位置保留副本。研究中不要改材料或算法设置；改动会生成新版本并使旧链接不可继续。

## 目前已检查的范围

本机验证了 93 词首轮、后续 25 词子集、93×93 RDM、持久化材料启动路径及生产管理员认证。当前 Mac 没有 Docker，容器构建、PostgreSQL、DNS、HTTPS 和 Prolific 实际回跳须在获得服务器和域名后验证。

## 现有线上服务更新本次界面

若此前版本已部署且 `/data/materials` 已持久化，推送并部署新代码后，进入 `/setup`：取消“显示指导语图片”，把 `arrangement.config.json` 中的新文字指导语填入，保存后取得新材料版本。代码更新与材料更新应在暂停招募时完成；旧版邀请链接不会自动指向新版。首次部署则会直接使用本次默认设置。
