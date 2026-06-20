# DDZ Next

这是斗地主项目的全新 TypeScript 重构版本。目标是服务端权威、协议强类型、规则纯函数、前端 Phaser 表现层。

## 架构

```txt
apps/
  web/          React + Vite + Phaser 客户端
  game-server/ Colyseus 实时游戏服务
  api/          Fastify HTTP API 与 Prisma 数据模型
packages/
  domain/       斗地主规则、发牌、牌型识别、局状态机
  protocol/     Zod 消息协议和 DTO
  auth/         JWT 签发与验签
  bot-ai/       大模型机器人：多 provider 注册表（anthropic / deepseek / openai-compatible）、LLM 选牌与人格解说
  config/       共享 TypeScript 配置
```

## 设计原则

- 服务端权威：客户端只提交玩家意图，所有合法性由服务端判断。
- 协议强类型：客户端命令和服务端事件全部由 `@ddz/protocol` 校验。
- 身份可信：HTTP API 签发 JWT，游戏服务只从 token claims 识别玩家身份，不信任客户端传入的 `playerId`。
- 规则纯函数：牌型、比较、发牌逻辑放在 `@ddz/domain`，前后端共享。
- 明确失败：登录等未完成能力返回显式错误，不写 mock 成功路径。

## 大模型机器人（项目亮点）

让大模型真刀真枪打斗地主，做成一个**服务端权威、可观测、不作弊也不自欺**的实验系统，与规则机器人并存。大厅「大模型对战」即可对局，模型在「设置」里选。

- **选牌而非生成牌**：服务端用 `@ddz/domain` 枚举全部合法走法（规范化去重）并编号，模型只回一个数字——物理上无法出非法牌。
- **只给公开事实，不灌输策略**：手牌、本局已出的牌、各家身份与剩牌、上一手——和真人所见一致，出什么由模型自己想，如实验牌力。
- **牌桌内实时 AI 输出流**：决策走 `streamText`，模型的 reasoning 与普通文本输出都会流式广播到机器人座位上方气泡（默认折叠「AI 输出中」，点击展开看实时文本）——即使模型只吐最终编号，也能看到请求仍在推进。
- **不静默降级**：超时 / 解析失败 / 越界 / 缺 key 一律抛错暴露，绝不偷偷回退规则机器人假装在跑 AI。
- **全程留证**：`BOT_DECISION_TRACE` 开启后每手决策落一行 JSONL（prompt / reasoning / 用量 / 延迟 / 已出牌），逐手可复盘。
- **慢决策不卡房间**：决策在串行锁外执行，牌桌上一样有倒计时闹钟（纯视觉、更长），到点不抢牌、继续等模型。
- **思考强度可调 / 默认关闭**：出牌只需要选编号，默认关闭 DeepSeek thinking；需要观察模型原生推理时，可在「设置」里切到模型默认或高强度。
- **provider 无关**：`@ddz/bot-ai` 零依赖游戏规则，支持 Anthropic、DeepSeek（V4 双模）以及任意 OpenAI 兼容服务（OpenRouter / 本地模型等），兼容推理类模型。

> 当前只有出牌相位交给大模型，叫 / 抢地主仍走固定规则以隔离实验变量。配置见「多 provider 机器人配置」，牌力验证见「大模型机器人自博弈实验」。

## 本地开发

```bash
pnpm install
export DATABASE_URL=postgresql://postgres:123456@localhost:5433/ddz
pnpm --filter @ddz/api db:migrate
pnpm build
pnpm test

pnpm --filter @ddz/game-server dev
pnpm --filter @ddz/api dev
pnpm --filter @ddz/web dev
```

如果本机数据库已经启动，也可以在一个终端里启动完整开发栈：

```bash
./start.sh
```

打开 Web 后点击“快速开始”会自动创建带两个机器人的测试房间（规则机器人）；“创建房间”仍然创建普通真人房间；“大模型对战”会创建一桌**大模型机器人**直接开打（设计见上文「大模型机器人（项目亮点）」）。模型在大厅“设置”里选——可选项由 game-server 从 `bot-providers.json` 动态下发(`GET /bot-models`，按 provider 分组，无密钥)；未选则用服务端默认模型。**服务端未配置对应 API key 时直接建房失败并提示**，不会静默降级成规则机器人（目的是实验验证 LLM，缺配置就该让你知道）。该入口按房间携带所选 `{provider, model}` 与**思考强度**（默认关闭 / 模型默认 / 低 / 中 / 高，给推理模型提速、可直接关闭），覆盖服务端 `BOT_DECISION` / `BOT_REASONING_EFFORT` 默认；**API key 始终只在服务端**，前端只见 provider/model 标签。

