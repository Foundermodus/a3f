#!/usr/bin/env bash
# A3F end-to-end test. Verifies frontend (GitHub Pages) and backend (Tailscale Funnel).
# Throttles submits to stay under the 5/min rate-limit. Fails loudly on every check.
#
# Usage:  ./tests/e2e.sh
# Env:    ADMIN_KEY (or auto-fetched via ssh albumyoo)

set -u
PUB_IP="${PUB_IP:-185.40.234.55}"
API="${API:-https://albumyoo.taile438b2.ts.net}"
PAGES="${PAGES:-https://foundermodus.github.io/a3f}"
ORIGIN="${ORIGIN:-https://foundermodus.github.io}"
RESOLVE="--resolve albumyoo.taile438b2.ts.net:443:$PUB_IP"
THROTTLE="${THROTTLE:-16}"   # seconds between submits — keeps us safely under 5/min

if [[ -z "${ADMIN_KEY:-}" ]]; then
  ADMIN_KEY=$(ssh -o BatchMode=yes albumyoo 'sudo grep ^ADMIN_KEY /opt/a3f/backend/.env | cut -d= -f2' 2>/dev/null)
fi
[[ -z "$ADMIN_KEY" ]] && { echo "ADMIN_KEY missing"; exit 2; }

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL+1)); echo "  ✗ $1: $2"; }

TP="E2E-$(date +%s)"

# Generate test JPEGs locally if PIL is available, else via ssh
gen_jpg() {
  local color="$1" out="$2"
  python3 -c "from PIL import Image; Image.new('RGB',(300,300),$color).save('$out','JPEG')" 2>/dev/null \
    || ssh -o BatchMode=yes albumyoo "python3 -c 'from PIL import Image; Image.new(\"RGB\",(300,300),$color).save(\"/tmp/_e2e.jpg\",\"JPEG\")'; cat /tmp/_e2e.jpg" > "$out" 2>/dev/null
}
gen_jpg "(80,160,220)" /tmp/p1.jpg
gen_jpg "(220,80,160)" /tmp/p2.jpg
[[ -s /tmp/p1.jpg && -s /tmp/p2.jpg ]] && ok "test JPGs generated" || { fail "jpg-gen" "missing"; exit 1; }

# Wait for any prior rate-limit window before we start
echo "(waiting 65s for rate-limit window to clear)"
sleep 65

last_submit=0
throttle_submit() {
  local now elapsed
  now=$(date +%s); elapsed=$(( now - last_submit ))
  if (( last_submit > 0 && elapsed < THROTTLE )); then sleep $(( THROTTLE - elapsed )); fi
  last_submit=$(date +%s)
}

submit() {
  throttle_submit
  curl -sS $RESOLVE -X POST "$API/api/submit" -H "Origin: $ORIGIN" "$@"
}

echo ""
echo "[1] Frontend assets"
for asset in "" app.js style.css config.js qr.js vendor/qrcode.min.js manifest.json; do
  HC=$(curl -sI "$PAGES/$asset" -o /dev/null -w "%{http_code}")
  [[ "$HC" == "200" ]] && ok "GET ${asset:-index} → 200" || fail "GET ${asset:-index}" "$HC"
done

echo ""
echo "[2] Frontend form fields"
HTML=$(curl -s "$PAGES/?cb=$RANDOM")
echo "$HTML" | grep -q 'name="photo"'  && ok "photo input"  || fail "photo input"  "missing"
echo "$HTML" | grep -q 'name="photo2"' && ok "photo2 input" || fail "photo2 input" "missing"
echo "$HTML" | grep -q 'name="email"'  && ok "email input"  || fail "email input"  "missing"
echo "$HTML" | grep -q 'name="phone"'  && ok "phone input"  || fail "phone input"  "missing"
echo "$HTML" | grep -qE 'name="photo"[^>]*required' && fail "photo not optional" "still required" || ok "photo optional"
echo "$HTML" | grep -qE 'name="name"[^>]*required'  && ok "name required"             || fail "name required" "missing"

echo ""
echo "[3] .env perms (server)"
PERM=$(ssh -o BatchMode=yes albumyoo 'sudo stat -c "%a" /opt/a3f/backend/.env' 2>/dev/null)
[[ "$PERM" == "600" ]] && ok ".env is 600" || fail ".env perms" "$PERM"

echo ""
echo "[4] Backend headers"
H=$(curl -sI $RESOLVE "$API/health")
echo "$H" | grep -qi "strict-transport-security" && ok "HSTS"        || fail "HSTS"        "absent"
echo "$H" | grep -qi "x-content-type-options"    && ok "nosniff"     || fail "nosniff"     "absent"
echo "$H" | grep -qi "x-powered-by"              && fail "x-powered-by" "leak" || ok "no x-powered-by"

