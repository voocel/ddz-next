package state

// Context 状态上下文接口
type Context interface {
	// GetData 获取上下文数据
	GetData(key string) interface{}

	// SetData 设置上下文数据
	SetData(key string, value interface{})
}

// State 状态接口
type State interface {
	// Enter 进入状态
	Enter(ctx Context)

	// Update 更新状态
	Update(ctx Context)

	// Exit 退出状态
	Exit(ctx Context)

	// GetName 获取状态名称
	GetName() string
}

// BaseState 基础状态
type BaseState struct {
	name string
}

// NewBaseState 创建新的基础状态
func NewBaseState(name string) *BaseState {
	return &BaseState{
		name: name,
	}
}

// Enter 进入状态
func (s *BaseState) Enter(ctx Context) {
	// 基类默认空实现
}

// Update 更新状态
func (s *BaseState) Update(ctx Context) {
	// 基类默认空实现
}

// Exit 退出状态
func (s *BaseState) Exit(ctx Context) {
	// 基类默认空实现
}

// GetName 获取状态名称
func (s *BaseState) GetName() string {
	return s.name
}

// DefaultContext 默认上下文实现
type DefaultContext struct {
	data map[string]interface{}
}

// NewDefaultContext 创建新的默认上下文
func NewDefaultContext() *DefaultContext {
	return &DefaultContext{
		data: make(map[string]interface{}),
	}
}

// GetData 获取上下文数据
func (c *DefaultContext) GetData(key string) interface{} {
	return c.data[key]
}

// SetData 设置上下文数据
func (c *DefaultContext) SetData(key string, value interface{}) {
	c.data[key] = value
}

// StateMachine 状态机
type StateMachine struct {
	currentState State
	states       map[string]State
	context      Context
}

// NewStateMachine 创建新的状态机
func NewStateMachine(ctx Context) *StateMachine {
	if ctx == nil {
		ctx = NewDefaultContext()
	}

	return &StateMachine{
		states:  make(map[string]State),
		context: ctx,
	}
}

// AddState 添加状态
func (sm *StateMachine) AddState(state State) {
	sm.states[state.GetName()] = state
}

// ChangeState 切换状态
func (sm *StateMachine) ChangeState(stateName string) {
	newState, ok := sm.states[stateName]
	if !ok {
		return
	}

	if sm.currentState != nil {
		sm.currentState.Exit(sm.context)
	}

	sm.currentState = newState
	sm.currentState.Enter(sm.context)
}

// Update 更新当前状态
func (sm *StateMachine) Update() {
	if sm.currentState != nil {
		sm.currentState.Update(sm.context)
	}
}

// GetCurrentState 获取当前状态
func (sm *StateMachine) GetCurrentState() State {
	return sm.currentState
}

// GetContext 获取上下文
func (sm *StateMachine) GetContext() Context {
	return sm.context
}
