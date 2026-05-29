#!/usr/bin/env bash
# Wikimedia Commons에서 한국 hwatu SVG 다운로드 (CC-BY-SA 4.0, 작가: Mliu92)
# 사용: bash _download.sh
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

URL_BASE="https://commons.wikimedia.org/wiki/Special:FilePath"
UA="lazyslimestudio-matgo/0.1 (https://github.com/ddavil62/lazyslimestudio; ddavil0403@gmail.com)"

# 다운로드할 파일 목록 (Wikimedia 파일명 그대로)
declare -a FILES=(
  # 광 5장
  "Hwatu_January_gwang.svg"
  "Hwatu_March_gwang.svg"
  "Hwatu_August_gwang.svg"
  "Hwatu_November_gwang.svg"
  "Hwatu_December_gwang.svg"

  # 끗 9장 (yul = 한국식 끗)
  "Hwatu_February_yul.svg"
  "Hwatu_April_yul.svg"
  "Hwatu_May_yul.svg"
  "Hwatu_June_yul.svg"
  "Hwatu_July_yul.svg"
  "Hwatu_August_yul.svg"
  "Hwatu_September_yul_ssang_pi.svg"
  "Hwatu_October_yul.svg"
  "Hwatu_December_yul.svg"

  # 띠 10장
  "Hwatu_January_tti.svg"
  "Hwatu_February_tti.svg"
  "Hwatu_March_tti.svg"
  "Hwatu_April_tti.svg"
  "Hwatu_May_tti.svg"
  "Hwatu_June_tti.svg"
  "Hwatu_July_tti.svg"
  "Hwatu_September_tti.svg"
  "Hwatu_October_tti.svg"
  "Hwatu_December_tti.svg"

  # 피 (월별 1, 2)
  "Hwatu_January_pi_1.svg"   "Hwatu_January_pi_2.svg"
  "Hwatu_February_pi_1.svg"  "Hwatu_February_pi_2.svg"
  "Hwatu_March_pi_1.svg"     "Hwatu_March_pi_2.svg"
  "Hwatu_April_pi_1.svg"     "Hwatu_April_pi_2.svg"
  "Hwatu_May_pi_1.svg"       "Hwatu_May_pi_2.svg"
  "Hwatu_June_pi_1.svg"      "Hwatu_June_pi_2.svg"
  "Hwatu_July_pi_1.svg"      "Hwatu_July_pi_2.svg"
  "Hwatu_August_pi_1.svg"    "Hwatu_August_pi_2.svg"
  "Hwatu_September_pi_1.svg"
  "Hwatu_October_pi_1.svg"   "Hwatu_October_pi_2.svg"
  "Hwatu_November_pi_1.svg"  "Hwatu_November_pi_2.svg"

  # 쌍피 (9월은 yul_ssang_pi와 별개, 11월/12월은 ssang_pi)
  "Hwatu_November_ssang_pi.svg"
  "Hwatu_December_ssang_pi.svg"
)

# 병렬 다운로드 (User-Agent 필수)
for f in "${FILES[@]}"; do
  curl -s -L -A "$UA" -o "$f" "${URL_BASE}/${f}" &
done
wait

# SVG 매직 확인 (XML 시작 또는 <svg)
echo "--- 결과 ---"
declare -i ok=0 fail=0
for f in "${FILES[@]}"; do
  if [[ -f "$f" ]]; then
    head -c 100 "$f" 2>/dev/null | grep -qE '<\?xml|<svg' && { ok+=1; } || { echo "FAIL $f"; fail+=1; }
  else
    echo "MISS $f"
    fail+=1
  fi
done
echo "OK: $ok / FAIL: $fail / TOTAL: ${#FILES[@]}"
