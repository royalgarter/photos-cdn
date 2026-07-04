#!/usr/bin/env bash
# Semantic vector matching test — 10 distinct prompts across different fields.
# Checks that each prompt matches an image whose text/category is semantically related.
# Usage: ./test-semantic.sh [BASE_URL]

BASE="${1:-http://localhost:34070}"
PASS=0
FAIL=0
WARN=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo "=== Semantic Vector Matching Test ==="
echo "Target: $BASE"
echo ""

# Each entry: "prompt" "expected_semantic_fields (comma-separated keywords expected in matched image text/category)"
declare -A CASES
declare -a ORDER

add_case() {
  local id="$1" prompt="$2" keywords="$3"
  CASES["$id|prompt"]="$prompt"
  CASES["$id|keywords"]="$keywords"
  ORDER+=("$id")
}

add_case "finance"    "Bitcoin surges past \$100k as institutional investors flood crypto markets"  "crypto,bitcoin,btc,finance,money"
add_case "nature"     "Lush Amazon rainforest at dawn with mist over the canopy"                   "nature,forest,tree,green,jungle,amazon"
add_case "sports"     "NBA finals overtime thriller — LeBron James hits buzzer beater"             "sport,basketball,nba,game,athlete"
add_case "food"       "Michelin star tasting menu with truffle risotto and wine pairing"           "food,meal,restaurant,chef,dish"
add_case "tech"       "OpenAI releases GPT-5 with real-time reasoning and vision capabilities"     "tech,technology,ai,digital,computer"
add_case "politics"   "US Senate votes on new climate change legislation"                          "politics,government,law,senate,congress,legal"
add_case "travel"     "Hidden beaches of Santorini — cliffside villages and turquoise Aegean sea" "travel,beach,sea,vacation,greece,blue"
add_case "medical"    "Breakthrough gene therapy cures hereditary blindness in clinical trial"     "medical,health,science,research,lab"
add_case "space"      "NASA Artemis mission captures stunning images of lunar surface at sunrise"  "space,moon,nasa,sky,star,cosmic,universe"
add_case "automotive" "Tesla Cybertruck off-road test drive across the Mojave desert"              "automotive,car,vehicle,electric,drive"

# --- 20 additional variants ---
add_case "finance2"   "Federal Reserve raises interest rates again amid persistent inflation fears"     "finance,bank,economy,rate,inflation,money"
add_case "finance3"   "Stock market crashes — Dow Jones drops 1500 points in single session"           "finance,stock,market,trade,crash,dow"
add_case "nature2"    "Cherry blossom season peaks in Kyoto as tourists flock to temples"              "nature,flower,blossom,tree,garden,japan"
add_case "nature3"    "Rare snowfall blankets Sahara Desert creating surreal winter landscape"         "nature,desert,snow,landscape,sky"
add_case "sports2"    "Lionel Messi scores hat-trick to lead Argentina to World Cup glory"             "sport,soccer,football,messi,goal,world cup"
add_case "sports3"    "Tour de France final stage — breakaway rider wins on Champs-Élysées"           "sport,cycling,bike,race,athlete,france"
add_case "food2"      "Street food tour of Bangkok — pad thai, mango sticky rice and som tam"         "food,meal,street,restaurant,thai,dish"
add_case "food3"      "Artisanal sourdough bread baking guide — fermentation and crust secrets"        "food,bread,bake,cook,kitchen,recipe"
add_case "tech2"      "Apple unveils Vision Pro 2 with breakthrough neural display technology"         "tech,technology,apple,device,digital,ai"
add_case "tech3"      "Google DeepMind AI solves protein folding for entire human proteome"            "tech,technology,ai,science,research,digital"
add_case "politics2"  "EU Parliament passes sweeping AI regulation bill affecting big tech firms"      "politics,government,law,europe,regulation,legal"
add_case "politics3"  "G7 leaders gather in Rome for summit on global economic recovery"              "politics,government,summit,leader,diplomacy"
add_case "travel2"    "Northern lights illuminate the skies above Tromsø Norway in winter"            "travel,aurora,norway,sky,winter,vacation"
add_case "travel3"    "Safari adventure in Serengeti — lions, elephants and the great migration"      "travel,safari,africa,wildlife,animal,vacation"
add_case "medical2"   "Pfizer announces new mRNA vaccine platform targeting multiple cancers"          "medical,health,vaccine,cancer,research,pharma"
add_case "medical3"   "Robot-assisted surgery achieves record precision in cardiac procedure"          "medical,health,surgery,hospital,science,robot"
add_case "space2"     "James Webb telescope reveals ancient galaxy forming just 300 million years after Big Bang" "space,galaxy,star,telescope,universe,cosmic"
add_case "space3"     "SpaceX Starship completes first successful orbital flight and ocean landing"    "space,rocket,spacex,orbit,launch,star"
add_case "automotive2" "Formula 1 Monaco Grand Prix — Max Verstappen dominates street circuit race"  "automotive,car,racing,formula,speed,driver"
add_case "environment" "Coral reef bleaching reaches record levels as ocean temperatures soar"         "nature,ocean,reef,coral,climate,sea,water"

