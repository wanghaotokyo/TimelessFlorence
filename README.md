# Timeless Florence

电脑网页体验版：中文即时朗读，三语文字界面，Google 登录接入，作品识别与生成接口，云端履历，离线文字与图片。音频不保存。

Windows 11 可选 Kokoro 中文本地神经语音实验版。首次准备会把约 350 MB 模型下载到浏览器缓存；之后使用 Edge 或 Chrome 的 WebAssembly 兼容模式在本机生成语音，可断网工作，不需要 TTS Key，也不按次数收费。Windows 系统声音继续作为轻量备用。

## 现在可以体验

- 打开《维纳斯的诞生》编辑示例，查看图片、介绍、口播稿和来源。
- 使用 Kokoro 本地自然声或 Windows 系统声音朗读，暂停/继续/停止/上一句/下一句。
- 示例本机履历改名、删除；保存离线文字和图片。
- 日语、英语只提供生成后的阅读，不提供语音。

示例明确标注为编辑内容，固定约 2 分钟，不是假装由输入即时生成。示例只保存在本机。Google 和文字服务未配置时，界面明确提示，不模拟登录或生成成功。

## 配置真实服务

复制 `.env.example` 到本机 `.env`（当前已有空配置）；密钥只在本机文件或部署服务的密钥设置中填写，不发到聊天、不提交 Git。

- `GOOGLE_CLIENT_ID`：Google Cloud 的 Web OAuth 客户端 ID。将实际运行 origin 加入 Authorized JavaScript origins。电脑开发为 `http://localhost:3000`；当前私有预览为 `https://timeless-florence.haozi-w.chatgpt.site`。使用 Google Identity Services 的弹窗 credential 流，不需要应用持有 Google client secret。
- `OPENAI_API_KEY`：OpenAI 服务端密钥。Codex 中可以启用 OpenAI Developers 插件，在批准后创建或复用密钥并作为部署密钥设置；本会话没有该插件，未创建任何密钥。
- `OPENAI_MODEL`：账号可用、支持 Responses 后台模式、web_search、结构化输出的模型 ID。没有暗中默认模型或未授权付费调用。
- `DAILY_JOB_LIMIT` / `GLOBAL_DAILY_JOB_LIMIT`：每日任务数量上限，默认 10 / 100。一次完整流程包含一次识别任务和一次生成任务，每个任务包含检索与整理两次模型调用。数量上限不是精确金额上限，供应商后台仍应设置费用预算。

部署环境通过 Sites 环境变量管理，不会自动读取本机 `.env`。私有预览外层访问控制不等于应用 Google 登录。面向公众开放需另行配置访问范围、Google 发布设置并完成真实账号测试。

## 开发

```sh
npm install
npm run dev
npm run db:generate
npm run build
node --test tests/*.test.mjs
```

数据表定义在 `db/schema.ts`，迁移在 `drizzle/`，上线由 Sites 应用。不要在请求处理中创建表。已应用迁移不可改写。

## 数据与恢复

Google ID token 经 Google JWKS 验证签名、issuer、audience、到期、nonce，以 sub 标识用户。随机应用会话的哈希保存在数据库，Cookie 为 HttpOnly / SameSite，HTTPS 下使用 Secure。所有写入验证同源，所有私有读取验证用户归属。

生成任务存云端，使用 OpenAI 后台任务。页面轮询时推进检索与稿件整理；关页期间供应商继续当前阶段，下次打开再推进下一阶段。任务幂等，超时失败，不无限重试收费调用。

履历云端权威、本机缓存；离线改名/删除进入本机队列，联网同步。改名冲突可保留本机标题或采用云端标题。离线删除不会立即影响其他断网设备。退出需要联网撤销会话，然后清理当前账号本机资料。

离线保存检查应用外壳、文字、图片完成，再标记可用。不会保存音频。Kokoro 模型或系统中文声音必须先在目标电脑准备好，才能断网朗读。浏览器数据可被清除；目前无独立导出备份。首版使用一个应用页面，服务工作线程不缓存 API 或账号响应。

## 当前验证边界

真实 Google 登录、付费模型调用、实际中文发声和浏览器断网重启需配置后/目标设备实测，不能仅凭编译通过宣称验证完成。WebMCP 仅提供填写查询的工具，若浏览器没有验证上下文则记录为未实测。

图片：示例为 Wikimedia Commons 公共领域图像；新生成作品尝试返回 Commons 公共领域相关资料图，标明需核对版本。无法取得可靠可用图片时显示缺失状态，不伪造原作。

## 发布版本规则

每次对线上站点做任何更新时，必须在发布前用部署当时的日本时间（Asia/Tokyo）更新 `VERSION`、`package.json` 的 `releaseVersion` 与 `lib/release.ts`，格式严格为 `vYYYYMMDDHHMM`，例如 `v202609051624`。页面顶部从 `lib/release.ts` 读取版本号；同时更新 `public/sw.js` 的缓存版本，避免用户看到旧页面。随后执行生产构建、创建新的 Sites 版本并部署；部署成功后才算本次更新完成。当前发布版本：`v202609052039`。

## 本地 Qwen3-TTS

中文离线高保真朗读只使用 `Qwen3-TTS-12Hz-1.7B-CustomVoice`，不再包含 CosyVoice。首次使用时，在 Windows 电脑安装 Python 3.12 后执行：`py -3.12 -m pip install -r local-tts/requirements.txt`，再执行 `py -3.12 local-tts/qwen3_tts_server.py`。首次启动会下载模型；服务启动后，在网站的“语音与设置”选择“本地 Qwen3-TTS 高保真（离线）”，并测试本机服务连接。
