#!/usr/bin/env bash
# 生成三城模拟气温 raw_data CSV: city,date,time,temperature_c
set -euo pipefail
OUT="/Users/yipengfei/Desktop/pi Agent V2/data/raw_data.csv"
START="2026-07-01"; DAYS=30
TIMES=(08:00 12:00 18:00 22:00)

: > "$OUT"
echo "city,date,time,temperature_c" >> "$OUT"
# 城市 7月日均基线(°C) 日较差(°C): 北京30/10 上海33/8 广州35/6
while read -r city base amp; do
  for d in $(seq 0 $((DAYS-1))); do
    date=$(date -d "$START +${d} days" "+%Y-%m-%d" 2>/dev/null \
           || date -j -v+${d}d -f "%Y-%m-%d" "$START" "+%Y-%m-%d")
    daydrift=$((RANDOM % 5 - 2))           # 逐日天气波动 ±2
    for t in "${TIMES[@]}"; do
      h=${t%%:*}
      # 日循环: 14时最高 → cos((h-14)/12·π), 凌晨为负偏移
      diurnal=$(awk -v h="$h" 'BEGIN{printf "%.1f", cos(3.14159*(h-14)/12)}')
      temp=$(awk -v b="$base" -v a="$amp" -v dr="$daydrift" -v du="$diurnal" \
             -v r="$RANDOM" 'BEGIN{printf "%.1f", b + a*du + dr + (r%10)/5 - 1}')
      echo "$city,$date,$t,$temp" >> "$OUT"
    done
  done
done <<'CITIES'
beijing 30 10
shanghai 33 8
guangzhou 35 6
CITIES
# 自检: 行数 = 1表头 + 3城×30天×4采样, 温度范围合理
rows=$(wc -l < "$OUT")
[ "$rows" -eq $((1 + 3*DAYS*${#TIMES[@]})) ] || { echo "FAIL row count: $rows"; exit 1; }
awk -F, 'NR>1{ if($4<-10||$4>50) exit 1 }' "$OUT" || { echo "FAIL temp range"; exit 1; }
echo "OK raw_data.csv: $rows rows ($((rows-1)) samples)"
