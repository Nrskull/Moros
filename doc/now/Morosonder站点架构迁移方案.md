# Morosonder站点架构迁移方案

## 文档目的

- 这份文档用于定义 `Morosonder` 的站点级迁移目标
- 它不记录单个页面的视觉需求，而是收口“项目应该如何从单入口原型升级为可维护的网站”
- 后续做结构重构、路由升级、目录拆分、品牌统一时，以本文件为准逐项检查

## 当前状态判断

### 当前项目已经不是单页原型

- 当前浏览器已经具备 `6` 个真实路径：
  - `/`
  - `/timeline`
  - `/chronicle`
  - `/logs`
  - `/chat`
  - `/events/:eventId`
- 当前应用内部已经存在 `6` 个页面视图：
  - `home`
  - `timeline`
  - `age-chronicle`
  - `log-workbench`
  - `chat-room`
  - `event-detail`
- 其中真正暴露在顶部导航的主入口有 `5` 个：
  - 首页
  - 故事时间轴
  - 角色年龄编年
  - 日志展示
  - 聊天室
- 当前已经是 URL 驱动页面切换，但路由解析和页面装载仍集中在 `src/App.svelte`

### 当前结构的主要问题

- `src/App.svelte` 同时承担了站点壳层、导航、世界观管理、时间轴主页面、抽屉弹层和页面切换，职责过重
- 时间轴主页面还没有像日志页、聊天页、年龄页一样抽成独立页面组件
- 项目品牌信息仍然停留在旧状态：
  - 站内仍然存在旧 `timeline` 临时命名残留
  - 目录和组件边界还没完成 `Morosonder` 站点化拆分

## 本轮迁移目标

### 目标定位

- 本轮目标：把当前项目正式升级为 `Morosonder` 网站
- 本轮目标：从“单入口伪路由应用”升级为“URL 驱动的多页面 SPA”
- 本轮目标：显著缩小 `App.svelte` 的职责，让它只负责站点壳层和路由出口

### 技术路线结论

- 当前迁移目标不是直接改成 `SvelteKit`
- 当前迁移目标仍然保留 `Svelte + TypeScript + Vite` 前端主体
- 当前迁移目标是在现有技术栈内引入真实客户端路由层，并完成目录拆分
- 聊天室后端继续保留 `Node.js + WebSocket + SQLite`，不在本轮并入前端框架

### 为什么本轮不直接迁 `SvelteKit`

- 当前仓库已经同时有时间轴编辑、日志工坊、聊天室、角色卡和身份体系，直接换框架会把变量叠在一起
- 当前最急迫的问题不是 SSR，也不是全站接口同构，而是：
  - 路由仍是假路由
  - 顶层文件过大
  - 页面边界不清晰
  - 品牌名未统一
- 先完成站点结构和路由治理，再评估是否迁到 `SvelteKit`，风险更低，检查也更明确

## 目标站点信息

### 站点名称

- 站点正式名称：`Morosonder`

### 本轮需要统一的位置

- `package.json` 项目名
- `index.html` 页面标题
- README 顶部标题和简介
- 站内顶层文案里出现的旧“timeline / tmp-timeline / 各种跑团时间轴”表述

## 目标路由设计

### 路由总则

- 以后页面切换不能再只依赖 `activePage`
- 每个主页面都必须有可直接访问、可刷新恢复、可分享的 URL
- 在世界观尚未拥有稳定数据库主键前，世界观状态先使用查询参数承载

### 目标主路由

| 路径 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 首页 | 站点说明、公告和模块入口 |
| `/timeline` | 故事时间轴页 | 支持 `?worldview=<name>` |
| `/chronicle` | 角色年龄编年页 | 支持 `?worldview=<name>` |
| `/logs` | 日志工坊页 | 支持 `?worldview=<name>` |
| `/chat` | 聊天室页 | 页面可直接进入，身份验证仍由聊天室自己处理 |
| `/events/:eventId` | 事件详情页 | 支持 `?worldview=<name>`，用于从时间轴直接深链进入 |

### 本轮不做的路由

- 不拆世界观为路径段，例如 `/timeline/<worldviewSlug>`
- 不做日志单记录详情路由
- 不做聊天室房间级路径，例如 `/chat/<roomId>`
- 不做后台管理路由

### 世界观参数规则

- 时间轴、年龄编年、日志页都允许带 `?worldview=<name>`
- 如果 URL 中的 `worldview` 不存在：
  - 回退到当前默认世界观
  - 同时修正地址栏状态
- 当前阶段不引入 slug 生成规则
- 等世界观真正落库并拥有稳定 `id` 后，再把查询参数从 `name` 升级为 `id` 或 `slug`

## 目标目录结构

### 目标目录原则

- `pages` 只放页面级组件
- `features` 按业务模块拆分
- `shared` 放跨页面通用组件、类型、工具和样式
- `App.svelte` 不再承载单个业务页面的大量实现细节

### 目标结构草案

