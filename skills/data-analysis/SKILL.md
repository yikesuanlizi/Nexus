---
name: data-analysis
description: 数据分析 Skill — 接收原始数据，执行统计、趋势、对比、异常检测，生成结构化报告。
---

# 数据分析 Skill

## 触发条件

当用户请求以下类型任务时激活本 Skill：
- 分析数据、生成报表
- 统计指标、计算汇总
- 趋势分析、同比环比
- 异常检测、数据质量检查
- 数据可视化建议
- "分析这份销售数据"、"看看这个月的运营情况"、"找出数据中的异常"

## 工作流程

### 第 1 步：理解分析需求

在开始之前，明确以下问题：

1. **数据来源**：数据在哪里？
   - CSV/Excel/JSON 文件路径
   - 数据库查询
   - API 接口返回
   - 用户直接粘贴

2. **分析目的**：用户想了解什么？
   - 描述性统计（汇总、平均、最大最小）
   - 趋势分析（随时间的变化）
   - 对比分析（本期 vs 上期、部门对比）
   - 异常检测（找出离群点）
   - 预测性分析（趋势预测）

3. **分析维度**：按什么维度切分？
   - 时间维度（日/周/月/年）
   - 地域维度（省/市/区）
   - 类别维度（商品类目/部门/渠道）
   - 用户维度（新用户/活跃用户/流失用户）

4. **输出形式**：
   - 控制台输出（快速查看）
   - 保存为文件（CSV/Excel/JSON）
   - 生成报告（Markdown/HTML）
   - 可视化图表（需要 Python matplotlib/seaborn）

### 第 2 步：获取和理解数据

#### 如果数据在文件中：

使用 `shell_command` 执行 Python 脚本读取数据：

```bash
python -c "import pandas as pd; df = pd.read_csv('数据文件路径'); print(df.head(10)); print(df.info()); print(df.describe())"
```

#### 数据质量检查（必须项）：

在分析前，必须检查：
- 缺失值（某列有多少空值）
- 重复行（是否有重复记录）
- 异常值（数值是否合理，如负数销量）
- 数据类型（日期是否真的是日期格式）

### 第 3 步：数据清洗（如果需要）

根据检查结果，进行必要的数据清洗：

```python
import pandas as pd

# 1. 处理缺失值
df.dropna(subset=['关键列'])           # 删除缺失行
df['列'].fillna(df['列'].mean())      # 用均值填充
df['列'].fillna(0)                     # 用0填充

# 2. 删除重复行
df.drop_duplicates(inplace=True)

# 3. 类型转换
df['日期列'] = pd.to_datetime(df['日期列'])
df['金额列'] = pd.to_numeric(df['金额列'], errors='coerce')

# 4. 过滤异常值
df = df[df['销量'] >= 0]              # 排除负数
df = df[df['金额'] < df['金额'].quantile(0.99)]  # 排除极端值
```

### 第 4 步：执行分析

根据分析目的选择合适的分析方法：

#### 4.1 描述性统计

```python
# 基础统计
df.describe()                          # 所有数值列的统计
df['目标列'].value_counts()            # 频次统计
df.groupby('分类列')['数值列'].sum()   # 按类聚合

# 自定义指标
metrics = [
    {'column': '销售额', 'aggregation': 'sum', 'label': '总销售额'},
    {'column': '订单数', 'aggregation': 'count', 'label': '订单总量'},
    {'column': '客单价', 'aggregation': 'mean', 'label': '平均客单价'},
]
```

#### 4.2 趋势分析

```python
import numpy as np

# 确保按时间排序
df = df.sort_values('日期')

# 线性趋势（斜率）
x = np.arange(len(df))
slope, intercept = np.polyfit(x, df['指标'].values, 1)

# 移动平均
df['MA7'] = df['指标'].rolling(window=7).mean()
df['MA30'] = df['指标'].rolling(window=30).mean()

# 增长率
growth_rate = (df['指标'].iloc[-1] - df['指标'].iloc[0]) / df['指标'].iloc[0] * 100
```

#### 4.3 对比分析（同比/环比）

```python
# 按月汇总
df['月份'] = df['日期'].dt.to_period('M')
monthly = df.groupby('月份')['销售额'].sum()

# 环比（vs 上月）
monthly['环比增长'] = monthly.pct_change() * 100

# 同比（vs 去年同期）
monthly['同比增长率'] = monthly.pct_change(periods=12) * 100
```

#### 4.4 异常检测

```python
import numpy as np

# Z-Score 方法
mean = df['指标'].mean()
std = df['指标'].std()
df['z_score'] = (df['指标'] - mean) / std
anomalies = df[abs(df['z_score']) > 2]  # |Z| > 2 视为异常

# IQR 方法
Q1 = df['指标'].quantile(0.25)
Q3 = df['指标'].quantile(0.75)
IQR = Q3 - Q1
lower = Q1 - 1.5 * IQR
upper = Q3 + 1.5 * IQR
anomalies = df[(df['指标'] < lower) | (df['指标'] > upper)]
```

### 第 5 步：生成报告

#### 5.1 快速查看（控制台）

```python
print("=" * 60)
print("数据分析报告")
print("=" * 60)
print(f"\n数据概览：共 {len(df)} 条记录，{len(df.columns)} 个字段")
print(f"时间范围：{df['日期'].min()} 至 {df['日期'].max()}")
print("\n核心指标：")
for m in results:
    print(f"  - {m['label']}: {m['value']:,.2f}")
print("\n关键发现：")
print("  1. 销售额环比增长 12.5%")
print("  2. 华东地区贡献最大，占比 45%")
print("  3. 周六日销量明显高于工作日")
```

#### 5.2 结构化输出（JSON）

