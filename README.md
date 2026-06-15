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
  config/       共享 TypeScript 配置
```

## 设计原则

- 服务端权威：客户端只提交玩家意图，所有合法性由服务端判断。
- 协议强类型：客户端命令和服务端事件全部由 `@ddz/protocol` 校验。
- 身份可信：HTTP API 签发 JWT，游戏服务只从 token claims 识别玩家身份，不信任客户端传入的 `playerId`。
- 规则纯函数：牌型、比较、发牌逻辑放在 `@ddz/domain`，前后端共享。
- 明确失败：登录等未完成能力返回显式错误，不写 mock 成功路径。

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

打开 Web 后点击“快速开始”会自动创建带两个机器人的测试房间；“创建房间”仍然创建普通真人房间。

本地默认使用已安装的 PostgreSQL：`localhost:5433`，用户 `postgres`，密码 `123456`，数据库名 `ddz`。如果本机还没有数据库，先创建一次：

```bash
createdb -h localhost -p 5433 -U postgres ddz
```

`docker-compose.yml` 只保留为备用 PostgreSQL 方案；当前项目不依赖 Redis。

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
- `VITE_API_ENDPOINT` / `VITE_GAME_ENDPOINT`：Web 访问 API 和实时服务的地址。

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
- `@ddz/game-server`：Colyseus 房间，支持 JWT 入房、按房间号隔离牌桌、房间状态同步、服务端权威回合倒计时、超时自动不叫/不抢/过牌/出牌、可配置机器人补位、基于手牌牌力的机器人叫地主/抢地主、机器人出牌基于手牌分解规划领出并按角色配合(不压队友、保留炸弹拦截即将走完的对手)、记牌识别绝对大牌避免浪费在小牌上、带公开快照的对局事件写入、断线重连、开局前离房释放座位、准备、叫地主、抢地主、出牌、过牌、结算和显式拒绝非法命令。
- `@ddz/api`：健康检查、Prisma 数据模型、注册、登录、scrypt 密码哈希、JWT 签发、房间创建、房间列表、快速匹配、受内部 token 保护的房间状态更新和对局事件写入；对局动作批次使用 `mutationId` 幂等写入，`round_settled` 会在同一数据库事务中关闭 Round、写入 RoundPlayer、更新真人用户金币并创建 CoinLedger；机器人参与对局历史但不写 User/CoinLedger；已提供受 JWT 保护的个人战绩、单局回放和金币流水查询。
- `@ddz/web`：React 应用壳 + 登录/注册 + 大厅房间列表 + 选择房间后连接 Phaser 牌桌场景，已接入准备、叫地主、抢地主、提示、出牌、过牌命令和服务端倒计时展示，并在侧栏展示个人战绩、回放事件时间线和金币流水；回放步骤会优先使用历史动作里的公开快照恢复座位、当前玩家、地主、上一手牌和结算摘要，支持手动步进、自动播放和返回实时牌桌；Phaser 已拆成独立懒加载 chunk，避免进入首屏主包；牌桌已经接入迁移后的桌面、桌台、按钮、金币、牌背和基础音效资源。

下一步建议：

1. 完善历史对局回放的动画节奏和完整牌局状态还原。
2. 完成真实牌桌交互细节：拖拽选牌、出牌动画和阶段提示。
3. 补充前端端到端冒烟验证，覆盖登录、入房、准备、出牌和回放查看。
