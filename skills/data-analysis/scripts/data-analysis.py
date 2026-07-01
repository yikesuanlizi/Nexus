#!/usr/bin/env python3
"""
数据分析脚本 - Nexus Skill 配套工具
提供常用的数据分析功能封装

使用方法:
    python scripts/data-analysis.py --input data.csv --type summary
    python scripts/data-analysis.py --input data.csv --type trend --date-col date --value-col sales
    python scripts/data-analysis.py --input data.csv --type anomaly
    python scripts/data-analysis.py --input data.csv --type full --output report.json
"""

import argparse
import json
import sys
from datetime import datetime
from typing import Any, Optional

import numpy as np
import pandas as pd


def load_data(file_path: str, encoding: str = 'utf-8-sig') -> pd.DataFrame:
    """加载数据文件"""
    if file_path.endswith('.csv'):
        return pd.read_csv(file_path, encoding=encoding)
    elif file_path.endswith('.xlsx') or file_path.endswith('.xls'):
        return pd.read_excel(file_path)
    elif file_path.endswith('.json'):
        return pd.read_json(file_path)
    else:
        raise ValueError(f"不支持的文件格式: {file_path}")


def profile_data(df: pd.DataFrame) -> dict[str, Any]:
    """生成数据画像"""
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    
    profile = {
        'row_count': len(df),
        'column_count': len(df.columns),
        'columns': df.columns.tolist(),
        'numeric_columns': numeric_cols,
        'missing_values': {},
        'duplicate_rows': int(df.duplicated().sum()),
    }
    
    for col in df.columns:
        missing = int(df[col].isna().sum())
        if missing > 0:
            profile['missing_values'][col] = {
                'count': missing,
                'percentage': round(missing / len(df) * 100, 2)
            }
    
    return profile


def compute_summary(df: pd.DataFrame, metrics: list[dict]) -> list[dict]:
    """计算描述性统计"""
    results = []
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    
    for metric in metrics:
        column = metric.get('column')
        agg_type = metric.get('aggregation', 'sum')
        label = metric.get('label', column)
        
        if column and column in numeric_cols:
            if agg_type == 'sum':
                value = float(df[column].sum())
            elif agg_type in ('avg', 'mean'):
                value = float(df[column].mean())
            elif agg_type == 'count':
                value = int(df[column].count())
            elif agg_type == 'max':
                value = float(df[column].max())
            elif agg_type == 'min':
                value = float(df[column].min())
            elif agg_type == 'median':
                value = float(df[column].median())
            elif agg_type == 'std':
                value = float(df[column].std())
            else:
                value = float(df[column].sum())
            
            results.append({
                'column': column,
                'label': label,
                'aggregation': agg_type,
                'value': round(value, 4) if isinstance(value, float) else value,
            })
    
    # 如果没有指定指标，返回所有数值列的默认统计
    if not metrics and len(numeric_cols) > 0:
        for col in numeric_cols[:10]:
            results.append({
                'column': col,
                'label': f'{col}_sum',
                'aggregation': 'sum',
                'value': round(float(df[col].sum()), 4),
            })
            results.append({
                'column': col,
                'label': f'{col}_avg',
                'aggregation': 'avg',
                'value': round(float(df[col].mean()), 4),
            })
    
    return results


def find_date_column(df: pd.DataFrame) -> Optional[str]:
    """自动检测日期列"""
    date_keywords = ['date', 'day', 'month', 'year', 'timestamp', 'datetime', 'time', '时间', '日期']
    
    for col in df.columns:
        if col.lower() in date_keywords:
            return col
    
    for col in df.columns:
        try:
            pd.to_datetime(df[col])
            return col
        except (ValueError, TypeError):
            continue
    
    return None


