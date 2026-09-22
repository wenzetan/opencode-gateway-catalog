# opencode-gateway-catalog

> ## ⚠️ 免责声明
>
> **本项目与 OpenCode 官方无关。**
>
> 本仓库不是由 OpenCode 团队构建的，与 OpenCode 官方及其维护者没有任何隶属、赞助、合作或背书关系。仓库名中的 `opencode` 仅用于说明用途（表明这是为 OpenCode 写的插件），不代表任何官方身份。
>
> OpenCode 及其相关标识归其各自所有者所有。

`opencode-gateway-catalog` 是一个 **OpenCode 2.x 原生插件**：它从 OpenAI-compatible Gateway（当前首要支持 **OmniRoute**）的 `/v1/models` 接口动态发现模型，把 Gateway 提供的模型元数据严格映射进 OpenCode 2 的 provider/model catalog。

用户不再需要手工维护 `providers.<id>.models` 静态列表：

```bash
opencode models
# omniroute/kr/claude-sonnet-5
# omniroute/opencode-go/kimi-k3
# omniroute/cx/gpt-5.6-sol
# ...
```

---

## 目录

- [核心原则：Gateway 是唯一事实来源](#核心原则gateway-是唯一事实来源)
- [环境要求](#环境要求)
- [安装](#安装)
- [配置](#配置)
- [Docker 部署说明（OmniRoute 在 Docker，OpenCode 在宿主机）](#docker-部署说明omniroute-在-dockeropencode-在宿主机)
- [认证](#认证)
- [工作方式](#工作方式)
- [Metadata 映射](#metadata-映射)
- [严格模式与模型跳过](#严格模式与模型跳过)
- [刷新与 last-known-good 缓存](#刷新与-last-known-good-缓存)
- [从静态 `providers.<id>.models` 迁移](#从静态-providersidmodels-迁移)
- [故障排查](#故障排查)
- [测试与验收](#测试与验收)
- [兼容性](#兼容性)
- [非目标](#非目标)
- [开发](#开发)
- [许可证](#许可证)

---

## 核心原则：Gateway 是唯一事实来源

对于 `adapter: "omniroute"`，`GET /v1/models` 是**唯一**模型 metadata 来源。

This plugin does not use models.dev or infer missing metadata.
The configured gateway is the source of truth.

具体来说，插件**不会**：

- 访问 models.dev / OpenRouter 或任何外部模型数据库
- 根据模型名称推断能力（`vision`、`gpt`、`claude`、`qwen`、`kimi`、`reasoning`、`coder`……）
- 补全缺失的 context / output / modalities / tools / pricing
- 用 200k context、32k output、`tools: true`、`image` 等乐观默认值注册模型
- 根据 `effort_tiers` 生成 reasoning variants
- 把 OmniRoute 伪装成 vLLM / LM Studio / Ollama

后果很直接：

```text
Gateway metadata incorrect   → 修 Gateway（插件不会"纠正"）
Gateway metadata incomplete  → strict 模式下该模型会被跳过并给出 warning
```

---

## 环境要求

- **OpenCode 2.x**（使用官方 `@opencode/plugin` 2.x ABI；本项目不使用、也不支持 OpenCode 1.x 的 "v2 Promise API"）
- 一个 OpenAI-compatible Gateway，暴露 `GET /v1/models`
- 插件本身无运行时 npm 依赖；构建产物为 ESM
- 从 Git 安装无需本地构建：CI 构建产物发布在 `dist` 分支与 GitHub Releases（见[安装](#安装)）

开发与测试记录：**Tested with OpenCode 2.0.12**（`opencode --version` 输出 `v2.0.12`）。

---

## 安装

### 从 Git 仓库安装（推荐）

本插件暂未发布到 npm。推送 `v*` tag 时，GitHub Actions 会自动构建，并把产物发布到 `dist` 分支与 GitHub Releases：

```bash
opencode plugin add "git+https://github.com/wenzetan/opencode-gateway-catalog.git#dist"
```

> 国内网络访问 GitHub 受限时，可使用镜像/代理加速，参见：
> <https://help.mirrors.cernet.edu.cn/github-raw/>

或手工在 `opencode.json` 中声明：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "git+https://github.com/wenzetan/opencode-gateway-catalog.git#dist",
      "options": {
        "adapter": "omniroute",
        "providerId": "omniroute",
        "providerName": "OmniRoute",
        "baseURL": "http://127.0.0.1:20128",
        "apiKeyEnv": "OMNIROUTE_API_KEY",
      },
    },
  ],
}
```

### 离线安装（Release 压缩包）

从 [GitHub Releases](https://github.com/wenzetan/opencode-gateway-catalog/releases) 下载 `opencode-gateway-catalog.tgz` 解压，然后指向解压出的构建产物目录：

```bash
tar -xzf opencode-gateway-catalog.tgz
# "package": "file:///ABSOLUTE/PATH/TO/package/dist"
```

### 本地开发安装

```bash
npm install
npm run build

# 在 opencode.json 中指向构建产物目录：
# "package": "file:///ABSOLUTE/PATH/TO/opencode-gateway-catalog/dist"
```

`opencode plugin list` 应显示 `gateway.catalog` 且状态为 active。

---

## 配置

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "git+https://github.com/wenzetan/opencode-gateway-catalog.git#dist",
      "options": {
        "adapter": "omniroute", // 默认 "omniroute"
        "providerId": "omniroute", // 默认 "omniroute"
        "providerName": "OmniRoute", // 默认 "OmniRoute"
        "baseURL": "http://127.0.0.1:20128", // 必填
        "apiKeyEnv": "OMNIROUTE_API_KEY", // 默认 "OMNIROUTE_API_KEY"；null 表示无认证
        "discoveryPath": "/v1/models", // 默认：<apiBaseURL>/models
        "refreshIntervalMs": 300000, // 默认 5 分钟；0 表示禁用后台刷新
        "timeoutMs": 10000, // discovery HTTP 超时
        "cache": true, // 默认 true：磁盘 last-known-good 缓存
        "strictMetadata": true, // 默认 true
      },
    },
  ],
}
```

| 选项                | 默认值                | 说明                                                                       |
| ------------------- | --------------------- | -------------------------------------------------------------------------- |
| `adapter`           | `"omniroute"`         | 目前仅支持 OmniRoute                                                       |
| `providerId`        | `"omniroute"`         | 注册到 OpenCode 的 provider ID；只允许字母数字及 `._-`                     |
| `providerName`      | `"OmniRoute"`         | UI 显示名                                                                  |
| `baseURL`           | 必填                  | Gateway 根地址；支持 path 前缀（如 `https://gw.example.com/prefix`）       |
| `apiKeyEnv`         | `"OMNIROUTE_API_KEY"` | 从环境变量读取 API key（推荐）；`null` 表示网关不需要认证                  |
| `apiKey`            | 未设置                | 直接在配置里写 key；可用但不推荐（key 会进入配置文件）                     |
| `discoveryPath`     | `"/v1/models"`        | 相对 `baseURL` 的发现路径；默认解析为 `<apiBaseURL>/models`                |
| `refreshIntervalMs` | `300000`              | 后台刷新间隔；`0` 关闭                                                     |
| `timeoutMs`         | `10000`               | discovery 请求超时                                                         |
| `cache`             | `true`                | 持久化 last-known-good catalog                                             |
| `strictMetadata`    | `true`                | 元数据不完整的模型是否按 warning 报告（两种取值都不会伪造数据）            |
| `maxResponseBytes`  | 16 MiB                | discovery 响应体上限                                                       |
| `logLevel`          | `"info"`              | `debug`/`info`/`warn`/`error`；也可用 `OPENCODE_GATEWAY_CATALOG_LOG_LEVEL` |

### URL 处理

`baseURL` 与执行/发现 URL 的对应关系：

| `baseURL`                       | Provider 执行 baseURL              | Discovery URL                             |
| ------------------------------- | ---------------------------------- | ----------------------------------------- |
| `http://127.0.0.1:20128`        | `http://127.0.0.1:20128/v1`        | `http://127.0.0.1:20128/v1/models`        |
| `http://127.0.0.1:20128/`       | `http://127.0.0.1:20128/v1`        | `http://127.0.0.1:20128/v1/models`        |
| `https://gw.example.com/prefix` | `https://gw.example.com/prefix/v1` | `https://gw.example.com/prefix/v1/models` |
| `http://host/prefix/v1`         | `http://host/prefix/v1`            | `http://host/prefix/v1/models`            |

path 前缀不会被删除；插件使用 WHATWG `URL` 拼接，不会产生 `//v1` 或 `/v1/v1`。

---

## Docker 部署说明（OmniRoute 在 Docker，OpenCode 在宿主机）

```text
宿主机 Linux
├── OpenCode 2.x（本插件运行在 OpenCode server runtime）
└── Docker
    └── OmniRoute
        └── 端口映射：127.0.0.1:20128:20128
```

- OpenCode 使用 **`http://127.0.0.1:20128`**。
- 不要使用 `http://omniroute:20128`：那是 Docker network 内部的容器名，宿主机上的 OpenCode 解析不到。

---

## 认证

### 推荐：环境变量

```bash
export OMNIROUTE_API_KEY="..."
```

```jsonc
{ "apiKeyEnv": "OMNIROUTE_API_KEY" }
```

- discovery 请求携带 `Authorization: Bearer <OMNIROUTE_API_KEY>`。
- 推理请求同样携带 `Authorization`：插件为 provider 注册一个 env-backed integration（`ctx.integration.transform`），OpenCode runtime 在发请求时按需从环境变量解析凭据，密钥不会进入 OpenCode 配置文件、插件缓存或日志。
- **API key 永远不会出现在日志或磁盘缓存中**；错误信息中也不会包含 Authorization header。

### 无认证 Gateway

```jsonc
{ "apiKeyEnv": null }
```

`/v1/models` 不需要认证时，provider 仍会被启用，discovery 与推理请求都不发送 `Authorization`。

### 显式 apiKey（不推荐）

```jsonc
{ "apiKey": "sk-..." }
```

支持该模式（key 注入运行时 provider settings），但 key 会出现在配置文件中；优先使用 `apiKeyEnv`。

---

## 工作方式

```text
OmniRoute GET /v1/models
        │
        ▼
transport（timeout / size limit / status / JSON）
        │
        ▼
严格 schema validation（envelope / id / duplicate / 数值）
        │
        ▼
canonical GatewayModel
        │
        ▼
OpenCode Model.Info 映射（不猜测）
        │
        ▼
ctx.provider.transform() 注册 provider + models
        │
        ▼
OpenCode 2 model catalog
```

- **推理流量不经过插件**。插件只注册 catalog；实际请求仍由 OpenCode 的 `@opencode/ai/providers/openai-compatible` 直接发往 `baseURL` 的 `/v1/chat/completions`。
- provider 注册不设置 `canonical`，因此不会意外继承 models.dev / OpenRouter / OpenAI 的 catalog。
- provider ID 冲突时 fail-safe：如果 `providerId` 已被其他来源占用（例如静态 `providers.omniroute.models`），插件会记录错误并且**不覆盖**。

---

## Metadata 映射

| OmniRoute `/v1/models`          | OpenCode `Model.Info` | 说明                                                      |
| ------------------------------- | --------------------- | --------------------------------------------------------- |
| `id`                            | `id` / `modelID`      | 原样保留，包括 `/`；发送给 Gateway 的仍是原始 id          |
| `name`                          | `name`                | 缺失时 fallback 为 `id`（仅 UI 身份，不是 metadata 补全） |
| `family`                        | `family`              | 仅当 Gateway 显式提供                                     |
| `context_length`                | `limit.context`       | 必须 > 0，否则跳过                                        |
| `max_input_tokens`              | `limit.input`         | 可选；缺失时不设置                                        |
| `max_output_tokens`             | `limit.output`        | 必须 > 0，否则跳过                                        |
| `capabilities.tool_calling`     | `capabilities.tools`  | 必须显式提供，否则跳过                                    |
| `input_modalities`              | `capabilities.input`  | 必须显式提供且非空，否则跳过                              |
| `output_modalities`             | `capabilities.output` | 必须显式提供且非空，否则跳过                              |
| `pricing.input`                 | `cost[].input`        | 仅当四项 pricing 齐全时创建 cost tier                     |
| `pricing.output`                | `cost[].output`       | 同上                                                      |
| `pricing.cached`                | `cost[].cache.read`   | 同上                                                      |
| `pricing.cache_creation`        | `cost[].cache.write`  | 同上                                                      |
| `supported_endpoints`           | surface 过滤          | 不含 chat/completions 时跳过                              |
| `output_modalities` 不含 `text` | surface 过滤          | 例如 image-only 模型会被跳过                              |

明确不映射（保留在内部 canonical model 中或忽略）：

- `capabilities.vision` / `reasoning` / `thinking` / `supportsThinking` / `effort_tiers`（OpenCode 没有语义完全一致的字段；第一版不生成 variants）
- `pricing.reasoning`
- `created` / `release_date` / `knowledge_cutoff` 等

`variants: []`、`time.released: 0`、`cost: []` 属于结构性默认值：

- `variants: []` —— 本插件没有定义 variant
- `cost: []` —— Gateway 没有提供足够 pricing 信息（**不是免费**）
- `time.released: 0` —— Gateway 未提供可映射的发布时间

---

## 严格模式与模型跳过

单个模型缺少 OpenCode schema 必需的信息时：

```text
[gateway.catalog] provider=omniroute discovered=27 registered=15 skipped=12
[gateway.catalog] skip firecrawl/news: missing max_output_tokens, input_modalities, output_modalities
```

- 缺少 `context_length` / `max_output_tokens` / `tool_calling` / modalities → 跳过 + warning 汇总（明细需要 `logLevel: "debug"`）。
- 显式非 chat surface（如 `output_modalities: ["image"]`）→ 跳过。
- `strictMetadata: false` 只会降低 skip 的日志级别；**不会**用 `false` / `[]` / 200k / 32k 等伪造值注册模型。原因是 OpenCode 2 的 `Model.Info` 无法表达"未知"能力，宁可跳过也不注入错误事实。
- 整个 catalog 结构损坏（`data` 不是数组、id 重复/缺失、JSON 非法）→ 整个 refresh 失败并保留 last-known-good，避免 Gateway bug 悄悄污染 catalog。

---

## 刷新与 last-known-good 缓存

- 启动时实时 discovery；之后按 `refreshIntervalMs` 后台刷新。
- refresh 采用 **single-flight**：timer、手动刷新、启动刷新共享同一个 in-flight 请求。
- 只有 catalog 真正变化才调用 `ctx.provider.reload()`；比较基于确定性规范化（忽略 JSON 属性顺序和 Gateway 返回顺序）。
- 新增模型会出现，被删除的模型会消失，无需重启 OpenCode。
- 刷新失败（timeout / HTTP 5xx / malformed JSON / 重复 id）→ 保留 last-known-good catalog，只记录 warning。
- 磁盘缓存位置：

```text
$XDG_CACHE_HOME/opencode-gateway-catalog/<providerId>-<hash>.json
（未设置 XDG_CACHE_HOME 时：~/.cache/opencode-gateway-catalog/）
```

缓存内容示例（**不包含 API key / Authorization / 原始网关 payload**）：

```json
{
  "version": 1,
  "adapter": "omniroute",
  "providerId": "omniroute",
  "baseURL": "http://127.0.0.1:20128/v1",
  "fetchedAt": "2026-09-22T06:42:17.000Z",
  "models": [{ "id": "kr/claude-sonnet-5", "context_length": 1000000 }]
}
```

启动顺序：实时 fetch → 成功则使用并更新缓存；失败则读取缓存；缓存也没有时插件仍然安全加载，provider 无可用模型并输出明确 warning，后台继续重试。Gateway 临时离线不会导致 OpenCode server 崩溃或插件加载失败。

缓存 key 覆盖 `adapter + providerId + baseURL`，不同环境/不同 OmniRoute 不会复用同一个 catalog。

---

## 从静态 `providers.<id>.models` 迁移

不要同时配置静态模型和本插件的动态 catalog：

```jsonc
// ❌ 不要这样：静态 models 会占用 provider id，插件 fail-safe 不覆盖
{
  "providers": {
    "omniroute": {
      "models": { "kr/claude-sonnet-5": {} },
    },
  },
  "plugins": [{ "package": "git+https://github.com/wenzetan/opencode-gateway-catalog.git#dist", "options": { "providerId": "omniroute" } }],
}
```

迁移步骤：

1. 删除 `providers.omniroute.models`（以及 `name` / `env` / `package` / `settings`，这些由插件注册）。
2. 只保留插件配置。
3. 如果暂时无法删除，先把插件的 `providerId` 改成别的值（例如 `omniroute-dynamic`）。

冲突时日志会明确说明：

```text
[gateway.catalog] provider "omniroute" already exists (package=...); Gateway Catalog will not
overwrite another provider source. Remove the static providers.omniroute block or configure a
different providerId.
```

---

## 故障排查

### `Plugin failed to load`

查看日志中的 `[gateway.catalog] invalid configuration: ...`。常见原因：`baseURL` 缺失/非法、`providerId` 非法、`adapter` 不支持。修正配置后 `opencode reload` 或重启 OpenCode。

### No models found

1. 确认 `opencode plugin list` 中 `gateway.catalog` 为 active。
2. 打开 `logLevel: "debug"`，查看 `discovered=N registered=M skipped=K`。
3. 如果 `registered=0`，用 `curl` 直接检查 `/v1/models` 的字段（见下）。
4. 如果 Gateway 暂时离线且没有缓存，插件会安全加载但无模型；恢复后后台刷新会自动出现。

### 401 / 403

- 确认 `apiKeyEnv` 指向的环境变量在 **OpenCode server 进程**中存在（`export OMNIROUTE_API_KEY=...` 后重启 OpenCode）。
- 日志不会打印 key；不要通过打印 headers 排查。

### Gateway unreachable

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:20128/v1/models
```

- Docker 场景请确认端口映射是 `127.0.0.1:20128:20128`，OpenCode 用 `http://127.0.0.1:20128`。
- 临时不可达时保留 last-known-good；长期不可达请检查 `baseURL` 和容器状态。

### Model skipped due to incomplete metadata

这是预期行为：Gateway 没有提供 OpenCode schema 必需字段（context/output/tools/modalities）。修复 Gateway 的 `/v1/models` 输出；插件不会替你补全。

### Wrong context limit / Wrong vision/tool capability

**检查 `GET /v1/models`。** 插件逐字段透传 Gateway 的值：

```bash
curl -s http://127.0.0.1:20128/v1/models -H "Authorization: Bearer $OMNIROUTE_API_KEY" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["data"][0])'
```

如果 Gateway 的值不对，去修 OmniRoute，不要在本插件里覆盖（本插件没有、也不会有 metadata override 机制）。

### OpenCode sees stale models

- 检查 `refreshIntervalMs`（默认 5 分钟）。
- 查看日志中是否出现 `catalog changed old=... new=...`。
- 确认没有同时配置静态 `providers.<id>.models`。

### 模型 ID 中有 `/`，如何选择模型？

`--model` 使用 `providerId/modelID`，其中 `modelID` 原样保留：

```bash
opencode run --model omniroute/kr/claude-sonnet-5 "hello"
```

发送给 Gateway 的请求体中 `"model"` 仍是 `kr/claude-sonnet-5`（不含 `omniroute/`）。

---

## 测试与验收

四层测试（全部真实执行）：

```bash
npm run typecheck      # TypeScript strict + host-contract 类型一致性
npm run lint           # oxlint
npm run format         # prettier --check
npm run test:unit      # parser / validation / mapper / cache / refresh / 冲突 / 性能
npm run test:integration  # 真实 opencode serve + mock gateway（推理、热刷新、LKG、无认证、npm pack artifact）
npm run test:host-contract # 真实 host 中通过 probe 插件断言 ctx.model.list()
```

真实 OmniRoute 验收（需要本机 20128 可访问）：

```bash
export OMNIROUTE_API_KEY=...
GW_PROVIDER_ID=omniroute-dynamic scripts/test-opencode-real.sh

# 如需额外执行一次真实推理（会产生一次上游调用，请自行确认成本）：
GW_RUN=1 GW_PROVIDER_ID=omniroute-dynamic scripts/test-opencode-real.sh
```

脚本会把 `/v1/models` 与 OpenCode catalog 逐字段对比（context/input/output/tools/modalities/pricing），并验证所有未注册模型都有明确的 strict skip 理由。

---

## 兼容性

- 只支持 **OpenCode >= 2.x**。
- 使用官方 `@opencode/plugin` 2.x ABI：`Plugin` / `ctx.provider.transform` / `ctx.provider.reload` / `ctx.integration.transform` / `ctx.options`。
- **不使用** `@opencode-ai/plugin`、`@opencode-ai/plugin/v2/promise`、`ctx.catalog` 等旧 ABI。
- 运行时零依赖：`@opencode/plugin` 仅作为 peerDependency 提供类型；构建产物不 import 它。
- 已在 **OpenCode 2.0.12** 上完成真实 server/inference 验证（CI 同时测试 2.0.12 与最新 2.x）。

---

## 非目标

v0.1 明确不做：

- OpenCode 1.x / 1.18 Promise v2 支持
- models.dev enrichment、OpenRouter catalog merge
- 模型名称 heuristic、metadata 补全
- LLM routing / fallback / load balancing / health routing
- chat proxy、SSE parser、tool parser、reasoning parser
- reasoning variants 合成、model alias 生成
- 自动探测上游模型能力、修改 OmniRoute 配置
- 把 Gateway 伪装成 vLLM / LM Studio / Ollama

---

## 开发

```bash
npm install
npm run build          # tsc -> dist/
npm test               # unit + integration + host-contract
npm pack --dry-run     # 检查发布内容
```

### 发布

推送 `v*` tag 触发 [`.github/workflows/release.yml`](.github/workflows/release.yml)：

- 构建并把 `opencode-gateway-catalog.tgz` 上传到 GitHub Release；
- 把 `dist/` 构建产物推送到 `dist` 分支，供 `opencode plugin add "git+https://github.com/wenzetan/opencode-gateway-catalog.git#dist"` 安装。

```bash
git tag v0.1.0
git push origin v0.1.0
```

项目结构：

```text
src/
  index.ts             # Plugin.define 入口、provider/integration 注册、生命周期
  config.ts            # 选项校验、URL 派生
  discovery.ts         # HTTP transport（timeout / size / status / JSON）
  validation.ts        # 边界校验原语
  mapper.ts            # GatewayModel -> Model.Info（无 enrichment）
  cache.ts             # 磁盘 last-known-good 缓存
  refresh.ts           # single-flight 刷新、catalog diff、reload
  logger.ts            # [gateway.catalog] 统一日志
  adapters/
    types.ts           # GatewayAdapter 抽象
    omniroute.ts       # OmniRoute parser/adapter
test/
  unit/ integration/ host-contract/ fixtures/
scripts/
  test-opencode-real.sh
  verify-omniroute-metadata.mjs
```

---

## 许可证

MIT，见 [LICENSE](LICENSE)。
