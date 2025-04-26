# 项目 API 文档

本文档记录了项目提供的 API 接口。

## HTTP API

以下是通过 HTTP 协议访问的接口：

| 路径                  | 方法      | 描述                               | 
| --------------------- | --------- | ---------------------------------- | 
| `/user/login`          | `POST` | 登录 | 
| `/user/register`          | `POST`  | 注册   | 
| `/user/logout`          | `POST` | 注销   |
| `/user/profile`          | `GET` | 获取用户信息   |

**HTTP API 示例:**

#### 1.1.1 用户注册
- **URL**: `/user/register`
- **方法**: POST
- **请求体**:
```json
{
  "username": "玩家昵称",
  "password": "密码",
  "avatar": "头像URL（可选）"
}
```
- **响应**:
```json
{
  "code": 0,
  "message": "注册成功",
  "data": {
    "user_id": 10001,
    "username": "玩家昵称",
    "token": "认证令牌"
  }
}
```

#### 1.1.2 用户登录
- **URL**: `/user/login`
- **方法**: POST
- **请求体**:
```json
{
  "username": "玩家昵称",
  "password": "密码"
}
```
- **响应**:
```json
{
  "code": 0,
  "message": "登录成功",
  "data": {
    "user_id": 10001,
    "username": "玩家昵称",
    "avatar": "头像URL",
    "token": "认证令牌"
  }
}
```

#### 1.1.3 获取用户信息
- **URL**: `/user/profile`
- **方法**: GET
- **请求头**: `Authorization: Bearer {token}`
- **响应**:
```json
{
  "code": 0,
  "message": "成功",
  "data": {
    "user_id": 10001,
    "username": "玩家昵称",
    "avatar": "头像URL",
    "score": 5000,
    "win_count": 10,
    "lose_count": 5,
    "game_count": 15
  }
}
```

## WebSocket API

项目提供了 WebSocket 服务，用于斗地主游戏的实时通信。客户端需要发送 JSON 格式的消息，并包含 `cmd` (格式: `模块名/方法名`) 和 `param` 对象 (包含 `access_token`)。

服务器推送的消息通常也为 JSON 格式，包含 `type` 字段标识消息类型和 `result` 字段包含具体数据。

以下是主要的 WebSocket 接口 (模块名为 `ddz`)：

| `cmd` 值         | 描述           | 主要参数 (`param`内)           | 处理方法 (Service -> AIGameLogic) | 主要推送消息类型 (`type`)                 |
| ---------------- | -------------- | ----------------------------- | -------------------------------- | ----------------------------------------- |
| `ddz/enterRoom`  | 加入/重连房间  | `room_no`, `grade`, `ip`, `fd` | `actionEnterRoom` -> `enterRoom`   | `'room_info'`, `'player_info'`            |
| `ddz/ready`      | 玩家准备       | `room_no`                     | `actionReady` -> `ready`         | `'ready'` (-> 触发 `'deal'`, `'call'`)    |
| `ddz/call`       | 叫地主         | `room_no`, `point` (0或1)    | `actionCall` -> `call`           | `'call'`, `'is_can_play'` (确定地主后)   |
| `ddz/rob`        | 抢地主         | `room_no`, `point` (0或1)    | `actionRob` -> `rob`             | `'rob'`, `'is_can_play'` (确定地主后)    |
| `ddz/play`       | 出牌           | `room_no`, `cbCard`, `cbCard_type` | `actionPlay` -> `play`           | `'play'`, `'end'` (游戏结束)               |
| `ddz/pass`       | 过牌 (不要)    | `room_no`                     | `actionPass` -> `pass`           | `'pass'`                                  |
| `ddz/trust`      | 托管/取消托管 | `room_no`, `is_trust` (0或1) | `actionTrust` -> `trust`        | `'trust'`                                 |
| `ddz/reConnect`  | 断线重连       | `access_token`              | `actionReConnect` -> (类似 `enterRoom`) | `'room_info'`, `'player_info'` (同enterRoom) |

### 可用牌型列表

以下是系统支持的牌型列表：
```
single          单牌
single_line     单顺子(顺子)
double          对子
double_line     连对
three           三张牌
three_line      三顺
three_line_take_one  三带一
three_line_take_two  三带对
plane_with_wing 飞机带翅膀
four_line_take_two   四带二
bomb_card       炸弹
king_bomb_card  王炸
```

**注意:**

*   所有 WebSocket 请求都需要有效的 `access_token` 进行身份验证。
*   具体的游戏逻辑和状态管理在 `App/WebSocket/modules/ddz/AIGameLogic.php` 中实现。
*   连接建立 (`onHandShake`) 和断开 (`onClose`) 事件在 `App/WebSocket/Event.php` 中处理。
*   **错误处理:** 服务器对无效操作（如错误出牌、非当前玩家操作）通常会拒绝执行，并返回错误码和消息，客户端需要根据响应来判断操作是否成功。

### 错误处理

