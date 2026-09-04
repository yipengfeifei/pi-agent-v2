#!/bin/bash
# Standardize node: validate raw_data.csv, aggregate to per-city daily means + city summary.
# Usage: ./standardize.sh   (reads ../data layout relative to script dir)
set -euo pipefail
cd "$(dirname "$0")"
OUT="clean_data"
mkdir -p "$OUT"
export LC_ALL=C

awk -F, -v OFS=, '
NR==1 { next }
{
  city=$1; date=$2; t=$3=="" ? "" : $3; temp=$4+0
  if ($3 !~ /^(08:00|12:00|18:00|22:00)$/) bad["time"]++
  if ($4 !~ /^-?[0-9]+(\.[0-9]+)?$/) bad["temp_format"]++
  if (date !~ /^2026-07-(0[1-9]|[12][0-9]|30)$/) bad["date"]++
  if (temp < -10 || temp > 50) bad["range"]++
  key=city SUBSEP date
  n[key]++; sum[key]+=temp
  if (n[key]==1) {mn[key]=temp; mx[key]=temp} else {if (temp<mn[key]) mn[key]=temp; if (temp>mx[key]) mx[key]=temp}
  cn[city]++; csum[city]+=temp
  if (cn[city]==1) {cmin[city]=temp; cmax[city]=temp; first[city]=date} else {if (temp<cmin[city]) cmin[city]=temp; if (temp>cmax[city]) cmax[city]=temp; last[city]=date}
}
END {
  if (length(bad)) { for (k in bad) print "BAD: " k " count=" bad[k] > "/dev/stderr"; exit 1 }
  for (k in n) { split(k,a,SUBSEP); print a[1], a[2], sprintf("%.1f", sum[k]/n[k]), mn[k], mx[k], n[k] }
}' raw_data.csv | sort > "$OUT/daily.csv"

awk -F, -v OFS=, '
NR==1 { next }
{ cn[$1]++; csum[$1]+=$4; if (cn[$1]==1) {cmin[$1]=$4; cmax[$1]=$4; first[$1]=$2} else {if ($4<cmin[$1]) cmin[$1]=$4; if ($4>cmax[$1]) cmax[$1]=$4; last[$1]=$2} }
END { for (c in cn) print c, first[c], last[c], sprintf("%.1f", csum[c]/cn[c]), cmin[c], cmax[c], cn[c] }
' raw_data.csv | sort > "$OUT/summary.csv"

{ echo "city,date,avg_temperature_c,min_temperature_c,max_temperature_c,sample_count"; cat "$OUT/daily.csv"; } > "$OUT/clean_data.csv"
{ echo "city,period_start,period_end,mean_temperature_c,min_temperature_c,max_temperature_c,sample_count"; cat "$OUT/summary.csv"; } > "$OUT/clean_data_summary.csv"
rm "$OUT/daily.csv" "$OUT/summary.csv"

echo "OK: $(($(wc -l < "$OUT/clean_data.csv") - 1)) daily rows, $(($(wc -l < "$OUT/clean_data_summary.csv") - 1)) city rows"
