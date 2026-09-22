# opencode-gateway-catalog

[中文](#中文说明) | [English](#english)

---

> ## ⚠️ 免责声明
>
> **本项目与 OpenCode 官方无关。**
>
> 本仓库不是由 OpenCode 团队构建的，与 OpenCode 官方及其维护者没有任何隶属、赞助、合作或背书关系。仓库名中的 `opencode` 仅用于说明用途（表明这是为 OpenCode 写的插件），不代表任何官方身份。
>
> OpenCode 及其相关标识归其各自所有者所有。

---

## 中文说明

### 这是什么

个人自用的 [OpenCode](https://opencode.ai) 插件仓库，用来开发和存放我自己在用的 OpenCode 插件。

计划中的插件方向是「把自建/第三方 LLM 网关的模型目录接入 OpenCode」这类需求（仓库名里的 `gateway` / `catalog` 指的就是这个）。**具体设计尚未确定**，以仓库后续的实际提交为准；在代码出现之前，本仓库不承诺任何 API、配置格式或功能范围。

### 维护状态（请先读这一段）

- 本仓库是**个人自用项目**，我**不会积极开发**它：没有路线图，没有发布计划，功能以我自己的使用场景为准。
- **我不处理 Issues**：新开的 Issue 可能长期无人回复，也可能被直接关闭。有需求请直接提 **Pull Request**。
- 不提供技术支持，不承诺修复时间，不保证向后兼容；随时可能推倒重写、暂停或归档。
- 目前处于早期阶段，**尚未发布任何可用的插件或版本**。下面的「安装/使用」章节等有实际产物后再补。

### 与 OpenCode 官方的关系

OpenCode 官方在其主仓库 README 的 [Building on OpenCode](https://github.com/sst/opencode#building-on-opencode) 一节中要求：

> If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

本仓库据此声明：

- 本仓库**不是**由 OpenCode 团队构建的；
- 与 OpenCode 官方**没有任何关系**（not affiliated in any way）；
- **未**获得 OpenCode 官方的任何认可、赞助或背书；
- 本仓库中的一切内容仅代表作者个人，与 OpenCode 官方立场无关；
- 使用本仓库的代码所产生的任何后果由使用者自行承担。

### 安装 / 使用

尚未发布，待补充。

### 贡献

只接受 **Pull Request**，且不保证会被合并：

- 一次 PR 只做一件事，说明动机和验证方式；
- 保持改动小、可读、可回滚；
- 不引入与个人使用场景无关的抽象、依赖或配置项；
- 提交 PR 即表示同意以本仓库的许可证分发你的贡献。

### 许可证

MIT，见 [LICENSE](LICENSE)。

---

## English

### What this is

A personal-use repository for [OpenCode](https://opencode.ai) plugins — plugins I build and use myself.

The intended direction is hooking a self-hosted / third-party LLM gateway's model catalog into OpenCode (that is what `gateway` / `catalog` in the repository name refers to). **Nothing is designed yet**: treat whatever is actually committed here as the source of truth. Until code exists, no API, config format or feature set is promised.

### Maintenance status (read this first)

- This is a **personal project** and I **do not actively develop it**: no roadmap, no release schedule, features follow my own use cases.
- **I do not handle issues.** New issues may go unanswered for a long time or be closed outright. If you need something, send a **Pull Request**.
- No support, no fix-time commitments, no backward-compatibility guarantees. The project may be rewritten, paused or archived at any time.
- Early stage: **no plugin and no release has been published yet.** The usage section below will be filled in once there is something real to install.

### Relationship to OpenCode

The official OpenCode README asks, under [Building on OpenCode](https://github.com/sst/opencode#building-on-opencode):

> If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

Accordingly, and explicitly:

- This repository is **not** built by the OpenCode team.
- It is **not affiliated with OpenCode in any way**.
- It is **not** endorsed, sponsored or approved by the OpenCode team.
- Everything here reflects the author only, not the OpenCode project.
- You are responsible for any consequences of using code from this repository.

### Install / Usage

Not published yet. To be filled in.

### Contributing

**Pull Requests only**, and merging is not guaranteed:

- One thing per PR; explain the motivation and how you verified it.
- Keep changes small, readable and revertible.
- Do not add abstractions, dependencies or options unrelated to the personal use cases here.
- Opening a PR means you agree your contribution is distributed under this repository's license.

### License

MIT — see [LICENSE](LICENSE).