服务器可能返回如下错误响应：
```json
{
  "code": 400,
  "message": "错误信息",
  "data": null
}
```

常见错误码：
- 400: 参数错误
- 401: 未授权
- 403: 操作被拒绝
- 404: 资源不存在
- 500: 服务器内部错误

**WebSocket API 示例:**

*   **`ddz/enterRoom` (加入/重连房间)**
    *   请求 (Request):
        ```json
        {
          "cmd": "ddz/enterRoom",
          "param": {
            "access_token": "your_access_token",
            "room_no": 1001,
            "grade": "simple",
            "ip": "127.0.0.1",
            "fd": 12345
          }
        }
        ```
    *   响应 (Response - 推送):
        *   推送房间信息:
            ```json
            {
              "type": "room_info",
              "result": {
                "room_info": { 
                  "room_no": 1001, 
                  "room_status": 0,  // 0:等待, 1:游戏中
                  "room_owner": 10001,  // 房主ID
                  "game_total_number": 8,  // 总局数
                  "cur_room_game_number": 1  // 当前第几局
                },
                "player_info": [ 
                  {
                    "uid": 10001,
                    "nickname": "玩家1",
                    "avatar": "头像URL",
                    "seat_no": 1,
                    "player_status": 1,  // 0:未准备, 1:已准备
                    "is_online": 1,
                    "hand_card_num": 17  // 手牌数量
                  }
                  // 其他玩家...
                ],
                "player_hand_cards": [
                  {"value": 3, "suit": 1}, 
                  {"value": 4, "suit": 2}
                  // 其他手牌...
                ],
                "cur_out_card_player_seat_no": 1, // 当前出牌玩家座位号 (游戏中)
                "cur_call_point_player_seat_no": 0, // 当前叫分/抢地主玩家座位号 (叫分/抢地主阶段)
                "is_can_pass_card": false, // 当前玩家是否可pass
                "uid": 10001, // 接收消息的玩家UID
                "cb_last_card": [
                  {"value": 3, "suit": 1}, 
                  {"value": 3, "suit": 2}
                ], // 上一轮出的牌
                "cb_last_card_player": 10002, // 上一轮出牌玩家UID
                "cb_last_card_type": "double" // 上一轮出牌牌型
              }
            }
            ```
        *   推送新加入玩家信息:
            ```json
            {
              "type": "player_info",
              "result": {
                "uid": 10003,
                "nickname": "新玩家",
                "avatar": "头像URL",
                "seat_no": 3,
                "player_status": 0,
                "is_online": 1,
                "hand_card_num": 0
              }
            }
            ```

*   **`ddz/ready` (玩家准备)**
    *   请求 (Request):
        ```json
        {
          "cmd": "ddz/ready",
          "param": {
            "access_token": "your_access_token",
            "room_no": 1001
          }
        }
        ```
    *   响应 (Response - 推送):
        ```json
        {
          "type": "ready",
          "result": {
            "uid": 10001 // 准备的玩家UID
          }
        }
        ```
        *   (所有人准备好后) 触发服务器推送 `'deal'` 和 `'call'` 消息:
            ```json
            {
              "type": "deal",
              "result": {
                "cards": [
                  {"value": 3, "suit": 1}, 
                  {"value": 4, "suit": 2}
                  // 17张手牌...
                ]
              }
            }
            ```
            ```json
            {
              "type": "call",
              "result": {
                "cur_call_point": 0,  // 初始叫分
                "cur_call_seat_no": 0, // 还没有人叫分
                "cur_call_uid": 0,     // 还没有人叫分 
                "next_call_uid": 10001, // 第一个叫分的玩家
                "next_call_seat_no": 1, // 第一个叫分玩家的座位
                "timeout": 6000        // 超时时间(毫秒)
              }
            }
            ```

*   **`ddz/call` (叫地主)**
    *   请求 (Request):
        ```json
        {
          "cmd": "ddz/call",
          "param": {
            "access_token": "your_access_token",
            "room_no": 1001,
            "point": 1 // 0: 不叫, 1: 叫地主
          }
        }
        ```
    *   响应 (Response - 推送):
        *   通知叫分结果和下一位:
            ```json
            {
              "type": "call",
              "result": {
                "cur_call_point": 1, // 当前玩家叫的分 (0或1)
                "cur_call_seat_no": 1, // 当前玩家座位号
                "cur_call_uid": 10001, // 当前玩家UID
                "next_call_uid": 10002, // 下一个叫分/抢地主玩家UID (如果游戏继续)
                "next_call_seat_no": 2, // 下一个叫分/抢地主玩家座位号 (如果游戏继续)
                "timeout": 6000  // 超时时间(毫秒)
              }
            }
            ```
        *   或 (确定地主后):
            ```json
            {
              "type": "is_can_play",
              "result": {
                "cur_out_card_player_seat_no": 1, // 地主座位号
                "cur_uid": 10001, // 地主UID
                "is_can_pass_card": false, // 地主首次出牌不能pass
                "remain_card": [
                  {"value": 14, "suit": 1}, 
                  {"value": 15, "suit": 2},
                  {"value": 16, "suit": 1}
                ], // 3张底牌
                "landlord_seat_no": 1, // 地主座位号
                "multiple": 1, // 当前倍数
                "point": 1, // 底分
                "timeout": 20000 // 出牌超时时间 (毫秒)
              }
            }
            ```

