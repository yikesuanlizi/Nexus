# GitNexus Graph 2.0 设计：代码知识地图

日期：2026-07-28  
状态：设计稿，等待实现计划  
范围：`apps/web` 与 `apps/desktop` 的 GitNexus 图谱展示、交互和数据模型收口

## 背景

当前 GitNexus 图谱更像“依赖层点阵”：按上游文件、依赖层、底层依赖分列，把大量小点和浅色边一次性铺在画布上。这个表现适合确认依赖层级数量，但不适合作为知识图谱使用。

用户期望的效果更接近 Obsidian / 地图式知识图谱：先看到可理解的整体区域，再像地图一样通过缩放和鼠标悬浮逐步显影细节。GitNexus 不需要依赖 wiki link，它的图谱关系来自代码分析、依赖链、调用链、测试覆盖、风险发现和最近活动。

## 目标

GitNexus Graph 2.0 要从“依赖点阵”升级为“代码知识地图”：

1. 总览时能看懂架构区域，而不是只看到密集小点。
2. 鼠标悬浮到某个区域时，局部节点和关系自然显影。
3. 滚轮缩放像地图一样改变信息颗粒度。
4. 点击用于固定观察对象，而不是作为唯一展开入口。
5. 图谱能表达 GitNexus 分析结果：核心模块、入口、风险、热点、测试覆盖、最近读写和依赖关系。
6. web 与 desktop 视觉和交互保持一致。

## 非目标

1. 不做 wiki link 解析。
2. 不把全部文件、符号、边默认一次性画出来。
3. 不引入需要后端长时间常驻索引服务的复杂图数据库。
4. 不在第一版实现跨仓库全量知识图谱。
5. 不把点击节点设计成“展开详情小节点”的唯一方式。

## 交互模型

核心交互是：

```text
semantic zoom + hover lens + click pin
```

含义：

- `semantic zoom`：缩放决定显示颗粒度。
- `hover lens`：鼠标所在区域自动显影局部细节。
- `click pin`：点击只负责固定当前观察对象和详情面板。

### 语义缩放

图谱按缩放等级展示不同粒度：

| 缩放等级 | 展示内容 | 标签策略 | 边策略 |
| --- | --- | --- | --- |
| L0 总览 | 架构域 / 模块 cluster | 只显示模块名和数量 | 只显示模块间主干边 |
| L1 模块 | 关键目录、入口文件、热点文件 | 显示高权重节点标签 | 显示模块内主关系 |
| L2 文件 | 文件节点、测试节点、文档节点、风险节点 | 显示 hover 区域标签 | 显示邻域边 |
| L3 符号 | class/function/interface/API handler | 显示局部符号名 | 只显示局部调用边 |

缩放不是简单放大像素，而是改变数据颗粒度。比如 L0 中 `packages/runtime` 是一个 cluster；放大到 L2 后才拆成 `agent.ts`、`runProfile.ts` 等文件节点；继续放大才出现关键函数或类。

### Hover lens

鼠标悬浮不需要点击，也不弹出阻塞层。它像地图上的局部放大镜：

1. 鼠标附近的 cluster / 节点自动提高亮度。
2. 邻居节点和关联边显影。
3. 非相关区域降低透明度，但保留空间感。
4. 标签在 hover 半径内渐进显示。
5. 鼠标离开后恢复当前缩放层级的默认密度。

hover lens 必须足够轻，不产生布局重排。它只改变渲染透明度、标签可见性和边高亮。

### Click pin

点击用于固定当前观察点：

1. 单击节点或 cluster：锁定当前 hover lens。
2. 右侧 Inspector 显示详情。
3. 再点空白：取消锁定，恢复鼠标跟随。
4. 双击节点：打开文件或进入更深一级聚焦视图。

点击不负责“展开周围小节点”。周围节点是否显示由 zoom level 和 hover lens 决定。

## 数据模型

新增统一图谱模型，替代只服务当前分层图的轻量节点边结构。

