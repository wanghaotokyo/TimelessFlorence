# Cloudflare 原生自动部署规范

> 状态：**Cloudflare 原生部署已于 2026-09-06 启用。** 当前生产地址为 `https://timeless-florence.haozi-w.workers.dev`。本文用于指导 Codex、Claude Code、Cursor、GitHub Copilot 或其他 AI Coding 工具执行后续标准部署。
>
> 最后核对 Cloudflare 官方文档：2026-09-06。

## 目标

部署必须由仓库中的标准配置和命令完成，不依赖某一种 AI 工具的专用发布接口：

```text
AI 或开发者修改代码
        ↓
提交并推送 GitHub
        ↓
GitHub Actions：安装 → 检查 → 构建 → D1 迁移 → Wrangler 发布
        ↓
Cloudflare Workers + Static Assets + D1
```

迁移完成后，任何工具只需能够修改 Git、运行 npm 命令并查看 GitHub Actions 结果，不需要拥有自己的 Cloudflare 插件。

## 版本号规则

每次部署前必须更新版本号，两处同步修改：

- `VERSION`
- `lib/release.ts` 中的 `RELEASE_VERSION`

格式为 **`v` + 东京时间（JST）精确到分钟的时间戳**，共 12 位数字，例如 `v202609061142`。

PowerShell 读取当前东京时间：

```powershell
$jst = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([System.DateTime]::UtcNow, 'Tokyo Standard Time')
$jst.ToString('yyyyMMddHHmm')
```

## 当前日常部署命令

在已通过 `wrangler login` 登录目标 Cloudflare 账号的机器上：

```sh
npm ci
npm run deploy
```

`npm run deploy` 会按顺序执行干净生产构建、待执行的远程 D1 migration 和 Worker 发布。当前仓库尚未配置 Git remote 和 GitHub Secrets，因此 GitHub Actions 无人值守部署仍是下一阶段；这不影响任何具备终端权限的 AI 工具使用上述命令部署。

## 当前项目事实

- 项目根目录是本文件所在目录，不是上一级工作区。
- 包管理器是 npm；必须使用已提交的 `package-lock.json` 和 `npm ci`。
- 构建命令是 `npm run build`，输出位于 `dist/`。
- Worker 入口由 Vinext/Cloudflare Vite 插件生成，当前结果为 `dist/server/index.js`。
- 静态资源输出为 `dist/client/`。
- Worker 使用 `nodejs_compat`。
- D1 binding 必须保持为 `DB`。
- 生产 D1 名称为 `timeless-florence`，ID 已保存在 `wrangler.jsonc`；不要重新创建同名数据库。
- Drizzle migration 位于 `drizzle/*.sql`；已应用的 migration 不得改写，只能新增。
- 运行时配置名称为：
  - 普通变量：`GOOGLE_CLIENT_ID`、`OPENAI_MODEL`、`DAILY_JOB_LIMIT`、`GLOBAL_DAILY_JOB_LIMIT`
  - Secret：`OPENAI_API_KEY`
- 根目录 `wrangler.jsonc` 是生产 Worker、静态资源与 D1 binding 的配置来源。
- `.openai/hosting.json` 与 `@openai/sites-vite-plugin` 已在首次 Cloudflare 原生生产部署验证成功后移除；旧 Sites 线上版本未被删除，可在需要时作为临时回退参考。

## 推荐方案

采用 Cloudflare Vite 插件 + 根目录 `wrangler.jsonc` + GitHub Actions。

Cloudflare 建议新项目使用 `wrangler.jsonc`，并把它作为 Worker 配置的 source of truth。Vite 构建会生成指向真实构建产物的输出 Wrangler 配置；随后运行 `wrangler deploy` 即可使用该输出配置。

不要把生产数据库 ID 临时改写进 `dist/server/wrangler.json`。`dist/` 是生成目录，每次构建都会被清理和重建。

## 一次性迁移任务（已完成，仅供重建环境时参考）

首次迁移已于 2026-09-06 完成。日常部署不要重复创建 D1 或重新执行本节的架构切换。只有重建 Cloudflare 环境时，执行迁移的 AI 才按以下顺序工作。除非用户明确授权，不能创建、替换或删除 Cloudflare 资源，也不能发布生产版本。

### 1. 收集并确认生产信息

需要用户或 Cloudflare 管理员提供/确认：

- Cloudflare account ID；
- Worker 名称，建议 `timeless-florence`；
- 已有或新建 D1 数据库的固定名称和真实 `database_id`；
- 生产域名或 `workers.dev` 地址；
- Google OAuth 中允许的生产 origin；
- `GOOGLE_CLIENT_ID` 与 `OPENAI_MODEL`；
- `DAILY_JOB_LIMIT` 与 `GLOBAL_DAILY_JOB_LIMIT`；
- `OPENAI_API_KEY`，只能写入 Cloudflare Secret/GitHub Secret，不能出现在代码、日志或聊天回复中。

若打算复用 Sites 当前管理的 D1，必须先确认该数据库是否对用户自己的 Cloudflare 账号可见并可由 Wrangler 管理。不要根据 binding 名称猜测数据库 ID，也不要把占位 ID 当成真实 ID。