echo ""
echo "[5] CORS"
H=$(curl -sI $RESOLVE -X OPTIONS "$API/api/submit" -H "Origin: $ORIGIN" -H "Access-Control-Request-Method: POST")
echo "$H" | grep -qi "access-control-allow-origin: $ORIGIN" && ok "Pages origin allowed" || fail "Pages origin" "denied"
HC=$(curl -sI $RESOLVE -X OPTIONS "$API/api/submit" -H "Origin: https://evil.com" -H "Access-Control-Request-Method: POST" -o /dev/null -w "%{http_code}")
[[ "$HC" == "403" ]] && ok "evil origin → 403" || fail "evil origin" "$HC"

echo ""
echo "[6] Submit happy paths (throttled to ${THROTTLE}s/each)"
RESP=$(submit -F "name=$TP-NameOnly")
echo "$RESP" | grep -q '"ok":true' && ok "name only → ok" || fail "name only" "$RESP"

RESP=$(submit -F "name=$TP-OnePhoto" -F "photo=@/tmp/p1.jpg;type=image/jpeg")
echo "$RESP" | grep -q '"ok":true' && ok "name+1 photo → ok" || fail "1 photo" "$RESP"

RESP=$(submit -F "name=$TP-TwoPhotos" -F "photo=@/tmp/p1.jpg;type=image/jpeg" -F "photo2=@/tmp/p2.jpg;type=image/jpeg")
echo "$RESP" | grep -q '"ok":true' && ok "name+2 photos → ok" || fail "2 photos" "$RESP"

RESP=$(submit -F "name=$TP-Contact" -F "email=t@t.de" -F "phone=+41 79 000 00 00")
echo "$RESP" | grep -q '"ok":true' && ok "name+email+phone → ok" || fail "contact" "$RESP"

echo ""
echo "(waiting 65s to reset rate-limit window before validation/idem tests)"
sleep 65
last_submit=0

echo ""
echo "[7] Validation"
# Validation runs ALSO go through rate-limit, so throttle them too
RESP=$(submit)
{ echo "$RESP" | grep -q name_required; } && ok "no name → name_required" || fail "no name" "$RESP"

RESP=$(submit -F "name=$TP-X" -F "email=invalid")
{ echo "$RESP" | grep -q invalid_email; } && ok "bad email → invalid_email" || fail "bad email" "$RESP"

RESP=$(submit -F "name=$TP-X" -F "phone=hello")
{ echo "$RESP" | grep -q invalid_phone; } && ok "bad phone → invalid_phone" || fail "bad phone" "$RESP"

echo ""
echo "(waiting 65s to reset rate-limit window before idempotency tests)"
sleep 65
last_submit=0

echo ""
echo "[7b] Idempotency / dedup"
IDEM="$TP-idem-$(date +%s)"
RESP1=$(submit -H "X-Idempotency-Key: $IDEM" -F "name=$TP-Idem" -F "photo=@/tmp/p1.jpg;type=image/jpeg")
CODE1=$(echo "$RESP1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('code',''))")
[[ -n "$CODE1" ]] && ok "1st submit (idem) → ok" || fail "idem 1st" "$RESP1"

# 2nd submit with same key — also throttled (rate-limit fires before idem check)
RESP2=$(submit -H "X-Idempotency-Key: $IDEM" -F "name=$TP-Idem-Variant" -F "photo=@/tmp/p2.jpg;type=image/jpeg")
CODE2=$(echo "$RESP2" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('code',''))")
DUP=$(echo "$RESP2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('duplicate',False))")
[[ "$CODE1" == "$CODE2" && "$DUP" == "True" ]] && ok "2nd same-key → same code, duplicate:true" || fail "idem 2nd" "code1=$CODE1 code2=$CODE2 dup=$DUP"

# Verify no extra row
COUNT=$(curl -sS $RESOLVE "$API/api/participants" | python3 -c "import sys,json; print(len([p for p in json.load(sys.stdin)['participants'] if p['name']=='$TP-Idem']))")
[[ "$COUNT" == "1" ]] && ok "only 1 row exists for idem-key" || fail "idem dedup" "rows=$COUNT"

