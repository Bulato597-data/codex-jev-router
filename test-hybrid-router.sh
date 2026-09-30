#!/usr/bin/env bash
set -euo pipefail

# Offline contract checks. HTTP traffic and credentials are mocked.
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROUTER="${CODEX_ROUTE_BIN:-$SCRIPT_DIR/codex-route}"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jev-router-check.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT
mkdir -p "$WORK_DIR/home/.codex"
export HOME="$WORK_DIR/home"
jq '{models: ([.models[] | {slug: .id, visibility: "list", supported_reasoning_levels: [.codex_efforts[] | {effort: .}]}] + [{slug: "gpt-reserve", visibility: "list", supported_reasoning_levels: [{effort: "low"}]}])}' \
  "$SCRIPT_DIR/codex-model-catalog.json" > "$HOME/.codex/models_cache.json"

die() { printf 'test-hybrid-router: %s\n' "$1" >&2; exit 1; }
assert_field() {
  local output="$1" field="$2" expected="$3" actual
  actual="$(sed -n "s/^$field=//p" <<< "$output")"
  [[ "$actual" == "$expected" ]] || die "expected $field=$expected, got $actual"
}

cat > "$WORK_DIR/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
set -euo pipefail
cat > "$MOCK_REQUEST_CAPTURE"
printf 'called\n' >> "$MOCK_CALL_MARKER"
jq -e --arg task "$MOCK_EXPECT_TASK" --slurpfile source "$MOCK_SOURCE_CATALOG" '
  . as $request |
  .model == "jev-latest" and .state.task == $task and
  (.state.routing_criteria | contains("independent")) and
  (.state.routing_criteria | contains("least allowance-consuming sufficient model and effort")) and
  (.state.official_model_documentation_text | contains("not a published per-task conversion for the included weekly allowance")) and
  (.questions | length == 12) and
  all($source[0].selection_policy.noul_questions[];
    . as $q | $request.questions[$q.id].type == "noul" and
    $request.questions[$q.id].instructions == $q.instructions and
    $request.questions[$q.id].criteria.true == $q.true and
    $request.questions[$q.id].criteria.false == $q.false) and
  (([.state, .questions] | tostring | contains("https://")) | not) and
  (([.state, .questions] | tostring | contains("gpt-reserve")) | not)
' "$MOCK_REQUEST_CAPTURE" >/dev/null || exit 61
if grep -Fq 'dummy-test-secret' "$MOCK_REQUEST_CAPTURE"; then exit 62; fi
cat "$MOCK_RESPONSE"
MOCK_CURL
chmod +x "$WORK_DIR/curl"

write_response() {
  jq -n --slurpfile source "$SCRIPT_DIR/codex-model-catalog.json" '
    {model:"jev-1.13.0",
     answers:([$source[0].selection_policy.noul_questions[] | {key:.id,value:{type:"noul",noul:0}}] | from_entries),
     usage:{input_tokens:21,output_tokens:7}}
  ' > "$WORK_DIR/response.json"
}
set_noul() {
  local id="$1" value="$2"
  jq --arg id "$id" --argjson value "$value" '.answers[$id].noul=$value' \
    "$WORK_DIR/response.json" > "$WORK_DIR/edited.json"
  mv "$WORK_DIR/edited.json" "$WORK_DIR/response.json"
}
run_route() {
  local task="$1"
  printf '%s\n' "$task" | MOCK_CALL_MARKER="$WORK_DIR/called" \
    MOCK_REQUEST_CAPTURE="$WORK_DIR/request.json" \
    MOCK_SOURCE_CATALOG="$SCRIPT_DIR/codex-model-catalog.json" \
    MOCK_RESPONSE="$WORK_DIR/response.json" MOCK_EXPECT_TASK="$task" \
    PATH="$WORK_DIR:$PATH" TYPESAFE_API_KEY='dummy-test-secret' CODEX_BIN=/usr/bin/true \
      "$ROUTER" --route-only --hybrid
}

write_response
rm -f "$WORK_DIR/called"
output="$(run_route 'Make a small CSS fix to the mobile pricing card.')"
grep -Fx 'called' "$WORK_DIR/called" >/dev/null || die 'Jev request was not made'
[[ "$(wc -l < "$WORK_DIR/called" | tr -d ' ')" == 1 ]] || die 'Jev routing used more than one HTTP request'
assert_field "$output" jev_status nouls_composed
assert_field "$output" route_source jev-noul-composed
assert_field "$output" model gpt-6-luna
assert_field "$output" effort low
sed -n 's/^jev_diagnostics=//p' <<< "$output" | jq -e '.basis == "independent_noul_questions_composed_locally" and .threshold_policy.yes_at_or_above == 0.70 and .nouls.frontier_architecture == 0' >/dev/null || die 'Noul diagnostics or probability meaning missing'

# The same independent typed answers compose to distinct routes in local code.
write_response; set_noul complex_agentic_coding 0.91
output="$(run_route 'Build a complete multi-step coding workflow.')"
assert_field "$output" model gpt-6.1-sol
assert_field "$output" effort high
write_response; set_noul computer_use_workflow 0.91
output="$(run_route 'Complete a multi-step task through a graphical application.')"
assert_field "$output" model gpt-6.1-sol
assert_field "$output" effort high

write_response; set_noul complete_feature 0.88
output="$(run_route 'Implement a feature with interacting behaviors.')"
assert_field "$output" model gpt-6-sol
assert_field "$output" effort high

