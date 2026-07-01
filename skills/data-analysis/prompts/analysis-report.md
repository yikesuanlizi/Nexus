# 数据分析报告

**生成时间**：{{generated_at}}

**数据源**：{{data_source}}

**分析周期**：{{start_date}} 至 {{end_date}}

---

## 数据概览

| 指标 | 值 |
|------|-----|
| 数据记录数 | {{row_count}} |
| 数据字段数 | {{column_count}} |
| 数值型字段 | {{numeric_columns}} |
| 缺失值字段 | {{missing_fields}} |
| 重复记录数 | {{duplicate_rows}} |

---

## 核心指标

{{#each summary}}
- **{{label}}**：{{value}}{{#if unit}} {{unit}}{{/if}}
{{/each}}

---

## 趋势分析

### 整体趋势

{{#each trend}}
**{{column}}**：
- 趋势方向：{{trend_direction}}
- 斜率：{{slope}}
- 总体增长率：{{total_growth_pct}}%
- 近期趋势：{{recent_trend}}
{{/each}}

### 移动平均

| 周期 | 数值列 1 | 数值列 2 |
|------|----------|----------|
{{#each moving_averages}}
| {{period}} | {{value1}} | {{value2}} |
{{/each}}

---

## 对比分析

### 周期对比

| 指标 | 当前周期 | 上期周期 | 变化率 | 趋势 |
|------|----------|----------|--------|------|
{{#each comparison}}
| {{column}} | {{current_value}} | {{previous_value}} | {{change_pct}}% | {{direction}} |
{{/each}}

---

## 异常检测

{{#if anomalies}}
发现 **{{anomalies.length}}** 个异常数据点：

| 字段 | 异常值 | 期望值 | Z-Score | 严重程度 |
|------|--------|--------|---------|----------|
{{#each anomalies}}
| {{column}} | {{value}} | {{expected}} | {{z_score}} | {{severity}} |
{{/each}}

### 异常详情

{{#each anomaly_details}}
**{{column}} 第 {{row_index}} 行**：
- 实际值：{{value}}
- 期望值：{{expected}}
- 偏差：{{deviation}}
- 原因分析：{{analysis}}
{{/each}}
{{else}}
未检测到显著异常数据点。
{{/if}}

---

## 关键发现

{{#each insights}}
{{add @index 1}}. {{this}}
{{/each}}

---

## 建议行动

{{#each recommendations}}
### {{title}}
{{description}}

**优先级**：{{priority}}
**预计影响**：{{impact}}
{{/each}}

---

## 附录

### 数据质量说明

{{data_quality_notes}}

### 分析方法

{{analysis_methods}}

### 限制与假设

{{limitations}}