echo ""
echo "[8] List shows expected field combinations + thumbnails"
LIST=$(curl -sS $RESOLVE "$API/api/participants")
echo "$LIST" | python3 -c "
import sys,json
d=json.load(sys.stdin)
ours=[p for p in d['participants'] if p['name'].startswith('$TP-')]
by={p['name']:p for p in ours}
need=['$TP-NameOnly','$TP-OnePhoto','$TP-TwoPhotos','$TP-Contact']
missing=[n for n in need if n not in by]
if missing: print('MISSING:', missing); sys.exit(1)
assert by['$TP-NameOnly']['sticker_image'] is None and by['$TP-NameOnly']['sticker_image2'] is None, 'NameOnly photos should be null'
assert by['$TP-OnePhoto']['sticker_image'] and by['$TP-OnePhoto']['sticker_image2'] is None,         'OnePhoto: only 1st'
assert by['$TP-OnePhoto']['sticker_thumb'],                                                          'OnePhoto must have thumb'
assert by['$TP-TwoPhotos']['sticker_image'] and by['$TP-TwoPhotos']['sticker_image2'],               'TwoPhotos: both set'
assert by['$TP-TwoPhotos']['sticker_thumb'] and by['$TP-TwoPhotos']['sticker_thumb2'],               'TwoPhotos must have both thumbs'
assert by['$TP-Contact']['email']=='t@t.de' and by['$TP-Contact']['phone']=='+41 79 000 00 00',     'Contact email/phone'
assert by['$TP-Contact']['sticker_image'] is None,                                                  'Contact has no photo'
print('OK')" >/dev/null && ok "field combinations + thumbs verified" || fail "field combos" "see python output"

echo ""
echo "[8b] Thumbnail size sanity (should be smaller than original)"
THUMB_URL=$(echo "$LIST" | python3 -c "
import sys,json
ours=[p for p in json.load(sys.stdin)['participants'] if p['name']=='$TP-OnePhoto']
print(ours[0]['sticker_thumb'])")
THUMB_BYTES=$(curl -sI $RESOLVE "$API$THUMB_URL" | grep -i content-length | awk '{print $2}' | tr -d '\r')
FULL_URL=$(echo "$THUMB_URL" | sed 's/-thumb//')
FULL_BYTES=$(curl -sI $RESOLVE "$API$FULL_URL" | grep -i content-length | awk '{print $2}' | tr -d '\r')
echo "  thumb=$THUMB_BYTES bytes, full=$FULL_BYTES bytes"
[[ -n "$THUMB_BYTES" && -n "$FULL_BYTES" && "$THUMB_BYTES" -lt "$FULL_BYTES" ]] && ok "thumb < full ($THUMB_BYTES < $FULL_BYTES)" || fail "thumb size" "$THUMB_BYTES vs $FULL_BYTES"

echo ""
echo "[9] Cleanup ONLY our test rows (preserve real user data)"
DEL_OK=0; DEL_TARGET=0
for id in $(echo "$LIST" | python3 -c "import sys,json; print(' '.join(str(p['id']) for p in json.load(sys.stdin)['participants'] if p['name'].startswith('$TP-')))"); do
  DEL_TARGET=$((DEL_TARGET+1))
  HC=$(curl -sS $RESOLVE -X DELETE -H "X-Admin-Key: $ADMIN_KEY" "$API/api/participants/$id" -o /dev/null -w "%{http_code}")
  [[ "$HC" == "200" ]] && DEL_OK=$((DEL_OK+1))
done
[[ "$DEL_OK" == "$DEL_TARGET" ]] && ok "deleted $DEL_OK/$DEL_TARGET test rows" || fail "delete" "$DEL_OK/$DEL_TARGET"

REMAINING=$(curl -sS $RESOLVE "$API/api/participants" | python3 -c "import sys,json; print(len([p for p in json.load(sys.stdin)['participants'] if p['name'].startswith('$TP-')]))")
[[ "$REMAINING" == "0" ]] && ok "no test rows leftover" || fail "leftover" "$REMAINING"

KEPT=$(curl -sS $RESOLVE "$API/api/participants" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['participants']))")
ok "preserved $KEPT non-test rows"

# Orphan-file check (counts full + thumb refs)
LEFT=$(ssh -o BatchMode=yes albumyoo "ls /opt/a3f/backend/uploads/*.jpg 2>/dev/null | wc -l")
EXPECTED=$(curl -sS $RESOLVE "$API/api/participants" | python3 -c "
import sys,json
n=0
for p in json.load(sys.stdin)['participants']:
  for k in ('sticker_image','sticker_image2','sticker_thumb','sticker_thumb2'):
    if p.get(k): n+=1
print(n)")
[[ "$LEFT" == "$EXPECTED" ]] && ok "uploads/ orphan-frei ($LEFT files = $EXPECTED DB refs)" || fail "orphans" "$LEFT files vs $EXPECTED DB refs"

echo ""
echo "==== RESULT: $PASS passed, $FAIL failed ===="
rm -f /tmp/p1.jpg /tmp/p2.jpg
exit $(( FAIL > 0 ))