```text
src/
  App.svelte
  main.ts
  app.css

  pages/
    TimelinePage.svelte
    AgeChroniclePage.svelte
    LogWorkbenchPage.svelte
    ChatRoomPage.svelte
    EventDetailPage.svelte

  features/
    timeline/
      components/
      stores/
      utils/
      types.ts
    chronicle/
      components/
      stores/
      utils/
      types.ts
    log/
      components/
      stores/
      utils/
      types.ts
    chat/
      components/
      stores/
      utils/
      types.ts
    worldview/
      components/
      stores/
      utils/
      types.ts

  shared/
    components/
    router/
    content/
    styles/
    utils/
    types/
```

### 当前文件到目标结构的映射

| 当前文件 | 目标位置 |
| --- | --- |
| `src/App.svelte` | 缩减为站点壳层 |
| `src/lib/TimelineAxis.svelte` | `src/features/timeline/components/TimelineAxis.svelte` |
| `src/lib/TimelineEventCard.svelte` | `src/features/timeline/components/TimelineEventCard.svelte` |
| `src/lib/mock-events.ts` | `src/features/timeline/mock-events.ts` |
| `src/lib/timeline.ts` | `src/features/timeline/utils/timeline.ts` |
| `src/lib/AgeChroniclePage.svelte` | `src/pages/AgeChroniclePage.svelte` 或 `src/features/chronicle/pages/` |
| `src/lib/age-chronicle.ts` | `src/features/chronicle/utils/age-chronicle.ts` |
| `src/lib/LogWorkbenchPage.svelte` | `src/pages/LogWorkbenchPage.svelte` 或 `src/features/log/pages/` |
| `src/lib/log-workbench.ts` | `src/features/log/utils/log-workbench.ts` |
| `src/lib/ChatRoomPage.svelte` | `src/pages/ChatRoomPage.svelte` 或 `src/features/chat/pages/` |
| `src/lib/chat-room.ts` | `src/features/chat/utils/chat-room.ts` |
| `src/lib/EventDetailPage.svelte` | `src/pages/EventDetailPage.svelte` |
| `src/lib/WorldviewHero.svelte` | `src/shared/components/WorldviewHero.svelte` |
| `src/content/worldviews.ts` | `src/shared/content/worldviews.ts` 或 `src/features/worldview/content/` |
| `src/lib/worldview-themes.ts` | `src/features/worldview/utils/worldview-themes.ts` |

## 顶层组件职责重定义

### `App.svelte` 迁移后的职责

- 提供站点级布局壳层
- 渲染顶部主导航
- 管理真实路由切换
- 控制全站共用的世界观选择器
- 作为页面出口装载各个页面组件
- 承载全站级过渡动画

### `App.svelte` 迁移后不再负责

- 时间轴页的具体事件编辑逻辑
- 事件卡片渲染细节
- 时间轴滚动和拖拽逻辑
- 聊天室具体交互
- 日志工坊具体编辑流程
- 角色年龄编年具体节点逻辑

## 页面边界定义

### 1. 时间轴页

- 页面组件名：`TimelinePage`
- 职责：
  - 世界观 Hero
  - 时间轴视图与编辑模式
  - 轨道管理
  - 标签筛选
  - 打开事件详情
- 不再把事件详情页当作时间轴内部状态的一部分
- 事件详情改为真实路由 `/events/:eventId`

### 2. 角色年龄编年页

- 页面组件名：`AgeChroniclePage`
- 保持为独立页面
- 世界观来源与时间轴页保持一致
- 使用真实 URL `/chronicle`

### 3. 日志工坊页

- 页面组件名：`LogWorkbenchPage`
- 保持展示 / 编辑 / 播放三视图逻辑不变
- 先不拆更细的子路由
- 使用真实 URL `/logs`

### 4. 聊天室页

- 页面组件名：`ChatRoomPage`
- 使用真实 URL `/chat`
- 身份验证仍通过聊天室自身的访问密钥和 Cookie 进行
- 页面进入不需要额外全站路由守卫

### 5. 事件详情页

- 页面组件名：`EventDetailPage`
- 使用真实 URL `/events/:eventId`
- 保留“返回时间轴”的入口，但返回逻辑基于浏览历史或回跳到 `/timeline`

## 路由层实现约束

### 本轮实现要求

- 必须使用浏览器地址栏真实路径，不使用 hash 路由
- 必须支持前进 / 后退
- 必须支持刷新后恢复当前页面
- 必须支持从事件卡直接进入详情页

### 本轮实现建议

- 本轮优先采用轻量本地路由封装
- 不在本轮强绑定第三方路由库
- 路由层最少应提供：
  - 当前路径解析
  - 参数解析
  - 查询参数读写
  - `push`
  - `replace`
  - `back`

## 数据与状态迁移原则

### 可以继续留在页面内部的状态

- 聊天室输入框草稿
- 日志编辑页当前分页位置
- 各弹层开关状态

### 应该提升或统一管理的状态

- 当前路由状态
- 当前世界观
- 当前页面标题或站点级元信息
- 全站级品牌信息

### 需要避免的状态形态

- 再继续新增新的 `activePage` 分支
- 把 URL 应表达的页面状态继续只留在内存里
- 让 `App.svelte` 再增长更多业务函数