echo "Fetching current DB images for reference..."
DB_IMAGES=$(curl -s "$BASE/api/images")
DB_COUNT=$(echo "$DB_IMAGES" | python3 -c "import sys,json; imgs=json.load(sys.stdin); print(len(imgs))" 2>/dev/null)
echo "DB has $DB_COUNT indexed images"
echo ""

for id in "${ORDER[@]}"; do
  prompt="${CASES[$id|prompt]}"
  keywords="${CASES[$id|keywords]}"

  printf "${CYAN}[%-12s]${NC} %s\n" "$id" "$prompt"

  # Hit CDN endpoint — get similarity score + matched image key
  response=$(curl -sD - -o /dev/null "$BASE/api/cdn/800/600?text=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$prompt")" 2>/dev/null)
  similarity=$(echo "$response" | grep -i "x-similarity-score:" | tr -d '\r' | awk '{print $2}')
  img_key=$(echo "$response" | grep -i "x-image-key:" | tr -d '\r' | awk '{print $2}')
  is_fallback=$(echo "$response" | grep -i "x-cdn-fallback:" | tr -d '\r' | awk '{print $2}')

  # Look up matched image text in DB
  matched_text=$(echo "$DB_IMAGES" | python3 -c "
import sys,json
imgs=json.load(sys.stdin)
key='$img_key'
for i in imgs:
    if i['_key']==key:
        print(i.get('text','')[:100])
        break
" 2>/dev/null)
  matched_cat=$(echo "$DB_IMAGES" | python3 -c "
import sys,json
imgs=json.load(sys.stdin)
key='$img_key'
for i in imgs:
    if i['_key']==key:
        print(i.get('category',''))
        break
" 2>/dev/null)

  # Check keyword match
  combined="${matched_text,,} ${matched_cat,,}"
  hit=0
  matched_kw=""
  IFS=',' read -ra KWS <<< "$keywords"
  for kw in "${KWS[@]}"; do
    if echo "$combined" | grep -q "$kw"; then
      hit=1
      matched_kw="$kw"
      break
    fi
  done

  sim_float=$(echo "$similarity" | python3 -c "import sys; v=sys.stdin.read().strip(); print(float(v) if v else 0)" 2>/dev/null)
  sim_ok=$(python3 -c "print('yes' if float('${sim_float:-0}') >= 0.5 else 'no')" 2>/dev/null)

  printf "  Matched: %-12s sim=%-6s text='%s'\n" "$img_key" "$similarity" "$matched_text"

  if [ "$hit" -eq 1 ] && [ "$sim_ok" = "yes" ]; then
    echo -e "  ${GREEN}PASS${NC} keyword '$matched_kw' found, similarity $similarity >= 0.5"
    ((PASS++))
  elif [ "$hit" -eq 1 ]; then
    echo -e "  ${YELLOW}WARN${NC} keyword '$matched_kw' found but similarity $similarity < 0.5 (weak match)"
    ((WARN++))
  elif [ "$sim_ok" = "yes" ]; then
    echo -e "  ${YELLOW}WARN${NC} no keyword match in '$matched_text' (expected: $keywords) — but sim=$similarity"
    ((WARN++))
  else
    echo -e "  ${RED}FAIL${NC} no semantic match. Got: '$matched_text' (expected keywords: $keywords)"
    ((FAIL++))
  fi

  [ -n "$is_fallback" ] && echo -e "  ${YELLOW}NOTE${NC} X-CDN-Fallback: $is_fallback (no strong DB match, served best available)"
  echo ""
done

echo "=============================="
echo -e "Results: ${GREEN}$PASS passed${NC}, ${YELLOW}$WARN warned${NC}, ${RED}$FAIL failed${NC} (of ${#ORDER[@]} cases)"
echo ""
echo "NOTE: WARN = semantic match found but similarity < 0.5, or keyword not in stored text."
echo "      This is expected when the DB lacks images in that category — indexer will fill over time."
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
