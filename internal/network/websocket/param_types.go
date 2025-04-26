package websocket

// 定义WebSocket API的参数结构体，按照API文档

// 所有客户端请求的基础参数
type BaseParam struct {
	AccessToken string `json:"access_token"` // 认证令牌
}

// 加入/重连房间参数
type EnterRoomParam struct {
	BaseParam
	RoomNo int    `json:"room_no"` // 房间号
	Grade  string `json:"grade"`   // 场次等级
	IP     string `json:"ip"`      // 客户端IP
	FD     int    `json:"fd"`      // 客户端连接ID
}

// 准备参数
type ReadyParam struct {
	BaseParam
	RoomNo int `json:"room_no"` // 房间号
}

// 叫地主参数
type CallParam struct {
	BaseParam
	RoomNo int `json:"room_no"` // 房间号
	Point  int `json:"point"`   // 分数，0不叫，1叫地主
}

// 抢地主参数
type RobParam struct {
	BaseParam
	RoomNo int `json:"room_no"` // 房间号
	Point  int `json:"point"`   // 0不抢，1抢地主
}

// 出牌参数
type PlayParam struct {
	BaseParam
	RoomNo     int        `json:"room_no"`     // 房间号
	CBCard     []CardInfo `json:"cbCard"`      // 打出的牌
	CBCardType string     `json:"cbCard_type"` // 牌型字符串
}

// 过牌参数
type PassParam struct {
	BaseParam
	RoomNo int `json:"room_no"` // 房间号
}

// 托管参数
type TrustParam struct {
	BaseParam
	RoomNo  int `json:"room_no"`  // 房间号
	IsTrust int `json:"is_trust"` // 0取消托管，1托管
}

// 重连参数
type ReConnectParam struct {
	BaseParam
}

// 斗地主卡牌信息
type CardInfo struct {
	Value int `json:"value"` // 牌面值
	Suit  int `json:"suit"`  // 花色
}

// 下面是服务器推送消息的结果结构体

// 房间信息结果
type RoomInfoResult struct {
	RoomInfo struct {
		RoomNo            int `json:"room_no"`              // 房间号
		RoomStatus        int `json:"room_status"`          // 房间状态，0等待，1游戏中
		RoomOwner         int `json:"room_owner"`           // 房主ID
		GameTotalNumber   int `json:"game_total_number"`    // 总局数
		CurRoomGameNumber int `json:"cur_room_game_number"` // 当前第几局
	} `json:"room_info"`
	PlayerInfo               []RoomPlayerInfo `json:"player_info"`                             // 房间内玩家信息
	PlayerHandCards          []CardInfo       `json:"player_hand_cards,omitempty"`             // 当前玩家手牌
	CurOutCardPlayerSeatNo   int              `json:"cur_out_card_player_seat_no,omitempty"`   // 当前出牌玩家座位号
	CurCallPointPlayerSeatNo int              `json:"cur_call_point_player_seat_no,omitempty"` // 当前叫分玩家座位号
	IsCanPassCard            bool             `json:"is_can_pass_card,omitempty"`              // 是否可以过牌
	UID                      int64            `json:"uid"`                                     // 接收消息的玩家ID
	CBLastCard               []CardInfo       `json:"cb_last_card,omitempty"`                  // 上一轮出牌
	CBLastCardPlayer         int64            `json:"cb_last_card_player,omitempty"`           // 上一轮出牌玩家ID
	CBLastCardType           string           `json:"cb_last_card_type,omitempty"`             // 上一轮出牌类型
}

// 房间中的玩家信息
type RoomPlayerInfo struct {
	UID          int64  `json:"uid"`           // 玩家ID
	Nickname     string `json:"nickname"`      // 昵称
	Avatar       string `json:"avatar"`        // 头像
	SeatNo       int    `json:"seat_no"`       // 座位号
	PlayerStatus int    `json:"player_status"` // 玩家状态，0未准备，1已准备
	IsOnline     int    `json:"is_online"`     // 是否在线，0离线，1在线
	HandCardNum  int    `json:"hand_card_num"` // 手牌数量
}