本地默认使用已安装的 PostgreSQL：`localhost:5433`，用户 `postgres`，密码 `123456`，数据库名 `ddz`。如果本机还没有数据库，先创建一次：

```bash
createdb -h localhost -p 5433 -U postgres ddz
```

`docker-compose.yml` 只保留为备用 PostgreSQL 方案；当前项目不依赖 Redis。

### Docker Compose 生产部署

生产一键部署使用 `docker-compose.prod.yml`，会启动 PostgreSQL、执行 Prisma migration、启动 API、Game Server 和 Nginx 静态 Web。

```bash
cp .env.production.example .env.production
# 编辑 .env.production：必须替换 POSTGRES_PASSWORD / JWT_SECRET / INTERNAL_API_TOKEN。
# 如果部署到服务器，把 PUBLIC_* 和 CORS_ORIGINS 改成公网域名或服务器 IP。
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

默认暴露端口：

- Web: `http://localhost:8080`
- API: `http://localhost:3000`
- Game Server: `http://localhost:2567`

容器内部地址和浏览器地址不要混用：

- `API_ENDPOINT=http://api:3000` 是 Game Server 在容器网络里访问 API，用 compose 固定配置。
- `PUBLIC_API_ENDPOINT` / `PUBLIC_GAME_ENDPOINT` 是浏览器访问地址，会在 Web 构建时写入前端包；上服务器时必须改成公网可访问地址。
- `CORS_ORIGINS` 必须包含 Web 的真实访问 origin，例如 `https://ddz.example.com` 或 `http://1.2.3.4:8080`。

大模型 provider 密钥不要写进镜像。容器部署优先用 `.env.production` 注入 `BOT_PROVIDERS` 内联 JSON，或只部署规则机器人并保持 `BOT_DECISION=rule`。如果开启 `BOT_DECISION_TRACE=true`，trace 会写入 Docker volume `ddz-llm-traces`。

需要自动 HTTPS 时，使用内置 Caddy profile。先把 3 个域名解析到服务器，并确保 80/443 端口对公网开放：

```env
ACME_EMAIL=admin@example.com
CADDY_WEB_HOST=ddz.example.com
CADDY_API_HOST=api.ddz.example.com
CADDY_GAME_HOST=game.ddz.example.com
PUBLIC_WEB_ORIGIN=https://ddz.example.com
PUBLIC_API_ENDPOINT=https://api.ddz.example.com
PUBLIC_GAME_ENDPOINT=https://game.ddz.example.com
CORS_ORIGINS=https://ddz.example.com
```

然后启动：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production --profile https up -d --build
```

启用 Caddy 后浏览器只需要访问 `https://ddz.example.com`。API 和 Game Server 会分别通过 `https://api.ddz.example.com`、`https://game.ddz.example.com` 暴露；WebSocket 由 Caddy 自动反代。服务器安全组可以只开放 80/443，`8080/3000/2567` 不必对公网开放。
如果同机只通过 Caddy 访问，可在 `.env.production` 里把 `WEB_BIND` / `API_BIND` / `GAME_BIND` 改成 `127.0.0.1`，避免这些直连端口监听公网。

查看状态和日志：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api game-server web
```

完整链路冒烟需要先启动真实数据库、API 和 Game Server，不会使用 mock 或模拟成功路径。以下命令分别在不同终端运行：

```bash
pnpm --filter @ddz/api dev
BOT_COUNT=2 BOT_MOVE_DELAY_MS=50 TURN_TIMEOUT_MS=3000 pnpm --filter @ddz/game-server dev
pnpm smoke:preflight
pnpm smoke:full-stack
```

`pnpm smoke:full-stack` 会注册一次性用户、创建房间、加入实时牌桌、准备、叫抢地主、出牌/过牌直到结算，并查询战绩、回放和金币流水。任一步失败都会让命令失败。
`pnpm smoke:preflight` 只检查 PostgreSQL、API `/health` 和 Game Server 端口是否可达，不会启动服务或跳过失败。

本地开发默认会确保演示账号可用，打开 Web 后直接点击登录即可：

- 用户名：`alice`
- 密码：`secret123`

这是明确的开发体验账号，不是登录失败兜底；生产环境 `NODE_ENV=production` 时默认关闭，也可以通过 `DEMO_USER_ENABLED=false` 手动关闭。

默认端口：

- Web: `http://localhost:5173`
- API: `http://localhost:3000`
- Game Server: `http://localhost:2567`

