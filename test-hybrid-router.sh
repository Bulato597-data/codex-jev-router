#!/usr/bin/env bash
set -euo pipefail

# Offline contract checks for global Jev routing. Uses a dummy credential and
# mocked HTTP response; it never reads a real credential or calls TypeSafe.
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROUTER="${CODEX_ROUTE_BIN:-$SCRIPT_DIR/codex-route}"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jev-router-check.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT
mkdir -p "$WORK_DIR/home/.codex"
export HOME="$WORK_DIR/home"

# Mirror the documented desktop models, but also expose a GPT-Reserve
# entry in the fixture. The reserve must never become a Jev option.
jq '{models: ([.models[] | {slug: .id, visibility: "list", supported_reasoning_levels: [.codex_efforts[] | {effort: .}]}] + [{slug: "gpt-reserve", visibility: "list", supported_reasoning_levels: [{effort: "low"}]}])}' \
  "$SCRIPT_DIR/codex-model-catalog.json" > "$HOME/.codex/models_cache.json"

die() { printf 'test-hybrid-router: %s\n' "$1" >&2; exit 1; }
assert_field() {
  local output="$1" field="$2" expected="$3" actual
  actual="$(sed -n "s/^$field=//p" <<< "$output")"
  [[ "$actual" == "$expected" ]] || die "expected $field=$expected, got $actual"
}

cat > "$WORK_DIR/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cat > "$MOCK_REQUEST_CAPTURE"
printf 'called\n' >> "$MOCK_CALL_MARKER"
jq -e --arg task "$MOCK_EXPECT_TASK" --slurpfile source "$MOCK_SOURCE_CATALOG" '
  def expected_options:
    $source[0].models | map(.id) | sort;
  . as $request
  | .model == "jev-latest"
  and .state.task == $task
  and (.state.routing_criteria | contains("Select the executor for the COMPLETE task"))
  and ((.state.routing_criteria | contains("Desktop default: gpt-6-luna at xhigh")) | not)
  and (.state.routing_criteria | contains("Routine/bounded example:"))
  and (.state.routing_criteria | contains("Complex task example:"))
  and (.state.routing_criteria | contains("Highest-demand example:"))
  and (.state.routing_criteria | contains("preserving the included Codex allowance"))
  and (.state.routing_criteria | contains("least allowance-consuming sufficient model and effort"))
  and (.state.official_model_documentation_text | contains("gpt-6-luna 2.5/0.25/12.5"))
  and (.state.official_model_documentation_text | contains("gpt-6.1-sol 50/2.5/250"))
  and (.state.official_model_documentation_text | contains("not a published per-task conversion for the included weekly allowance"))
  and (.state.official_model_documentation_text | contains("Fast mode uses included allowance at 2.5x"))
  and (.state.routing_criteria | contains("Do not use OpenAI API token prices as a proxy"))
  and (.state.routing_criteria | contains("A short request can still be hard"))
  and (.state.routing_criteria | contains("xhigh for interacting constraints"))
  and (.state.official_model_documentation_text | length > 9000)
  and all($source[0].models[]; .official_documentation_text as $full_text | $request.state.official_model_documentation_text | contains($full_text))
  and (.state.official_model_documentation_text | contains("1,050,000"))
  and (.state.official_model_documentation_text | contains("922,000"))
  and (.state.official_model_documentation_text | contains("128,000"))
  and (.state.official_model_documentation_text | contains("v1/responses"))
  and (.state.official_model_documentation_text | contains("prompt caching"))
  and (.state.official_model_documentation_text | contains("per 1 million tokens"))
  and (.state.official_model_documentation_text | contains("Codex desktop reasoning-effort choices currently visible"))
  and ((.state | has("model_catalog")) | not)
  and (([.state, .questions] | tostring | contains("https://")) | not)
  and (([.state, .questions] | tostring | contains("gpt-reserve")) | not)
  and (.questions | length == 9)
  and (.questions.model.type == "choice")
  and (.questions.model.instructions | contains("Jev cannot browse"))
  and ((.questions.model.criteria | keys) == expected_options)
  and all($source[0].models[];
    . as $m | ("effort_" + (.id | gsub("[^A-Za-z0-9]"; "_"))) as $qid |
    $request.questions[$qid].type == "choice" and
    ($request.questions[$qid].instructions | contains($m.id)) and
    (($request.questions[$qid].criteria | keys) == ($m.codex_efforts | sort)) and
    all($request.questions[$qid].criteria[]; type == "string" and length > 80))
' "$MOCK_REQUEST_CAPTURE" >/dev/null || exit 61
if grep -Fq 'dummy-test-secret' "$MOCK_REQUEST_CAPTURE"; then exit 62; fi
cat "$MOCK_RESPONSE"
EOF
chmod +x "$WORK_DIR/curl"