```ts
type GitNexusGraphNodeType =
  | 'cluster'
  | 'directory'
  | 'file'
  | 'symbol'
  | 'test'
  | 'document'
  | 'finding';

interface GitNexusGraphNode {
  id: string;
  type: GitNexusGraphNodeType;
  label: string;
  path?: string;
  parentId?: string;
  clusterId?: string;
  kind?: string;
  weight: number;
  risk?: 'none' | 'low' | 'medium' | 'high';
  metrics?: {
    inDegree?: number;
    outDegree?: number;
    changedCount?: number;
    readCount?: number;
    testCount?: number;
  };
  findings?: Array<{
    id: string;
    severity: 'info' | 'warning' | 'error';
    title: string;
    summary?: string;
  }>;
}

type GitNexusGraphEdgeType =
  | 'imports'
  | 'calls'
  | 'tests'
  | 'mentions'
  | 'changed-with'
  | 'generated-from'
  | 'risk'
  | 'runtime-read'
  | 'runtime-write';

interface GitNexusGraphEdge {
  id: string;
  source: string;
  target: string;
  type: GitNexusGraphEdgeType;
  weight: number;
  evidence?: string;
}
```

数据来源按优先级合并：

1. GitNexus 分析输出：模块、文件、依赖、发现项。
2. 源码依赖：import / require / package relation。
3. 运行时文件生命周期：最近读取、修改、生成、派生产物血缘。
4. 测试关系：测试文件与目标源码的命名/路径匹配。
5. 文档关系：计划、spec、README 对模块和文件的引用。

第一版可以先消费现有 GitNexus graph 数据，再在前端派生 cluster、权重、LOD 和 hover 邻域。后续再把更多关系下沉到 API。

## 布局策略

当前 DAG 分层布局保留为“依赖链视图”的备选，不再作为默认图谱。

默认图谱采用稳定的地图式布局：

1. cluster 以架构域为单位分区：`apps/web`、`apps/api`、`packages/runtime`、`packages/model-gateway`、`packages/protocol`、`packages/storage`、`tests`、`docs`。
2. cluster 使用力导向或 packed layout，保持相对位置稳定。
3. 文件节点围绕所属 cluster 排布。
4. 高权重节点靠近 cluster 中心。
5. 风险节点、入口节点、最近活动节点提高可见性。
6. 布局结果按 graph hash 缓存，避免每次打开图谱位置跳动。

推荐第一版布局实现：

- 1000 节点以内：SVG + d3-force / 自研稳定 force layout。
- 超过 1000 节点：默认折叠为 cluster，只渲染高权重文件；不直接渲染全量文件边。
- 如果后续需要 5000+ 节点交互，再迁移 canvas/WebGL。

## 视觉方向

Graph 2.0 的视觉风格是“暗色代码星图”，而不是浅色表格图。

### 画布

- 深色背景，带轻微网格或星尘纹理。
- cluster 使用半透明雾状边界，形成“区域”而不是硬框。
- 当前 hover 区域有柔和光晕。

### 节点

节点形态按类型区分：

| 类型 | 视觉 |
| --- | --- |
| cluster | 大型半透明领域光晕 + 标签 |
| directory | 中等圆形或胶囊 |
| file | 小圆点 |
| symbol | 更小亮点 |
| test | 绿色节点或环 |
| document | 蓝紫节点 |
| finding | 三角 / 菱形警示节点 |

颜色按语义控制，不做五颜六色随机彩虹：

- 核心/入口：蓝色
- runtime/执行链：青色
- 测试：绿色
- 文档/计划：紫蓝
- 风险/警告：琥珀
- 错误/断裂：红色
- 普通文件：低饱和灰蓝

### 边

- 默认边极淡，只保留空间关联。
- hover 邻域边提高亮度。
- 不同关系用线型区分：依赖实线、调用细线、测试虚线、风险红/琥珀线、运行时读写流光线。
- 避免全量边同时显示造成灰雾。

## 信息面板

右侧 Inspector 只在 hover 或 pin 时显示有效内容。

内容结构：

1. 标题：节点名、类型、路径。
2. 摘要：GitNexus 生成的 1-3 句解释。
3. 指标：入边、出边、最近读写、测试数量、风险等级。
4. 关系：
   - 依赖它的模块/文件
   - 它依赖的模块/文件
   - 相关测试
   - 相关 findings
5. 操作：
   - 打开文件
   - 复制路径
   - 加入上下文
   - 查看依赖链
   - 在文件栏定位

Inspector 不应遮挡画布核心区域。窄屏或右侧栏内展示时可折叠为底部 sheet。

## 搜索与过滤

第一版必须提供：