def compute_trend(df: pd.DataFrame, date_col: str, value_col: str) -> list[dict]:
    """计算趋势分析"""
    if date_col:
        df = df.copy()
        df[date_col] = pd.to_datetime(df[date_col], errors='coerce')
        df = df.dropna(subset=[date_col])
        df = df.sort_values(date_col)
    
    values = df[value_col].values.astype(float)
    
    if len(values) < 2:
        return [{'column': value_col, 'error': '数据点不足'}]
    
    # 线性趋势
    x = np.arange(len(values))
    slope, intercept = np.polyfit(x, values, 1)
    
    # 移动平均
    ma_3 = pd.Series(values).rolling(window=min(3, len(values))).mean().tolist()
    ma_7 = pd.Series(values).rolling(window=min(7, len(values))).mean().tolist()
    
    # 增长率
    if values[0] != 0:
        total_growth = ((values[-1] - values[0]) / values[0]) * 100
    else:
        total_growth = 0.0
    
    # 最近趋势
    recent_trend = 'stable'
    if len(values) >= 3:
        recent = values[-3:]
        if recent[2] > recent[0]:
            recent_trend = 'increasing'
        elif recent[2] < recent[0]:
            recent_trend = 'decreasing'
    
    return [{
        'column': value_col,
        'trend_direction': 'up' if slope > 0 else ('down' if slope < 0 else 'flat'),
        'slope': round(float(slope), 4),
        'total_growth_pct': round(float(total_growth), 2),
        'min': round(float(np.min(values)), 4),
        'max': round(float(np.max(values)), 4),
        'mean': round(float(np.mean(values)), 4),
        'recent_trend': recent_trend,
        'moving_averages': {
            'ma_3': [round(float(v), 4) if not np.isnan(v) else None for v in ma_3],
            'ma_7': [round(float(v), 4) if not np.isnan(v) else None for v in ma_7],
        }
    }]


def compute_comparison(df: pd.DataFrame, date_col: str, value_col: str, period: str = 'monthly') -> list[dict]:
    """计算对比分析（同比/环比）"""
    if not date_col:
        return compute_summary(df, [{'column': value_col}])
    
    df = df.copy()
    df[date_col] = pd.to_datetime(df[date_col], errors='coerce')
    df = df.dropna(subset=[date_col])
    
    if period == 'daily':
        df['period'] = df[date_col].dt.date
    elif period == 'weekly':
        df['period'] = df[date_col].dt.isocalendar().week.astype(str)
    elif period == 'monthly':
        df['period'] = df[date_col].dt.to_period('M').astype(str)
    elif period == 'quarterly':
        df['period'] = df[date_col].dt.to_period('Q').astype(str)
    else:
        df['period'] = df[date_col].dt.to_period('M').astype(str)
    
    grouped = df.groupby('period')[value_col].sum()
    
    results = []
    if len(grouped) >= 2:
        current = float(grouped.iloc[-1])
        previous = float(grouped.iloc[-2])
        
        if previous != 0:
            change_pct = ((current - previous) / previous) * 100
        else:
            change_pct = 0.0
        
        results.append({
            'column': value_col,
            'current_period': str(grouped.index[-1]),
            'previous_period': str(grouped.index[-2]),
            'current_value': round(current, 4),
            'previous_value': round(previous, 4),
            'change_pct': round(float(change_pct), 2),
            'direction': 'up' if change_pct > 0 else ('down' if change_pct < 0 else 'flat'),
            'period_type': period,
        })
    
    return results


def detect_anomalies(df: pd.DataFrame, value_col: str, threshold: float = 2.0) -> list[dict]:
    """异常检测（Z-Score 方法）"""
    values = df[value_col].values.astype(float)
    
    if len(values) < 3:
        return [{'column': value_col, 'error': '数据点不足，需要至少3个数据点'}]
    
    mean = np.mean(values)
    std = np.std(values)
    
    if std == 0:
        return [{'column': value_col, 'error': '标准差为0，无法进行异常检测'}]
    
    z_scores = np.abs((values - mean) / std)
    anomaly_indices = np.where(z_scores > threshold)[0]
    
    results = []
    for idx in anomaly_indices:
        severity = 'high' if z_scores[idx] > 3 * threshold else 'medium'
        results.append({
            'column': value_col,
            'row_index': int(idx),
            'value': round(float(values[idx]), 4),
            'expected': round(float(mean), 4),
            'z_score': round(float(z_scores[idx]), 4),
            'severity': severity,
        })
    
    # 按 z_score 降序排列
    results.sort(key=lambda x: x['z_score'], reverse=True)
    return results