```json
{
  "analysis_type": "full",
  "data_profile": {
    "row_count": 1000,
    "columns": ["日期", "销售额", "订单数", "地区"],
    "time_range": "2024-01-01 至 2024-06-30"
  },
  "summary": [
    {"label": "总销售额", "value": 1234567.89, "unit": "元"},
    {"label": "总订单数", "value": 5000, "unit": "笔"}
  ],
  "trend": [
    {"column": "销售额", "direction": "up", "growth_rate": 12.5}
  ],
  "anomalies": [
    {"date": "2024-03-15", "value": 99999, "expected": 5000, "severity": "high"}
  ],
  "insights": [
    "华东地区表现最佳，建议加大投入",
    "周末销量是工作日的1.5倍，可考虑周末促销活动"
  ]
}
```

#### 5.3 保存结果

```python
# 保存为 CSV
results_df.to_csv('分析结果.csv', index=False, encoding='utf-8-sig')

# 保存为 Excel（多 Sheet）
with pd.ExcelWriter('分析报告.xlsx') as writer:
    summary_df.to_excel(writer, sheet_name='汇总', index=False)
    trend_df.to_excel(writer, sheet_name='趋势', index=False)
    anomalies_df.to_excel(writer, sheet_name='异常', index=False)

# 保存为 Markdown 报告
with open('分析报告.md', 'w', encoding='utf-8') as f:
    f.write("# 数据分析报告\n\n")
    f.write(f"生成时间：{datetime.now()}\n\n")
    f.write("## 核心发现\n\n")
    for insight in insights:
        f.write(f"- {insight}\n")
```

### 第 6 步：可视化建议（可选）

如果需要生成图表，在用户确认后执行：

```python
import matplotlib.pyplot as plt

# 设置中文字体
plt.rcParams['font.sans-serif'] = ['SimHei', 'Microsoft YaHei']
plt.rcParams['axes.unicode_minus'] = False

fig, axes = plt.subplots(2, 2, figsize=(14, 10))

# 1. 时序图
axes[0, 0].plot(df['日期'], df['销售额'])
axes[0, 0].set_title('销售额趋势')

# 2. 柱状图（按类目）
category_sales.plot(kind='bar', ax=axes[0, 1])
axes[0, 1].set_title('各类目销售额')

# 3. 饼图（占比）
region_share.plot(kind='pie', ax=axes[1, 0], autopct='%1.1f%%')
axes[1, 0].set_title('地区占比')

# 4. 散点图（相关性）
axes[1, 1].scatter(df['流量'], df['销售额'])
axes[1, 1].set_title('流量 vs 销售额')

plt.tight_layout()
plt.savefig('图表.png', dpi=150)
print("图表已保存为 图表.png")
```

## 工具调用指南

| 任务 | 工具 | 示例 |
|------|------|------|
| 读数据文件 | `read_file` | 读 CSV/Excel/JSON 前先看看结构 |
| 执行分析脚本 | `shell_command` | 调用 Python 执行数据分析 |
| 写结果文件 | `write_file` | 保存分析报告或导出数据 |
| 读目录 | `list_files` | 看看数据文件在哪里 |
| 搜索内容 | `search_content` | 在大文件中找特定数据 |

## shell_command 注意事项

1. **指定 Python 环境**：如果系统有多个 Python 版本，明确使用 `python3` 或 `python -m`
2. **处理编码**：Windows 中文环境使用 `chcp 65001` 或 `-X utf8`
3. **错误处理**：分析脚本要有 try-except，避免出错后中断
4. **路径处理**：相对路径基于 workspace 根目录

```bash
# 推荐写法
python -c "
import pandas as pd
import sys
try:
    df = pd.read_csv('data/sales.csv', encoding='utf-8-sig')
    print('数据加载成功，共', len(df), '条')
    print(df.describe())
except Exception as e:
    print('错误:', e, file=sys.stderr)
    sys.exit(1)
"
```

## 常见分析模板

### 模板 1：日销售汇总

- **输入**：日销售数据 CSV（日期, 商品, 数量, 单价, 地区）
- **输出**：各地区销售汇总 + 趋势图

### 模板 2：用户行为分析

- **输入**：用户行为日志（时间, 用户ID, 行为类型, 页面, 时长）
- **输出**：用户路径漏斗 + 活跃度分布

### 模板 3：异常订单检测

- **输入**：订单数据（订单号, 时间, 金额, 用户ID, 收货地址）
- **输出**：异常订单列表（金额过大/过小/地址异常）

### 模板 4：竞品数据对比

- **输入**：多份 CSV（各平台销售数据）
- **输出**：各平台对比表 + 可视化

## 边界情况处理

| 情况 | 处理方式 |
|------|----------|
| 数据为空 | 明确告知用户，建议补充数据 |
| 数据量太大（>100MB） | 先采样分析，建议分批处理 |
| 字段不明确 | 先打印列名和样例，让用户确认 |
| 日期格式混乱 | 尝试多种格式解析，列出无法解析的行 |
| 数值字段有文本 | 转为数值或过滤，说明丢失了多少条 |
| 权限不足 | 告知用户需要什么权限 |
| Python 未安装 | 尝试其他方式（Excel 公式、SQL） |

## 质量检查清单

完成分析后，自检以下各项：

- [ ] 数据源已明确，用户确认
- [ ] 数据量级合理，无明显错误
- [ ] 缺失值和异常值已处理或说明
- [ ] 分析方法适合分析目的
- [ ] 结果有业务含义，不是纯数字
- [ ] 关键发现用普通人能懂的话描述
- [ ] 输出格式符合用户需求
- [ ] 结果文件已保存到用户可访问位置
