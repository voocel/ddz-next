# DDZ Next

DDZ Next 是一个 **AI 驱动的斗地主公开实验场**：让大模型在真实斗地主规则下出牌，把「大模型会不会打斗地主」这个问题做成可看、可测、可挑战的答案。TypeScript 全栈，重构自 [voocel/ddz-vue](https://github.com/voocel/ddz-vue)。

<p align="center">
  <img src="scripts/desk.png" alt="ddz-next desk" width="800">
</p>

三个支点：

- **可看（表）**：竞技场直播每一手的模型 reasoning 流与赛事解说；每局落库成公开复盘，思考留证逐步回放。
- **可测（里）**：排行榜按模型聚合全部已结束对局的胜率/地主胜率/累计分/技术负；决策 trace 全量留证。
- **可挑战（基准）**：真人随时开一张挑战桌，选两位 AI 对手亲自上桌——人类对局是棋力的第三只锚。

## 玩法入口

| 路由 | 内容 | 访问 |
|---|---|---|
| `/` | AI 首页：正在直播、模型排行榜、名局复盘、「开一场 AI 对战」「挑战 AI」入口 | 匿名可浏览 |
| `/replay/:roundId` | 公开复盘：只读舞台步进回放 + 每一步的 AI 思考留证 | 匿名可浏览 |
| `/arena/:code` | 竞技场观战：3 席大模型同桌对战直播 | 需登录 |
| `/table/:code` | 挑战桌：1 真人 + 2 席 AI 对手 | 需登录 |

- **竞技场**：选三位模型选手与思考强度开赛，全 AI 对局自动推进，局间自动开下一局，结果计入排行榜。
- **挑战桌**：选两位 AI 对手（每席独立 provider/model）上桌开打，对手建桌时确定。
- 阵容与思考强度会记住上次选择；离开牌桌页（含浏览器后退）即离开房间。

## 核心机制：AI 怎么出牌

- **候选编号制**：服务端用 `@ddz/domain` 枚举全部合法走法并编号，模型只返回候选编号，从机制上杜绝非法出牌。
- **只给公开事实**：prompt 只包含手牌、上一手、已出牌、身份、剩牌数等真人可见信息，不灌输隐藏信息。
- **实时思考直播**：牌桌与观战页实时展示模型的 reasoning / 输出流与最终选择。
- **完整 trace 留证**：开启 `BOT_DECISION_TRACE=true` 后，每手 LLM 决策落 JSONL（prompt、输出、reasoning、延迟、用量、错误详情）；成功决策摘要随对局动作落库，公开复盘逐步可看。
- **不静默降级**：模型超时、上游报错、空响应、解析失败、编号越界、缺 key 都显式失败；竞技场耗尽重试记流局与技术负，绝不偷偷换规则机器人。
- **慢模型不卡锁**：LLM 决策在房间串行锁外执行，真实超时由 `BOT_DECISION_TIMEOUT_MS` 控制。
- **多 provider**：`@ddz/bot-ai` 支持 Anthropic、DeepSeek、MiMo 与 OpenAI-compatible 服务；key 只存在服务端。
- **思考强度可调**：关闭 / 模型默认 / 低 / 中 / 高，按 provider 能力映射 thinking / reasoning 参数；默认中档（思考直播是核心观赏点）。

当前只有**出牌阶段**由大模型接管；叫地主 / 抢地主仍走固定规则，目的是先隔离变量，专注验证大模型会不会打牌。

## 架构

```txt
apps/
  web/          React + Vite + Phaser 客户端
  game-server/  Colyseus 实时游戏服务（房间权威、bot 大脑、竞技场导演）
  api/          Fastify HTTP API 与 Prisma 数据模型（留证、排行、复盘）
  smoke/        全栈冒烟（真实注册→建房→打完一局→校验落库）

packages/
  domain/       斗地主规则、发牌、牌型识别、合法走法、局状态机
  protocol/     Zod 消息协议和 DTO
  auth/         JWT 签发与验签
  bot-ai/       多 provider 注册表、LLM 出牌选择、trace、thinking 参数适配
  config/       共享 TypeScript 配置
```

核心原则：

- 服务端权威：客户端只提交意图，所有合法性由服务端判断；建房阵容逐席经注册表校验，非法即拒。
- 规则纯函数：牌型、比较、提示、状态机放在 `@ddz/domain`，前后端共享。
- 协议强类型：客户端命令和服务端事件全部由 `@ddz/protocol` 校验。
- 身份可信：API 签发 JWT，Game Server 只信 token claims。
- Debug-first：真实失败必须暴露，避免 mock 成功、静默 fallback 和吞错。

牌桌前端边界：

- React 负责业务 UI：首页、HUD、按钮、设置、AI 思考卡、回放控制、结算弹窗、错误与连接状态。
- Phaser 负责舞台表现：牌、座位、选牌命中、发牌/出牌/炸弹等动画、音效。
- 数据流单向：服务端事件进入 React 状态，再同步给 `PhaserTable` 更新舞台；Phaser 不请求网络。
- 房间连接挂载驱动：进入 `/table`、`/arena` 页即连接，卸载即断开——「后退即离房」由结构保证。

## 本地开发

```bash
pnpm install

export DATABASE_URL=postgresql://postgres:123456@localhost:5433/ddz
pnpm --filter @ddz/api db:migrate

pnpm --filter @ddz/api dev
pnpm --filter @ddz/game-server dev
pnpm --filter @ddz/web dev
```

如果本机数据库已经准备好，也可以直接启动完整开发栈：

```bash
./start.sh
```

本地默认数据库：

- Host: `localhost:5433`
- User: `postgres`
- Password: `123456`
- Database: `ddz`

如果数据库不存在，先创建：

```bash
createdb -h localhost -p 5433 -U postgres ddz
```

> **从旧版本升级**：历史 migration 已压缩为单一 init migration，且数据模型移除了金币/匹配等旧概念。
> 旧库无法增量迁移，请清空重建：本地 `pnpm --filter @ddz/api prisma migrate reset`；
> Docker 部署先 `docker compose -f docker-compose.prod.yml --env-file .env.production down -v` 删卷后重新拉起。

本地演示账号：

- 用户名：`alice`
- 密码：`secret123`

默认端口：

- Web: `http://localhost:5173`
- API: `http://localhost:3000`
- Game Server: `http://localhost:2567`

## 配置大模型

大模型 provider 配置走服务端私有 JSON，仓库里只提交示例，不提交真实 key：

```bash
cp bot-providers.example.json bot-providers.json
```

配置形态：

```jsonc
{
  "provider": "mimo",
  "model": "mimo-v2.5-pro",
  "providers": {
    "mimo": {
      "type": "mimo",
      "api_key": "tp-xxx",
      "base_url": "https://token-plan-cn.xiaomimimo.com/v1",
      "label": "MiMo",
      "models": ["mimo-v2.5-pro", "mimo-v2.5"]
    },
    "wool": {
      "type": "anthropic",
      "api_key": "sk-ant-xxx",
      "base_url": "https://api.anthropic.com",
      "label": "Wool",
      "models": ["claude-sonnet-4-6"]
    }
  }
}
```

支持的 provider 类型：

- `anthropic`：走 Anthropic 原生适配器，支持可见 thinking 和 effort。
- `deepseek`：走 DeepSeek 官方 OpenAI-compatible 接口，适配 V4 thinking / reasoning 参数。
- `mimo`：走 MiMo 官方 OpenAI-compatible 接口，支持 thinking enabled / disabled。
- `openai-compatible`：用于 OpenRouter、自建网关、本地模型等通用兼容服务。

配置来源优先级：

1. `BOT_PROVIDERS`：内联 JSON 字符串。
2. `BOT_PROVIDERS_FILE`：指向 JSON 文件，默认仓库根 `bot-providers.json`。
3. `ANTHROPIC_API_KEY`：兼容旧配置，合成单一 Anthropic provider。

`GET /bot-models` 只会下发无密钥的 provider/model 列表。API key 始终只在服务端。

## 关键环境变量

基础服务：

- `DATABASE_URL`：API 使用的 PostgreSQL 连接串。
- `JWT_SECRET`：API 和 Game Server 必须一致。
- `INTERNAL_API_TOKEN`：Game Server 调 API 内部接口的共享密钥。
- `API_ENDPOINT`：Game Server 在容器或本机网络里访问 API 的地址。
- `PUBLIC_API_ENDPOINT` / `PUBLIC_GAME_ENDPOINT`：Web 构建时写入的浏览器访问地址。
- `CORS_ORIGINS`：允许访问 API 的 Web origin。

AI 对局：

- `AI_BATTLE_ENABLED`：LLM 对局创建闸门（竞技场/挑战桌共用），默认 `false`，用于控制真实模型费用。
- `AI_BATTLE_MAX_ACTIVE`：单个 game-server 进程内同时活跃的大模型房间（竞技场+挑战桌）上限。
- `BOT_PROVIDERS_FILE` / `BOT_PROVIDERS`：provider 注册表。
- `BOT_DECISION_TIMEOUT_MS`：LLM 单次出牌决策真实超时。
- `BOT_LLM_TURN_TIMER_MS`：牌桌上展示给 AI 回合的视觉倒计时。
- `BOT_REASONING_EFFORT`：服务端默认思考强度，建房时客户端可覆盖。
- `BOT_DECISION_TRACE`：开启后写 JSONL trace。
- `BOT_TRACE_DIR`：trace 输出目录，默认 `logs/llm-traces`。
- `ARENA_MAX_ROUNDS` / `ARENA_INTERMISSION_MS` / `ARENA_MAX_SPECTATORS`：竞技场局数上限、局间间歇、观众容量。

完整默认值以 `.env.example`、`.env.production.example` 和代码内默认值为准。

## Docker 部署

生产部署使用 `docker-compose.prod.yml`，会启动 PostgreSQL、执行 Prisma migration、启动 API、Game Server 和 Nginx 静态 Web。

```bash
cp .env.production.example .env.production
# 编辑 .env.production：替换 POSTGRES_PASSWORD / JWT_SECRET / INTERNAL_API_TOKEN 等密钥。
# 上服务器时，把 PUBLIC_* 和 CORS_ORIGINS 改成真实公网域名。

docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

默认直连端口只绑定 `127.0.0.1`，推荐放在同机反代后面：

- Web: `http://127.0.0.1:8080`
- API: `http://127.0.0.1:3000`
- Game Server: `http://127.0.0.1:2567`

需要内置 HTTPS 时，可以启用 Caddy profile：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production --profile https up -d --build
```

容器部署时不要把真实 `bot-providers.json` COPY 进镜像。可以用 `BOT_PROVIDERS` 注入，也可以把私有文件挂载到容器里并用 `BOT_PROVIDERS_FILE` 指向它。

查看状态和日志：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api game-server web
```

## 验证

基础检查：

```bash
pnpm build
pnpm test
pnpm smoke:preflight
```

完整链路冒烟：

```bash
pnpm smoke:full-stack
```

`smoke:full-stack` 会真实注册用户、创建房间、连接 WebSocket、准备、叫抢地主、出牌 / 过牌直到结算，并查询战绩与回放落库。它不会使用 mock 或模拟成功路径，任何一步失败都会让命令失败。

## 自博弈实验

验证某个模型到底会不会打斗地主，可以跑自博弈 A/B：焦点座位分别用规则 bot 和 LLM bot 对打 N 局，对比胜率、决策延迟、失败率和 token 成本。

```bash
# 零成本规则对照
pnpm --filter @ddz/game-server selfplay -- --games 50 --skip-llm

# 接入真实模型，会产生 API 费用
pnpm --filter @ddz/game-server selfplay -- --games 30 --provider mimo --model mimo-v2.5-pro
pnpm --filter @ddz/game-server selfplay -- --games 30 --provider wool --model claude-sonnet-4-6
```

## 致谢

本项目积极参与并认可 [linux.do 社区](https://linux.do/)。