write_response; set_noul frontier_architecture 0.92
output="$(run_route 'Design architecture across services.')"
assert_field "$output" model gpt-6-astra
assert_field "$output" effort high
write_response; set_noul frontier_architecture 0.91; set_noul frontier_debugging 0.83
output="$(run_route 'Design and diagnose architecture across services.')"
assert_field "$output" model gpt-6-astra
assert_field "$output" effort xhigh

# Noul is probability of its one statement. Its middle band is unresolved,
# not a confidence score, and follows the published local composition rule.
write_response; set_noul unknown_cause 0.50
output="$(run_route 'Investigate an unclear task.')"
assert_field "$output" model gpt-6-sol
assert_field "$output" effort medium
assert_field "$output" route_source jev-noul-composed

# Threshold boundaries are inclusive exactly as specified in the catalog.
write_response; set_noul complex_agentic_coding 0.70
output="$(run_route 'Build a multi-step coding workflow.')"
assert_field "$output" model gpt-6.1-sol
write_response; set_noul complex_agentic_coding 0.30
output="$(run_route 'Make a small CSS fix to the mobile pricing card.')"
assert_field "$output" model gpt-6-luna

# Deterministic local risk rules remain final.
write_response
output="$(run_route 'Apply MFA requirements to administrator logins.')"
assert_field "$output" model gpt-6-sol
assert_field "$output" route_override sensitive-risk-floor

# Local safety floors still protect Jev-negative answers on hazardous work.
for task in \
  'Review API key rotation instructions for the router.' \
  'Change the live deployment version.' \
  'Read a confidential document.'; do
  output="$(run_route "$task")"
  assert_field "$output" model gpt-6-sol
  assert_field "$output" effort high
  assert_field "$output" route_override sensitive-risk-floor
done
for task in \
  'Blueprint a cross-region system architecture.' \
  'Diagnose an intermittent ordering defect across asynchronous event consumers.'; do
  output="$(run_route "$task")"
  assert_field "$output" model gpt-6-astra
  assert_field "$output" route_override heavy-context-floor
done

# Context words in a read-only repository summary do not count as live or
# sensitive actions by themselves.
for task in \
  $'Correct a typo in the command example in the README.\n\nRepository inspection (read-only factual summary): The example lives in README.md.' \
  $'Make the narrow-screen heading wrap instead of clipping.\n\nRepository inspection (read-only factual summary): The markup lives under app/components/.'; do
  output="$(run_route "$task")"
  assert_field "$output" model gpt-6-luna
  assert_field "$output" effort low
  assert_field "$output" route_override ''
done

# Missing or invalid typed answers fail closed to local routing.
cp "$WORK_DIR/response.json" "$WORK_DIR/valid.json"
for mutation in 'del(.answers.frontier_architecture)' '.answers.frontier_architecture.noul = 1.2' '.answers.frontier_architecture.type = "choice"'; do
  jq "$mutation" "$WORK_DIR/valid.json" > "$WORK_DIR/response.json"
  output="$(run_route 'Make a small CSS fix to the mobile pricing card.')"
  assert_field "$output" jev_status malformed_noul_response
  assert_field "$output" route_source local-fallback
done

# Explicit overrides bypass Jev. A new automatic route needs a stdin brief,
# and forwarded Codex arguments must never be included in the request.
rm -f "$WORK_DIR/called"
output="$(PATH="$WORK_DIR:$PATH" TYPESAFE_API_KEY='dummy-test-secret' CODEX_BIN=/usr/bin/true \
  "$ROUTER" --route-only --hybrid --model gpt-6-astra 'Review this architecture')"
[[ ! -e "$WORK_DIR/called" ]] || die 'Jev ran despite explicit model override'
assert_field "$output" model gpt-6-astra

rm -f "$WORK_DIR/called"
if PATH="$WORK_DIR:$PATH" TYPESAFE_API_KEY='dummy-test-secret' CODEX_BIN=/usr/bin/true \
  "$ROUTER" --route-only --hybrid -c 'api_key=dummy-flag-secret' 'Review this architecture' \
  > "$WORK_DIR/ambiguous-output" 2> "$WORK_DIR/ambiguous-error"; then
  die 'hybrid routing accepted forwarded arguments without stdin task text'
fi
[[ ! -e "$WORK_DIR/called" ]] || die 'forwarded option was sent to Jev'
grep -Fq 'needs task text on stdin' "$WORK_DIR/ambiguous-error" || die 'missing safe task-brief guidance'

# With an explicit stdin brief, Codex flags and positionals still stay out of Jev.
write_response
rm -f "$WORK_DIR/called"
printf '%s\n' 'Review this architecture' | MOCK_CALL_MARKER="$WORK_DIR/called" \
  MOCK_REQUEST_CAPTURE="$WORK_DIR/request.json" \
  MOCK_SOURCE_CATALOG="$SCRIPT_DIR/codex-model-catalog.json" \
  MOCK_RESPONSE="$WORK_DIR/response.json" \
  MOCK_EXPECT_TASK='Review this architecture' \
  PATH="$WORK_DIR:$PATH" TYPESAFE_API_KEY='dummy-test-secret' CODEX_BIN=/usr/bin/true \
  "$ROUTER" --route-only --hybrid -c 'api_key=dummy-flag-secret' 'ignored positional text' > "$WORK_DIR/safe-output"
[[ -e "$WORK_DIR/called" ]] || die 'Jev did not receive the stdin brief'
! grep -Fq 'dummy-flag-secret' "$WORK_DIR/request.json" || die 'forwarded Codex option leaked to Jev'
grep -Fq 'Review this architecture' "$WORK_DIR/request.json" || die 'stdin task brief was not sent to Jev'

printf '%s\n' 'Atomic Noul router contract checks passed.'