// 准备通知结果
type ReadyResult struct {
	UID int64 `json:"uid"` // 准备的玩家ID
}

// 发牌结果
type DealResult struct {
	Cards []CardInfo `json:"cards"` // 17张手牌
}

// 叫分结果
type CallResult struct {
	CurCallPoint   int   `json:"cur_call_point"`              // 当前叫的分
	CurCallSeatNo  int   `json:"cur_call_seat_no"`            // 当前叫分玩家座位号
	CurCallUID     int64 `json:"cur_call_uid"`                // 当前叫分玩家ID
	NextCallUID    int64 `json:"next_call_uid,omitempty"`     // 下一个叫分玩家ID
	NextCallSeatNo int   `json:"next_call_seat_no,omitempty"` // 下一个叫分玩家座位号
	Timeout        int   `json:"timeout"`                     // 超时时间(毫秒)
}

// 抢地主结果
type RobResult struct {
	CurRobPoint   int   `json:"cur_rob_point"`              // 当前玩家抢/不抢
	CurRobSeatNo  int   `json:"cur_rob_seat_no"`            // 当前玩家座位号
	CurRobUID     int64 `json:"cur_rob_uid"`                // 当前玩家ID
	NextRobUID    int64 `json:"next_rob_uid,omitempty"`     // 下一个抢地主玩家ID
	NextRobSeatNo int   `json:"next_rob_seat_no,omitempty"` // 下一个抢地主玩家座位号
	Multiple      int   `json:"multiple"`                   // 当前倍数
	Timeout       int   `json:"timeout"`                    // 超时时间(毫秒)
}

// 可以出牌结果
type IsCanPlayResult struct {
	CurOutCardPlayerSeatNo int        `json:"cur_out_card_player_seat_no"` // 当前出牌玩家座位号
	CurUID                 int64      `json:"cur_uid"`                     // 当前出牌玩家ID
	IsCanPassCard          bool       `json:"is_can_pass_card"`            // 是否可以过牌
	RemainCard             []CardInfo `json:"remain_card"`                 // 底牌
	LandlordSeatNo         int        `json:"landlord_seat_no"`            // 地主座位号
	Multiple               int        `json:"multiple"`                    // 当前倍数
	Point                  int        `json:"point"`                       // 底分
	Timeout                int        `json:"timeout"`                     // 超时时间(毫秒)
}

// 出牌结果
type PlayResult struct {
	CBCard                 []CardInfo `json:"cbCard"`                      // 打出的牌
	CBCardUID              int64      `json:"cbCard_uid"`                  // 出牌玩家ID
	CurOutCardPlayerSeatNo int        `json:"cur_out_card_player_seat_no"` // 下一个出牌玩家座位号
	IsCanPassCard          bool       `json:"is_can_pass_card"`            // 下一个玩家是否可以过牌
	CBCardType             string     `json:"cbCard_type"`                 // 牌型
	Multiple               int        `json:"multiple"`                    // 当前倍数
	Timeout                int        `json:"timeout"`                     // 超时时间(毫秒)
	Ranking                int        `json:"ranking,omitempty"`           // 出完牌的玩家名次
}

// 过牌结果
type PassResult struct {
	CBCardUID              int64 `json:"cbCard_uid"`                  // 过牌玩家ID
	CurOutCardPlayerSeatNo int   `json:"cur_out_card_player_seat_no"` // 下一个出牌玩家座位号
	IsCanPassCard          bool  `json:"is_can_pass_card"`            // 下一家是否可以过牌
	Timeout                int   `json:"timeout"`                     // 超时时间(毫秒)
}

// 托管结果
type TrustResult struct {
	UID     int64 `json:"uid"`      // 状态变更的玩家ID
	IsTrust int   `json:"is_trust"` // 变更后的托管状态
}

// 游戏结束结果
type EndResult []struct {
	UID         int64 `json:"uid"`           // 玩家ID
	Ranking     int   `json:"ranking"`       // 名次
	Score       int   `json:"score"`         // 分数
	GoldCoinNum int   `json:"gold_coin_num"` // 金币变化
}