### 2. 增加根目录 `wrangler.jsonc`

目标配置应以以下结构为基础；尖括号内容必须替换成经确认的真实值：

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "timeless-florence",
  "compatibility_date": "2026-05-15",
  "compatibility_flags": ["nodejs_compat"],
  "main": "vinext/server/fetch-handler",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "<PRODUCTION_D1_NAME>",
      "database_id": "<PRODUCTION_D1_ID>",
      "migrations_dir": "drizzle"
    }
  ],
  "vars": {
    "GOOGLE_CLIENT_ID": "<GOOGLE_CLIENT_ID>",
    "OPENAI_MODEL": "<OPENAI_MODEL>",
    "DAILY_JOB_LIMIT": "10",
    "GLOBAL_DAILY_JOB_LIMIT": "100"
  },
  "secrets": {
    "required": ["OPENAI_API_KEY"]
  },
  "observability": {
    "enabled": true
  }
}
```

注意：

- `OPENAI_API_KEY` 不能放入 `vars`。
- 使用 Cloudflare Vite 插件时，静态资源输出目录由插件写入构建后的配置，通常不需要在输入配置中手写 `assets.directory`。
- 不要在输入配置中写 `dist/server/index.js` 作为源码入口；Cloudflare Vite 插件会在构建输出配置中改写入口。
- 若将来引入 staging/production environments，必须在**构建阶段**通过 `CLOUDFLARE_ENV` 选择环境；仅给 `wrangler deploy` 传 `--env` 不足以切换 Vite 构建环境。

### 3. 切换 Vite 配置

修改 `vite.config.ts`：

- 保留 `vinext()` 和 `cloudflare({ viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] } })`；
- 让 Cloudflare 插件读取根目录 `wrangler.jsonc`，可以依赖默认发现，也可以显式指定 `configPath: './wrangler.jsonc'`；
- 删除 Sites 专用的 `sites()` 插件；
- 删除对 `.openai/hosting.json` 的导入、占位数据库 ID 和 `localBindingConfig`；
- 确认开发环境仍使用项目本地的 `.wrangler/` 状态目录。

完成并验证 Cloudflare 原生部署后，才可以从依赖中删除 `@openai/sites-vite-plugin`。第一次切换应保留 `.openai/hosting.json`，直到回退窗口结束。

### 4. 统一 npm 命令

`package.json` 已提供以下稳定接口，命令名不要随意变化：

```jsonc
{
  "scripts": {
    "build": "vinext build",
    "preview": "npm run build && vite preview",
    "db:migrate:production": "wrangler d1 migrations apply <PRODUCTION_D1_NAME> --remote",
    "deploy:code": "wrangler deploy",
    "deploy": "npm run check && npm run build && npm run db:migrate:production && npm run deploy:code"
  }
}
```

`prebuild` 必须继续先清理 `dist/`，防止已删除的静态文件残留在部署产物中。

当前仓库的既有 lint baseline 尚未清零，因此 `npm run deploy` 暂不把 lint 作为阻断条件；不要为了部署而批量改写业务代码或 vendored UI 组件。生产构建必须通过。API 测试需要先启动本地开发服务并初始化本地 D1。

生产自动化优先直接展开步骤，而不是只调用一个不透明脚本，这样 GitHub Actions 日志可以明确显示失败发生在检查、构建、migration 还是发布阶段。

### 5. 配置 Cloudflare Secret

首次部署前，通过 Cloudflare Dashboard 或 Wrangler 设置 `OPENAI_API_KEY`。不得每次部署都无条件覆盖 Secret。

配置中声明 `secrets.required` 后，缺失 Secret 时部署应直接失败。CI 不得打印 Secret，也不得生成并提交 `.env.production`、`.dev.vars` 或临时 secrets JSON。

### 6. 添加 GitHub Actions

建议建立两个 workflow：

1. `ci.yml`：每个 pull request 和 push 都执行 `npm ci`、lint、测试和生产构建，不接触生产数据库。
2. `deploy-production.yml`：只从受保护的 `main` 分支或手动 `workflow_dispatch` 发布；使用 GitHub `production` Environment，建议开启人工批准。

生产 workflow 的逻辑顺序：

```yaml
name: Deploy production

on:
  workflow_dispatch:
  push:
    branches: [main]