关键环境变量：

- `DATABASE_URL`：API 使用的 PostgreSQL 连接串，本地默认 `postgresql://postgres:123456@localhost:5433/ddz`。
- `JWT_SECRET`：API 和 Game Server 必须使用相同值。
- `JWT_ISSUER` / `JWT_AUDIENCE`：JWT 签发方和受众，默认 `ddz-api` / `ddz-web`。
- `INTERNAL_API_TOKEN`：Game Server 调用 API 内部接口时使用的共享密钥。
- `DEMO_USER_ENABLED` / `DEMO_USER_USERNAME` / `DEMO_USER_PASSWORD`：本地开发演示账号配置；生产环境默认关闭。
- `API_ENDPOINT`：Game Server 同步房间状态时访问的 API 地址。
- `API_SYNC_TIMEOUT_MS`：Game Server 调用 API 内部接口的 HTTP 超时时间，默认 `5000`。
- `API_SYNC_RETRY_ATTEMPTS` / `API_SYNC_RETRY_DELAY_MS`：Game Server 对内部接口的有限重试配置，默认 `3` / `150`；对局动作写入通过 `mutationId` 做幂等保护后再重试。
- `BOT_COUNT`：每个牌桌预置机器人数量，默认 `0`；单人调试可设为 `2`。
- `BOT_MOVE_DELAY_MS`：机器人出牌延迟。默认不设置，按相位模拟真人思考节奏（自由领出想得久、跟牌/过牌更快、叫抢一个短停顿，均带随机抖动）。设置后变为固定延迟并关闭拟真，供冒烟测试等压成极小值。
- `TURN_TIMEOUT_MS`：服务端权威回合超时时间，默认 `20000`。
- `BOT_CHAT_ENABLED`：是否启用大模型机器人人格解说，默认 `false`；设为 `true` 时机器人出牌后会异步生成一句台词广播（`bot_chat` 事件）。纯装饰，不参与决策、不阻塞对局；超时/失败/缺 key 均静默。解说使用供应商注册表的默认模型（见下方「多 provider 机器人配置」）。
- `ANTHROPIC_API_KEY`：未配置 `bot-providers.json` 时的兜底——据此合成单一 `anthropic` 供应商（含 Haiku/Sonnet/Opus）；缺失则解说与 LLM 决策静默降级（不报错）。
- `BOT_CHAT_PERSONA`：机器人性格描述，默认「爱炫耀、嘴上不饶人但心态好的老牌玩家」。
- `BOT_CHAT_TIMEOUT_MS` / `BOT_CHAT_MAX_CHARS`：单次解说超时与台词字数上限，默认 `4000` / `40`。
- `BOT_DECISION`：机器人出牌决策来源，`rule`（默认，规则引擎）或 `llm`（大模型）。设为 `llm` 时，**出牌相位**由模型在 `@ddz/domain` 枚举出的合法走法里选一手；叫/抢地主仍走固定规则（隔离实验变量，只验证 LLM 的出牌能力）。**出牌相位不再静默回退**：模型超时/限流/解析失败/越界一律抛错暴露（线上由房间故障关闭并记日志，selfPlay 里如实记为失败局）；缺 key 则建房直接报错。服务端权威不变（模型只能从合法候选里选）。具体模型由「大模型对战」入口所选或注册表默认决定，决策设计与可观测性详见上文「大模型机器人（项目亮点）」。
- `BOT_DECISION_TIMEOUT_MS`：大模型单次出牌决策的真超时，默认 `60000`（推理 / thinking 模型单步思考动辄十几秒，给足头寸避免误判失败）。到点 abort 并**抛错暴露**（不回退规则）。注意机器人回合**不受面向真人的 `TURN_TIMEOUT_MS` 管辖**，这是机器人唯一的决策时钟。
- `BOT_REASONING_EFFORT`：大模型「思考强度」服务端默认，`off`（默认，关闭思考，最快）/ `auto`（跟随模型）/ `low` / `medium` / `high`。出牌决策只需要选合法候选编号，默认关闭可避免 DeepSeek 把输出 token 全耗在 reasoning 里而不给最终编号；客户端「设置」里的选择会覆盖它。各 provider 行为：**Anthropic** 各档均生效（`effort` / 关闭走 `thinking.disabled`）；**DeepSeek V4** 双模可真正关闭思考（`thinking.disabled`），但官方 `reasoning_effort` 的 low/medium 会被其服务端归到 high（强度降不下来，只有「关闭」与「高」两档真正不同）；**其它 openai-compatible** 无统一关闭语义，关闭会退化为最低档 `low`。
- `BOT_LLM_TURN_TIMER_MS`：大模型机器人回合在牌桌上展示的倒计时（ms），默认 `30000`。**纯视觉**——和真人一样有个闹钟在转，但到点不触发任何兜底动作（不替模型抢牌），真超时由上面的 `BOT_DECISION_TIMEOUT_MS` 收口。规则机器人则沿用 `TURN_TIMEOUT_MS`。
- `BOT_DECISION_TRACE`：设为 `true` 时把每一手大模型决策落 JSONL 留证（含 prompt / reasoning / 用量 / 延迟 / 已出牌 / 结局），供逐手排错与牌力分析；默认关闭。
- `BOT_TRACE_DIR`：留证 JSONL 的输出目录（相对仓库根或绝对路径），默认 `logs/llm-traces`，每房一文件 `<房间号>-<起始时间>.jsonl`。
- `BOT_PROVIDERS_FILE`：供应商注册表 JSON 路径（相对仓库根或绝对路径），默认仓库根 `bot-providers.json`。
- `VITE_API_ENDPOINT` / `VITE_GAME_ENDPOINT`：Web 访问 API 和实时服务的地址。