1. 搜索节点：按文件名、路径、模块名、finding 标题。
2. 类型过滤：文件、目录、测试、文档、finding。
3. 关系过滤：imports、calls、tests、runtime-read、runtime-write、risk。
4. 风险过滤：只看高风险/警告。
5. 最近活动过滤：只看最近读写/修改/生成过的节点。

搜索结果应自动飞行定位并临时 pin。

## 性能边界

第一版性能目标：

1. 300 节点以内交互流畅。
2. 1000 节点以内通过 LOD 折叠保持流畅。
3. 大于 1000 节点默认只显示 cluster + top weighted files。
4. hover lens 只改变样式，不重新计算布局。
5. zoom 触发的 LOD 切换需要节流。
6. 图谱弹窗关闭后释放动画帧和事件监听。

## web / desktop 同步

当前项目有 web 与 desktop 双份组件。Graph 2.0 实现必须避免继续复制复杂逻辑。

推荐边界：

1. 共享纯逻辑：
   - `buildGitNexusKnowledgeGraph`
   - `computeGitNexusGraphLod`
   - `computeHoverLens`
   - `computePinnedInspector`
   - `layoutGitNexusMap`
2. web/desktop 各自保留很薄的 shell 组件。
3. CSS 变量走同一套语义 token。
4. 测试覆盖共享逻辑，web/desktop 只补关键 smoke test。

如果短期内仍保留双份组件，必须先在 web 完成，再机械同步到 desktop，不能让两个端的行为继续漂移。

## 错误和空状态

1. 没有 graph 数据：展示“暂无 GitNexus 图谱数据”，提供重新分析入口。
2. graph 数据过大：展示 cluster 视图，并提示已折叠低权重节点。
3. 节点路径不存在：节点保留，但标记为“文件不可用”，Inspector 显示原始证据来源。
4. 分析结果缺少边：仍显示孤立节点 cluster，不丢弃节点。
5. 布局失败：回退到分组列表，不显示空白画布。

## 测试策略

单元测试：

1. GitNexus 原始 graph 能转换成知识图谱节点和边。
2. LOD 在不同 zoom 下返回正确节点集合。
3. hover lens 只显影邻域，不改变布局坐标。
4. click pin 后 Inspector 使用固定节点，不再跟随 hover。
5. 搜索定位能找到路径、文件名和 finding。
6. 超过阈值时低权重节点被折叠。

组件测试：

1. 初始渲染显示 cluster 总览。
2. hover 节点显示标签和邻域边。
3. 点击节点固定详情。
4. 点击空白取消 pin。
5. zoom 后标签和节点数量变化。

视觉验收：

1. 不再出现三列点阵主视图。
2. 默认画面能一眼看出架构区域。
3. 悬浮区域能明显显影。
4. 缩放时节点不是简单变大，而是信息层级变化。
5. 深色/浅色主题均可读，深色优先打磨。

## 分阶段实现建议

### Phase 1：图谱数据和 LOD

- 新增 GitNexus 知识图谱模型。
- 从现有 graph 数据派生 cluster、权重和节点类型。
- 实现 zoom level 到节点集合的纯函数。
- 补单元测试。

### Phase 2：地图式画布

- 替换默认 ForceGraph 视觉为 cluster map。
- 实现稳定布局和 LOD 渲染。
- 保留旧 DAG 分层视图作为“依赖链”切换项。

### Phase 3：hover lens 与 click pin

- 实现鼠标局部显影。
- 实现点击固定和空白取消。
- 接入右侧 Inspector。

### Phase 4：搜索、过滤和联动

- 增加搜索和过滤。
- 支持从文件栏、涉及文件、GitNexus finding 跳转到图谱节点。
- 支持打开文件、复制路径、加入上下文。

### Phase 5：视觉和性能收口

- 优化深色画布、cluster 光晕、边显影、标签层级。
- 大图节流与折叠。
- web/desktop 同步验证。

## 验收标准

1. 默认视图不再像依赖点阵，而是架构地图。
2. 不点击任何节点，只移动鼠标并缩放，就能看到对应区域的小节点和标签。
3. 点击节点只固定观察点和详情，不是唯一展开方式。
4. 用户能从图谱判断“项目核心在哪里、风险在哪里、依赖怎么流动”。
5. GitNexus 分析结果能作为图谱节点和视觉权重参与展示。
6. web 与 desktop 表现一致。