concurrency:
  group: timeless-florence-production
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    timeout-minutes: 30
    env:
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: node --test tests/*.test.mjs
      - run: npm run build
      - run: npx wrangler d1 migrations apply <PRODUCTION_D1_NAME> --remote
      - run: npx wrangler deploy
```

Cloudflare 凭据必须提供给所有需要 Wrangler API 的步骤，通常设置在 job 级 `env`，但绝不能回显。

GitHub `production` Environment 至少保存：

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

API token 必须使用最小权限并限制到目标 Cloudflare account；不要使用 Global API Key。

### 7. 保留项目发布版本规则

每次生产部署前，按 `README.md` 的既有规则，用 Asia/Tokyo 当前时间生成同一个 `vYYYYMMDDHHMM`，同时更新：

- `VERSION`
- `package.json` 的 `releaseVersion`
- `lib/release.ts`
- `public/sw.js` 中的 cache version

AI 不得只更新其中一部分。若本次仅重跑同一 commit 的失败部署，不应再次更改版本号。

### 8. Google OAuth 切换

Cloudflare 生产 URL 确定后，把准确 origin 加入 Google OAuth Authorized JavaScript origins。必须使用实际 `https://` origin，不包含路径。

原 Sites URL 在回退期内可继续保留。确认 Cloudflare URL 登录正常后，再决定是否移除旧 origin。

## D1 安全规则

- migration 必须纳入 Git，并按文件名顺序执行。
- 已上线 migration 永远不修改；结构变化通过新 migration 完成。
- CI 对 PR 只生成/检查 migration，不对生产 D1 执行 apply。
- 生产 apply 使用固定的 `database_name`，不要只依赖可能变化的 binding 名。
- `wrangler d1 migrations apply` 在 CI 中是非交互执行；执行前必须已经通过构建和测试。
- migration 失败时停止发布 Worker，不要忽略错误，也不要手工标记为已应用。
- 涉及删列、删表、不可逆数据变换时，production Environment 必须人工批准，并先确认恢复方案。

## AI 自动部署执行契约

生产部署由 `.github/workflows/deploy-production.yml` 负责。推送到 GitHub 的 `main` 分支会自动部署，也可以在 GitHub Actions 页面手动运行。GitHub 仓库必须配置 `CLOUDFLARE_ACCOUNT_ID` 与 `CLOUDFLARE_API_TOKEN` 两个 Repository secret；任何 AI Coding 工具都不得把它们写入代码、日志或聊天。AI 在自动部署模式下只需完成下列检查、提交并推送 `main`，随后检查 GitHub Actions 与生产 URL；不应要求本机保存 Cloudflare Token。

当用户明确要求“部署到 Cloudflare production”时，AI 应执行：

1. 确认当前目录是项目根目录，并读取本文、`README.md`、`package.json`、`wrangler.jsonc` 和待执行 migration。
2. 检查工作区改动，不覆盖或删除用户的无关修改。
3. 更新并核对四处发布版本；同一失败部署重试除外。
4. 运行 `npm ci`，禁止使用会静默改写 lockfile 的安装方式。
5. 运行 lint、测试和 `npm run build`。
6. 验证构建产物存在、Worker 默认导出包含可调用的 `fetch`，并确认输出配置没有占位数据库 ID。
7. 只有在用户明确授权生产发布、Cloudflare 凭据可用且前述检查通过时，才执行远程 D1 migration。
8. migration 成功后执行 `wrangler deploy`；不得在 migration 失败后继续发布。
9. 从 Wrangler 输出读取部署 URL，并进行一次非破坏性健康检查。
10. 报告部署 URL、版本、migration 状态和验证结果；不得报告成功直到 Wrangler 返回成功且 URL 可访问。

AI 必须停止并向用户说明的情况：

- 缺少真实 D1 ID、Cloudflare 凭据或生产发布授权；
- 发现数据库目标与文档不一致；
- migration 包含不可逆操作且没有明确批准/恢复方案；
- 构建、测试、migration 或部署失败；
- 生产 URL 与 Google OAuth 配置不匹配；
- 需要创建、替换、删除 Cloudflare 资源，但用户没有授权。

## 验收标准

首次迁移只有在以下条件全部满足后才算完成：

- 干净 checkout 中 `npm ci` 成功；
- lint、测试和 `npm run build` 成功；
- 构建输出不含占位 D1 ID；
- `dist/server/index.js` 存在且符合 Worker 模块格式；
- D1 migrations 已成功应用到确认过的生产数据库；
- `wrangler deploy` 成功并返回预期 Worker；
- 根页面和至少一个只读 API 返回非错误响应；
- Google 登录在生产 origin 上完成真实测试；
- 创建和读取一条测试履历后删除测试数据；
- OpenAI 生成功能只在费用与密钥配置获准后测试；
- 旧 Sites 版本在回退期内仍可用，或用户明确接受没有回退环境。

## 回退

- Worker 代码发布失败：不要改数据库，保留旧 Worker deployment。
- migration 前失败：直接修复并重跑，不影响生产数据。
- migration 后、Worker 发布前失败：先评估新 schema 是否向后兼容；不要自动执行破坏性 down migration。
- 新版本运行异常：使用 Cloudflare deployment rollback 回退 Worker，并确认回退代码与已迁移 schema 兼容。
- 第一次迁移期间：保留原 Sites 项目和配置，直到 Cloudflare 版本通过验收并经过约定观察期。

## 官方参考

- [Cloudflare Vite 插件：构建与部署](https://developers.cloudflare.com/workers/vite-plugin/tutorial/)
- [Cloudflare Vite 插件：配置文件与输出配置](https://developers.cloudflare.com/workers/vite-plugin/reference/migrating-from-wrangler-dev/)
- [Wrangler 配置参考](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [GitHub Actions 部署 Workers](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)