*   **`ddz/rob` (抢地主)**
    *   请求 (Request):
        ```json
        {
          "cmd": "ddz/rob",
          "param": {
            "access_token": "your_access_token",
            "room_no": 1001,
            "point": 1 // 0: 不抢, 1: 抢地主
          }
        }
        ```
    *   响应 (Response - 推送):
        *   通知抢地主结果和下一位:
            ```json
            {
              "type": "rob",
              "result": {
                "cur_rob_point": 1, // 当前玩家抢/不抢 (0或1)
                "cur_rob_seat_no": 2, // 当前玩家座位号
                "cur_rob_uid": 10002, // 当前玩家UID
                "next_rob_uid": 10003, // 下一个抢地主玩家UID (如果游戏继续)
                "next_rob_seat_no": 3, // 下一个抢地主玩家座位号 (如果游戏继续)
                "multiple": 2, // 更新后的倍数
                "timeout": 1000 // 抢地主超时时间 (毫秒)
              }
            }
            ```
        *   或 (确定地主后): 推送 `'is_can_play'` 消息 (结构同 `ddz/call` 的响应)。

*   **`ddz/play` (出牌)**
    *   请求 (Request):
        ```json
        {
          "cmd": "ddz/play",
          "param": {
            "access_token": "your_access_token",
            "room_no": 1001,
            "cbCard": [
              {"value": 3, "suit": 1}, 
              {"value": 4, "suit": 1}, 
              {"value": 5, "suit": 1}, 
              {"value": 6, "suit": 1}, 
              {"value": 7, "suit": 1}
            ], // 打出的牌
            "cbCard_type": "single_line" // 牌型字符串
          }
        }
        ```
    *   响应 (Response - 推送):
        *   通知出牌结果和下一位:
            ```json
            {
              "type": "play",
              "result": {
                "cbCard": [
                  {"value": 3, "suit": 1}, 
                  {"value": 4, "suit": 1}, 
                  {"value": 5, "suit": 1}, 
                  {"value": 6, "suit": 1}, 
                  {"value": 7, "suit": 1}
                ], // 打出的牌
                "cbCard_uid": 10001, // 出牌玩家UID
                "cur_out_card_player_seat_no": 2, // 下一个出牌玩家座位号
                "is_can_pass_card": true, // 下一个玩家是否可pass
                "cbCard_type": "single_line", // 牌型
                "multiple": 4, // 当前倍数 (可能因炸弹增加)
                "timeout": 20000, // 出牌超时时间 (毫秒)
                "ranking": 1 // (可选) 如果玩家出完牌, 显示名次
              }
            }
            ```
        *   或 (游戏结束):
            ```json
            {
              "type": "end",
              "result": [ // 结算信息数组
                { "uid": 10001, "ranking": 1, "score": 100, "gold_coin_num": 1000 },
                { "uid": 10002, "ranking": 2, "score": -50, "gold_coin_num": -500 },
                { "uid": 10003, "ranking": 3, "score": -50, "gold_coin_num": -500 }
              ]
            }
            ```

*   **`ddz/pass` (过牌)**
    *   请求 (Request):
        ```json
        {
          "cmd": "ddz/pass",
          "param": {
            "access_token": "your_access_token",
            "room_no": 1001
          }
        }
        ```
    *   响应 (Response - 推送):
        ```json
        {
          "type": "pass",
          "result": {
            "cbCard_uid": 10001, // 过牌的玩家UID
            "cur_out_card_player_seat_no": 2, // 下一个出牌玩家座位号
            "is_can_pass_card": false, // 下家如果跟上轮同一个人, 不能pass
            "timeout": 20000 // 出牌超时时间 (毫秒)
          }
        }
        ```

*   **`ddz/trust` (托管)**
    *   请求 (Request):
        ```json
        {
          "cmd": "ddz/trust",
          "param": {
            "access_token": "your_access_token",
            "room_no": 1001,
            "is_trust": 1 // 0: 取消托管, 1: 请求托管
          }
        }
        ```
    *   响应 (Response - 推送):
        ```json
        {
          "type": "trust",
          "result": {
            "uid": 10001, // 状态变更的玩家UID
            "is_trust": 1 // 变更后的托管状态 (0 或 1)
          }
        }
        ```

*   **`ddz/reConnect` (断线重连)**
    *   请求 (Request):
        ```json
        {
          "cmd": "ddz/reConnect",
          "param": {
            "access_token": "your_access_token"
          }
        }
        ```
    *   响应 (Response - 推送给重连者): 同 `ddz/enterRoom` 响应, 推送 `'room_info'` 包含完整的当前游戏状态。 