def run_full_analysis(df: pd.DataFrame, date_col: Optional[str], value_cols: list[str]) -> dict[str, Any]:
    """执行完整分析"""
    results = {
        'profile': profile_data(df),
        'summary': [],
        'trend': [],
        'comparison': [],
        'anomalies': [],
        'generated_at': datetime.now().isoformat(),
    }
    
    # 自动选择数值列
    if not value_cols:
        value_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    
    for col in value_cols[:5]:  # 限制最多分析5列
        try:
            # Summary
            results['summary'].extend(compute_summary(df, [{'column': col}]))
            
            # Trend
            if date_col:
                results['trend'].extend(compute_trend(df, date_col, col))
            
            # Anomaly
            results['anomalies'].extend(detect_anomalies(df, col))
            
        except Exception as e:
            results['summary'].append({'column': col, 'error': str(e)})
    
    return results


def main():
    parser = argparse.ArgumentParser(description='Nexus 数据分析工具')
    parser.add_argument('--input', '-i', required=True, help='输入数据文件路径')
    parser.add_argument('--type', '-t', choices=['summary', 'trend', 'comparison', 'anomaly', 'full'],
                        default='summary', help='分析类型')
    parser.add_argument('--date-col', '-d', help='日期列名')
    parser.add_argument('--value-col', '-v', help='数值列名')
    parser.add_argument('--output', '-o', help='输出文件路径（JSON）')
    parser.add_argument('--encoding', '-e', default='utf-8-sig', help='文件编码')
    parser.add_argument('--period', '-p', choices=['daily', 'weekly', 'monthly', 'quarterly'],
                        default='monthly', help='对比周期')
    parser.add_argument('--threshold', default=2.0, type=float, help='异常检测阈值（Z-Score）')
    
    args = parser.parse_args()
    
    try:
        df = load_data(args.input, args.encoding)
        print(f"数据加载成功：{len(df)} 行 x {len(df.columns)} 列", file=sys.stderr)
        
        # 自动检测日期列
        date_col = args.date_col or find_date_column(df)
        if date_col:
            print(f"检测到日期列：{date_col}", file=sys.stderr)
        
        result = {}
        
        if args.type == 'summary':
            result = {
                'profile': profile_data(df),
                'summary': compute_summary(df, [{'column': args.value_col}] if args.value_col else []),
            }
        elif args.type == 'trend':
            if not args.value_col:
                numeric_cols = df.select_dtypes(include=[np.number]).columns
                args.value_col = numeric_cols[0] if len(numeric_cols) > 0 else None
            
            if args.value_col:
                result = {'trend': compute_trend(df, date_col, args.value_col)}
        elif args.type == 'comparison':
            if not args.value_col:
                numeric_cols = df.select_dtypes(include=[np.number]).columns
                args.value_col = numeric_cols[0] if len(numeric_cols) > 0 else None
            
            if args.value_col:
                result = {'comparison': compute_comparison(df, date_col, args.value_col, args.period)}
        elif args.type == 'anomaly':
            if not args.value_col:
                numeric_cols = df.select_dtypes(include=[np.number]).columns
                args.value_col = numeric_cols[0] if len(numeric_cols) > 0 else None
            
            if args.value_col:
                result = {'anomalies': detect_anomalies(df, args.value_col, args.threshold)}
        elif args.type == 'full':
            value_cols = [args.value_col] if args.value_col else []
            result = run_full_analysis(df, date_col, value_cols)
        
        # 输出结果
        output = json.dumps(result, ensure_ascii=False, indent=2)
        
        if args.output:
            with open(args.output, 'w', encoding='utf-8') as f:
                f.write(output)
            print(f"结果已保存到：{args.output}", file=sys.stderr)
        else:
            print(output)
        
    except Exception as e:
        print(f"错误：{str(e)}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