write_response() {
  # Convert the original route fixtures to two real Choice response contracts.
  # The fixture supplies the same confidence for both unless a test edits one.
  jq --slurpfile source "$SCRIPT_DIR/codex-model-catalog.json" '
    .answers.route as $old |
    ($old.choice | split("__")) as $parts |
    ($source[0].models[] | select((.id | gsub("[^A-Za-z0-9]"; "_")) == $parts[0])) as $m |
    .answers = {
      model: {type:"choice", choice:$m.id, confidence:$old.confidence,
        probabilities: ([$source[0].models[] | {key:.id,value:(if .id == $m.id then 1 else 0 end)}] | from_entries)},
      ("effort_" + $parts[0]): {type:"choice", choice:$parts[1], confidence:$old.confidence,
        probabilities: ([$m.codex_efforts[] | {key:.,value:(if . == $parts[1] then 1 else 0 end)}] | from_entries)}
    }
  ' <<< "$1" > "$WORK_DIR/response.json"
}
run_route() {
  local task="$1"
  MOCK_CALL_MARKER="$WORK_DIR/called" \
  MOCK_REQUEST_CAPTURE="$WORK_DIR/request.json" \
  MOCK_SOURCE_CATALOG="$SCRIPT_DIR/codex-model-catalog.json" \
  MOCK_RESPONSE="$WORK_DIR/response.json" \
  MOCK_EXPECT_TASK="$task" \
  PATH="$WORK_DIR:$PATH" \
  TYPESAFE_API_KEY='dummy-test-secret' \
  CODEX_BIN=/usr/bin/true \
    "$ROUTER" --route-only --hybrid <<< "$task"
}

write_response '{"model":"jev-1.13.0","answers":{"route":{"type":"choice","choice":"gpt_6_sol__high","confidence":0.92}},"usage":{"input_tokens":21,"output_tokens":7}}'

# Jev runs for bounded, sensitive, and heavy automatic selections.
for task in \
  'Make a small CSS fix to the mobile pricing card.' \
  'Review API key rotation instructions for the router.'; do
  rm -f "$WORK_DIR/called"
  output="$(run_route "$task")"
  grep -Fx 'called' "$WORK_DIR/called" >/dev/null || die "Jev was not called for automatic task: $task"
  assert_field "$output" jev_status choice_routed
  assert_field "$output" model gpt-6-sol
  assert_field "$output" effort high
  grep -F 'jev-advisory;choice=gpt-6-sol;effort=high;model=jev-1.13.0;confidence=0.92' <<< "$output" >/dev/null || die 'model, effort, or Jev metadata was lost'
done

# The newly released GPT-6.1 Sol must be offered and routable as a Sol model.
write_response '{"model":"jev-1.13.0","answers":{"route":{"type":"choice","choice":"gpt_6_1_sol__high","confidence":0.92}},"usage":{"input_tokens":21,"output_tokens":7}}'
rm -f "$WORK_DIR/called"
output="$(run_route 'Make a small CSS fix to the mobile pricing card.')"
grep -Fx 'called' "$WORK_DIR/called" >/dev/null || die 'Jev was not called for GPT-6.1 Sol selection'
assert_field "$output" model gpt-6.1-sol
assert_field "$output" effort high
assert_field "$output" lane sol

write_response '{"model":"jev-1.13.0","answers":{"route":{"type":"choice","choice":"gpt_6_sol__high","confidence":0.92}},"usage":{"input_tokens":21,"output_tokens":7}}'
rm -f "$WORK_DIR/called"
output="$(run_route 'Blueprint a cross-region system architecture.')"
grep -Fx 'called' "$WORK_DIR/called" >/dev/null || die 'Jev was not called for a heavy automatic task'
assert_field "$output" model gpt-6-astra
assert_field "$output" effort high
assert_field "$output" route_override heavy-context-floor

# The initial local heavy classification remains a floor even when the
# broader secondary keyword check would not have recognized the same task.
output="$(run_route 'Diagnose an intermittent ordering defect across asynchronous event consumers.')"
assert_field "$output" model gpt-6-astra
assert_field "$output" route_override heavy-context-floor

# A high-consequence local floor overrides Jev's cheaper selection and keeps
# the verified advisory visible in the output.
write_response '{"model":"jev-1.13.0","answers":{"route":{"type":"choice","choice":"gpt_6_luna__low","confidence":0.99}},"usage":{"input_tokens":21,"output_tokens":7}}'
rm -f "$WORK_DIR/called"
output="$(run_route 'Apply MFA requirements to administrator logins.')"
grep -Fx 'called' "$WORK_DIR/called" >/dev/null || die 'Jev was not called before a sensitive local safety floor'
assert_field "$output" model gpt-6-sol
assert_field "$output" effort high
assert_field "$output" route_override sensitive-risk-floor

# A factual repo summary must not turn ordinary words such as "lives" and
# "read-only" into a live operation or a request to read sensitive data.
for task in \
  $'Correct a typo in the command example in the README.\n\nRepository inspection (read-only factual summary): The example lives in README.md.' \
  $'Make the narrow-screen heading wrap instead of clipping.\n\nRepository inspection (read-only factual summary): The markup lives under app/components/.' \
  $'Correct a typo in the private fixture README.\n\nRepository inspection (read-only factual summary): The fixture is local.'; do
  output="$(run_route "$task")"
  assert_field "$output" route_source jev-choice
  assert_field "$output" model gpt-6-luna
  assert_field "$output" effort low
  assert_field "$output" route_override ''