### 多 provider 机器人配置

大模型机器人支持多家 provider、多模型，配置走一个 JSON 文件（含密钥，**仅服务端持有，已 gitignore，绝不下发前端**）：

```bash
cp bot-providers.example.json bot-providers.json   # 仓库根；或用 BOT_PROVIDERS_FILE 指定其他路径
# 编辑 bot-providers.json，填入各家 api_key / base_url / models
```

文件结构（`type` 为 `anthropic` 走 Anthropic 原生适配器，`deepseek` 走 DeepSeek 官方 OpenAI-compatible 接口并注入 V4 `thinking` / `reasoning_effort`，其余/缺省一律走 OpenAI 兼容适配器，覆盖 OpenRouter、MiMo、本地服务等）：

```jsonc
{
  "provider": "deepseek",          // 默认 provider（未选模型时用它）
  "model": "deepseek-v4-pro",      // 默认 model
  "providers": {
    "deepseek": {
      "type": "deepseek",          // DeepSeek 官方兼容接口：V4 双模，可真正关闭思考
      "api_key": "sk-xxx",
      "base_url": "https://api.deepseek.com",
      "label": "DeepSeek",         // 可选，前端下拉分组标题
      "models": ["deepseek-v4-pro", "deepseek-v4-flash"]
    },
    "anthropic": { "type": "anthropic", "api_key": "sk-ant-xxx", "models": ["claude-haiku-4-5"] }
  }
}
```

游戏服务启动时读取该文件，构建注册表并把**无密钥**的模型清单通过 `GET /bot-models` 下发给前端「设置」里的下拉。`bot-providers.json` 缺失时，回退用 `ANTHROPIC_API_KEY` 合成单一 `anthropic` 供应商（向后兼容旧用法）。客户端所选 `{provider, model}` 由 game-server 按注册表校验，非法值自动回退默认。

配置来源优先级：`BOT_PROVIDERS` 环境变量（内联 JSON 字符串）> `BOT_PROVIDERS_FILE` 指向的文件（默认仓库根 `bot-providers.json`）> `ANTHROPIC_API_KEY` 兜底。容器化部署时**不要把含密钥的文件 `COPY` 进镜像**（仓库已提供 `.dockerignore` 排除 `.env` 与 `bot-providers.json`）；改用 env 注入 `BOT_PROVIDERS`，或用 volume / secret 挂载文件并以 `BOT_PROVIDERS_FILE` 指向绝对路径。

### 大模型机器人自博弈实验

验证「某个模型到底会不会打斗地主」用自博弈 A/B：焦点座位分别用规则 bot（对照）和 LLM bot（实验）对打 N 局，对比胜率，并采集回退率、决策延迟、token 成本。