## 服务端与部署约束

### 当前保留方案

- 继续使用当前 `Node.js + WebSocket + SQLite` 聊天服务
- 聊天服务继续通过 `/ws` 和 `/auth/*` 对前端提供能力
- 前端站点仍由 Vite 构建为 SPA 静态资源

### 部署要求

- 生产环境需要把所有前端页面路径都回退到 `index.html`
- 生产环境需要继续反代：
  - `/ws`
  - `/auth/`
  - `/health`

## 分阶段迁移计划

### Phase A：品牌统一

- [已完成] 把站点名称统一为 `Morosonder`
- [已完成] 更新 `package.json` 名称
- [已完成] 更新 `index.html` 标题
- [已完成] 更新 README 顶部标题与简介
- [已完成] 更新站内顶层标题与元信息文案

### Phase B：路由落地

- [已完成] 建立真实客户端路由层
- [已完成] 支持 `/` 首页
- [已完成] 支持 `/timeline`
- [已完成] 支持 `/chronicle`
- [已完成] 支持 `/logs`
- [已完成] 支持 `/chat`
- [已完成] 支持 `/events/:eventId`

### Phase C：页面拆分

- [ ] 把时间轴页从 `App.svelte` 中抽出为独立页面组件
- [ ] 保留年龄页、日志页、聊天页、事件详情页的页面级独立入口
- [ ] 把 `App.svelte` 缩减为站点壳层

### Phase D：目录重组

- [ ] 新增 `src/pages`
- [ ] 新增 `src/features`
- [ ] 新增 `src/shared`
- [ ] 把时间轴、日志、聊天、年龄、世界观的工具和组件迁到对应 feature 目录

### Phase E：路由与状态联动

- [已完成] 页面切换写入 URL
- [已完成] 世界观切换写入查询参数
- [已完成] 刷新页面时能从 URL 恢复页面和世界观
- [已完成] 事件详情可通过 URL 直接打开

## 验收清单

### 路由验收

- [已完成] 访问 `/` 可直接打开首页
- [已完成] 访问 `/timeline` 可直接打开时间轴页
- [已完成] 访问 `/chronicle` 可直接打开角色年龄编年页
- [已完成] 访问 `/logs` 可直接打开日志工坊页
- [已完成] 访问 `/chat` 可直接打开聊天室页
- [已完成] 访问 `/events/:eventId` 可直接打开对应事件详情页
- [已完成] 页面刷新后不会跳回默认页
- [已完成] 浏览器前进 / 后退能正常切换页面

### 结构验收

- [ ] `App.svelte` 不再包含大段时间轴业务实现
- [ ] 时间轴主页面存在独立页面组件
- [ ] `src/pages / src/features / src/shared` 结构已建立
- [ ] 各 feature 的工具代码不再混放在 `src/lib`

### 品牌验收

- [已完成] 页面标题显示为 `Morosonder`
- [已完成] 包名和 README 已同步
- [进行中] 站内不再保留明显的旧 `timeline` 临时命名

## 非目标

- 本轮不迁移到 `SvelteKit`
- 本轮不重写聊天室后端
- 本轮不把所有页面数据源改成数据库
- 本轮不处理复杂权限后台
- 本轮不拆日志子路由和聊天室房间子路由

## 风险与注意事项

- 事件详情从内存页切换到真实路由后，必须处理“直接打开详情页但事件不存在”的兜底
- 世界观当前还没有稳定 ID，若后续世界观结构变化，查询参数策略需要再升级
- 聊天室和日志页都已有较多内部状态，页面拆分时不要顺手改行为逻辑，只先改边界
- 若线上部署仍按静态文件直接托管而没有 SPA fallback，真实路径刷新会 404

## 当前实现备注

- 当前项目已经完成首批 `Morosonder` 迁移：包名、页面标题、README 和站内顶层元信息已同步改名
- 当前页面切换已经由真实 URL 驱动，不再只依赖 `activePage` 伪路由
- 当前已支持的主路径为：
  - `/`
  - `/timeline`
  - `/chronicle`
  - `/logs`
  - `/chat`
  - `/events/:eventId`
- 当前首页已经补上，职责是承接站点说明、测试公告和各模块入口，不再拿时间轴硬充默认首页
- 当前世界观状态会写入查询参数 `?worldview=<name>`，页面刷新后可以恢复
- 当前事件详情页支持通过 URL 直接进入；若事件不存在，会自动回退到时间轴页
- 当前尚未完成的迁移重点是：
  - 把时间轴主页面从 `App.svelte` 中抽出
  - 建立 `src/pages / src/features / src/shared`
  - 把现有 `src/lib` 逐步按业务模块拆分

## 后续若确认继续升级到 `SvelteKit`

- 这必须是下一阶段的单独迁移，不属于本轮
- 前提是本轮已经完成：
  - 真实路由
  - 页面边界清晰
  - `App.svelte` 缩壳
  - feature 目录拆分
- 只有在这些完成后，再评估是否把前端站点整体迁到 `SvelteKit`