done

# Explicit operational language still wins over a cheap Jev recommendation.
for task in \
  'Change the live deployment version.' \
  'Read a confidential document.'; do
  output="$(run_route "$task")"
  assert_field "$output" model gpt-6-sol
  assert_field "$output" effort high
  assert_field "$output" route_override sensitive-risk-floor
done

# A verified recommendation above the configured 0.70 floor is routed, even
# when its confidence would previously have been rejected at 0.80.
write_response '{"model":"jev-1.13.0","answers":{"route":{"type":"choice","choice":"gpt_6_luna__low","confidence":0.71}},"usage":{"input_tokens":21,"output_tokens":7}}'
rm -f "$WORK_DIR/called"
output="$(run_route 'Make a small CSS fix to the mobile pricing card.')"
grep -Fx 'called' "$WORK_DIR/called" >/dev/null || die 'Jev was not called for the above-floor task'
assert_field "$output" jev_status choice_routed
assert_field "$output" route_source jev-choice
assert_field "$output" model gpt-6-luna
assert_field "$output" effort low

# An unverified or below-floor result keeps the task moving with local
# classification. It does not require another helper call or user retry.
write_response '{"model":"jev-1.13.0","answers":{"route":{"type":"choice","choice":"gpt_6_astra__high","confidence":0.34}},"usage":{"input_tokens":21,"output_tokens":7}}'
rm -f "$WORK_DIR/called"
output="$(run_route 'Make a small CSS fix to the mobile pricing card.')"
assert_field "$output" jev_status choice_below_confidence
assert_field "$output" route_source local-fallback
assert_field "$output" model gpt-6-luna
assert_field "$output" effort xhigh

# Confidence comes from the selected model AND its selected effort branch.
# Uncertainty on unused branches must not suppress a route.
write_response '{"model":"jev-1.13.0","answers":{"route":{"type":"choice","choice":"gpt_6_sol__high","confidence":0.93}},"usage":{"input_tokens":21,"output_tokens":7}}'
jq '.answers.effort_gpt_6_sol.confidence = 0.82 | .answers.effort_gpt_6_luna = {type:"choice", choice:"low", confidence:0.1}' "$WORK_DIR/response.json" > "$WORK_DIR/edited.json"
mv "$WORK_DIR/edited.json" "$WORK_DIR/response.json"
rm -f "$WORK_DIR/called"
output="$(run_route 'Build a local task board with filtering and editable status columns.')"
assert_field "$output" route_source jev-choice
[[ "$(wc -l < "$WORK_DIR/called" | tr -d ' ')" == 1 ]] || die 'split routing made more than one HTTP request'
sed -n 's/^jev_diagnostics=//p' <<< "$output" | jq -e '.basis == "model_choice_with_separate_effort_gate" and .model == 0.93 and .effort == 0.82' >/dev/null || die 'component confidence was lost'
grep -F 'confidence=0.93;' <<< "$output" >/dev/null || die 'model confidence was altered'

jq '.answers.effort_gpt_6_sol.confidence = 0.69' "$WORK_DIR/response.json" > "$WORK_DIR/edited.json"
mv "$WORK_DIR/edited.json" "$WORK_DIR/response.json"
output="$(run_route 'Build a local task board with filtering and editable status columns.')"
assert_field "$output" jev_status choice_routed
assert_field "$output" route_source jev-choice
assert_field "$output" effort medium
assert_field "$output" route_override effort-confidence-floor

# A missing selected branch, invalid distribution, or unsupported choice
# cannot be promoted to a verified advisory.
cp "$WORK_DIR/response.json" "$WORK_DIR/valid.json"
for mutation in \
  'del(.answers.effort_gpt_6_sol)' \
  '.answers.model.choice = "gpt-reserve"' \
  '.answers.effort_gpt_6_sol.choice = "unsupported"' \
  'del(.answers.model.probabilities)' \
  '.answers.model.probabilities["gpt-6-sol"] = -1' \
  '.answers.model.confidence = 1.2'; do
  jq "$mutation" "$WORK_DIR/valid.json" > "$WORK_DIR/response.json"
  output="$(run_route 'Make a small CSS fix to the mobile pricing card.')"
  assert_field "$output" jev_status malformed_choice
  assert_field "$output" route_source local-fallback
done

# Manual overrides are explicit user model choices and bypass Jev.
rm -f "$WORK_DIR/called"
output="$(PATH="$WORK_DIR:$PATH" TYPESAFE_API_KEY='dummy-test-secret' CODEX_BIN=/usr/bin/true "$ROUTER" --route-only --hybrid --model gpt-6-astra 'Review this architecture')"
[[ ! -e "$WORK_DIR/called" ]] || die 'Jev ran despite the explicit model override'
assert_field "$output" model gpt-6-astra

# Retained public task-transport privacy regression checks.
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
write_response '{"model":"jev-1.13.0","answers":{"route":{"type":"choice","choice":"gpt_6_sol__high","confidence":0.93}},"usage":{"input_tokens":21,"output_tokens":7}}'
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


printf '%s\n' 'Global Jev routing contract checks passed.'