密钥可写进根 `bot-providers.json`（多 provider）或根 `.env` 的 `ANTHROPIC_API_KEY`（脚本会自动加载，与线上 game-server 同一套 `loadRootEnv`），也可临时用环境变量传入。

```bash
# 仅跑规则对照(零成本,自检 harness)
pnpm --filter @ddz/game-server selfplay -- --games 50 --skip-llm
# 接入模型对打(产生真实 API 费用)。--provider 缺省 anthropic;配了 bot-providers.json 可指定任意 provider
pnpm --filter @ddz/game-server selfplay -- --games 30 --provider anthropic --model claude-haiku-4-5
pnpm --filter @ddz/game-server selfplay -- --games 30 --provider deepseek --model deepseek-v4-pro
```

## 前端技术取舍

这类斗地主项目适合采用 React + Phaser 的组合，而不是把整个前端都放进 Phaser。

- React 负责业务界面：登录注册、大厅、房间列表、战绩、回放列表、金币流水。这些是表单、列表、状态展示，DOM 可访问性和布局能力更合适。
- Phaser 负责牌桌场景：手牌选择、出牌动画、牌面层级、音效、结算表现。它对游戏循环、资源加载、输入事件和动画编排更直接。
- 规则仍然不放在 Phaser：`@ddz/domain` 是唯一规则核心，Game Server 权威执行，Phaser 只渲染快照并提交玩家意图。

## 当前状态

已经完成第一条垂直薄片：

- `@ddz/domain`：牌、发牌、牌型识别、比较、提示出牌、准备、叫地主、抢地主、出牌、结算状态机；准备动作会显式返回是否触发新一局，且对局开始后拒绝重复准备；等待/准备阶段支持真人离座并重新压紧座位。
- `@ddz/protocol`：客户端命令、服务端事件、登录 DTO，覆盖准备、叫地主、抢地主、出牌、过牌、结算、战绩、单局回放和金币流水；结算 payload 校验 3 人结果和零和分数。
- `@ddz/auth`：HMAC-SHA256 JWT 签发与验签。
- `@ddz/game-server`：Colyseus 房间，支持 JWT 入房、按房间号隔离牌桌、房间状态同步、服务端权威回合倒计时、超时自动不叫/不抢/过牌/出牌、可配置机器人补位、基于手牌牌力的机器人叫地主/抢地主、机器人出牌基于手牌分解规划领出并按角色配合(不压队友、保留炸弹拦截即将走完的对手)、记牌识别绝对大牌避免浪费在小牌上、可选由**大模型接管出牌决策**(候选编号选择制杜绝非法出牌、给足公开记牌信息、不静默降级、逐手 JSONL 留证)、带公开快照的对局事件写入、断线重连、开局前离房释放座位、准备、叫地主、抢地主、出牌、过牌、结算和显式拒绝非法命令。
- `@ddz/api`：健康检查、Prisma 数据模型、注册、登录、scrypt 密码哈希、JWT 签发、房间创建、房间列表、快速匹配、受内部 token 保护的房间状态更新和对局事件写入；对局动作批次使用 `mutationId` 幂等写入，`round_settled` 会在同一数据库事务中关闭 Round、写入 RoundPlayer、更新真人用户金币并创建 CoinLedger；机器人参与对局历史但不写 User/CoinLedger；已提供受 JWT 保护的个人战绩、单局回放和金币流水查询。
- `@ddz/web`：React 应用壳 + 登录/注册 + 大厅房间列表 + 选择房间后连接 Phaser 牌桌场景，已接入准备、叫地主、抢地主、提示、出牌、过牌命令和服务端倒计时展示，并在侧栏展示个人战绩、回放事件时间线和金币流水；回放步骤会优先使用历史动作里的公开快照恢复座位、当前玩家、地主、上一手牌和结算摘要，支持手动步进、自动播放和返回实时牌桌；Phaser 已拆成独立懒加载 chunk，避免进入首屏主包；牌桌已经接入迁移后的桌面、桌台、按钮、金币、牌背和基础音效资源。

下一步建议：

1. 完善历史对局回放的动画节奏和完整牌局状态还原。
2. 完成真实牌桌交互细节：拖拽选牌、出牌动画和阶段提示。
3. 补充前端端到端冒烟验证，覆盖登录、入房、准备、出牌和回放查看。
