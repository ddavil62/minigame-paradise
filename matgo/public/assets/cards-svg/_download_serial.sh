#!/usr/bin/env bash
# 실패한 SVG만 직렬로 다시 다운로드 (rate limit 회피용 sleep 포함)
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

URL_BASE="https://commons.wikimedia.org/wiki/Special:FilePath"
UA="lazyslimestudio-matgo/0.1 (https://github.com/ddavil62/lazyslimestudio; ddavil0403@gmail.com)"

declare -a FILES=(
  "Hwatu_January_gwang.svg" "Hwatu_March_gwang.svg" "Hwatu_August_gwang.svg"
  "Hwatu_November_gwang.svg" "Hwatu_December_gwang.svg"
  "Hwatu_February_yul.svg" "Hwatu_April_yul.svg" "Hwatu_May_yul.svg"
  "Hwatu_June_yul.svg" "Hwatu_July_yul.svg" "Hwatu_August_yul.svg"
  "Hwatu_September_yul_ssang_pi.svg" "Hwatu_October_yul.svg" "Hwatu_December_yul.svg"
  "Hwatu_January_tti.svg" "Hwatu_February_tti.svg" "Hwatu_March_tti.svg"
  "Hwatu_April_tti.svg" "Hwatu_May_tti.svg" "Hwatu_June_tti.svg"
  "Hwatu_July_tti.svg" "Hwatu_September_tti.svg" "Hwatu_October_tti.svg"
  "Hwatu_December_tti.svg"
  "Hwatu_January_pi_1.svg" "Hwatu_January_pi_2.svg"
  "Hwatu_February_pi_1.svg" "Hwatu_February_pi_2.svg"
  "Hwatu_March_pi_1.svg" "Hwatu_March_pi_2.svg"
  "Hwatu_April_pi_1.svg" "Hwatu_April_pi_2.svg"
  "Hwatu_May_pi_1.svg" "Hwatu_May_pi_2.svg"
  "Hwatu_June_pi_1.svg" "Hwatu_June_pi_2.svg"
  "Hwatu_July_pi_1.svg" "Hwatu_July_pi_2.svg"
  "Hwatu_August_pi_1.svg" "Hwatu_August_pi_2.svg"
  "Hwatu_September_pi_1.svg"
  "Hwatu_October_pi_1.svg" "Hwatu_October_pi_2.svg"
  "Hwatu_November_pi_1.svg" "Hwatu_November_pi_2.svg"
  "Hwatu_November_ssang_pi.svg" "Hwatu_December_ssang_pi.svg"
)

is_svg() {
  head -c 100 "$1" 2>/dev/null | grep -qE '<\?xml|<svg'
}

declare -i ok=0 fail=0 skipped=0
for f in "${FILES[@]}"; do
  if [[ -f "$f" ]] && is_svg "$f"; then
    skipped+=1
    continue
  fi
  # 직렬 + 0.6초 sleep
  curl -s -L --max-time 20 -A "$UA" -o "$f" "${URL_BASE}/${f}"
  if is_svg "$f"; then
    ok+=1
  else
    fail+=1
    echo "FAIL $f"
  fi
  sleep 2
done

echo ""
echo "스킵: $skipped / 새로 OK: $ok / FAIL: $fail / 전체: ${#FILES[@]}"
echo "총 정상 SVG: $((skipped + ok))"
