# Codex Model Router and Jev Guide

Desktop and CLI setup for macOS • October 3 2026

This package provides local Codex Desktop and CLI routing with optional TypeSafe Jev guidance. Jev recommends the parent model and reasoning effort through separate Choice questions; local safety floors produce the final route. After the manual parent handoff when required, the parent decides whether to delegate, selects each worker model and effort, and parallelizes useful independent tasks. This package makes no guarantee of task accuracy or subscription savings.

## How the Desktop workflow works

1. Send a new actionable task in a local Codex Desktop chat. Codex prepares the brief without expanding your scope and sends it once to the installed Jev helper.

2. When a confidence-qualified final Jev route differs from the active model or effort, Codex reports the recommendation and ends its turn. It performs no task research, file reads, edits, or implementation while waiting. If the active selection is unknown, the instruction also requires a pause for confirmation.

3. Open the Desktop model picker. Select the final recommended model and reasoning effort, then send “continue.” Codex resumes the same task without another Jev call unless the task materially changes.

4. If the accepted route already matches the active selection, work continues. If Jev is unavailable, malformed, or below the model confidence floor, the local policy continues without asking you to switch.

## What the pause looks like

Illustrative output only: Jev recommends GPT-6 Sol, High. Final recommendation: GPT-6 Sol, High. Model confidence: 0.91. Effort confidence: 0.87. Local override: none. Select GPT-6 Sol and High in the Desktop picker, then say “continue.”

## Scope and limits

The Desktop pause is an assistant instruction, not an application-level execution lock. The helper cannot change the Desktop picker. The CLI launcher can start a new CLI session with the selected model and effort. This package supports the local Mac workflow; it does not establish automatic native iPhone routing or cloud ChatGPT Work coverage.

# Parent routing and delegation

Jev's recommendation is for the parent model and reasoning effort. Complete the existing routing handoff before starting the main task or choosing delegation; when a pause is required, the user manually selects the displayed parent model and effort and says “continue” first.

Once execution resumes, the parent decides whether subagents are worthwhile and explicitly chooses each worker's model and reasoning effort. Assign smaller, well-defined tasks to suitable lighter models. Use stronger workers where complexity or risk warrants, including the same model as the parent when justified. Parallelize independent tasks when useful, avoiding duplicated work and conflicting edits. The parent remains responsible for integration, reviewing worker results, and final acceptance checks. Delegation does not change existing approval boundaries.

## Task context

Jev has no memory of earlier requests. Include the complete goal scope and current phase when routing a new phase of an ongoing goal. Do not rely on Jev to infer missing objectives, milestones, or dependencies from prior turns or a goal label. Ordinary unchanged continuations do not require another routing call.

## Choice response compatibility

This release aligns the public package to the maintained Choice implementation. It replaces the previous public Noul composition and multi-phase-goal thresholds. The helper returns jev.choice, jev.effort and separate confidence_details; accepted final routes use route.source = jev-choice. Consumers of jev.nouls, jev.details or jev-noul-composed must adapt. Model and effort confidence each have a 0.70 gate; low effort confidence uses the disclosed local effort floor. Update the helper, bridge, router, catalog and routing instruction together when installing this package.

## Public package boundaries

Public CLI hybrid routing requires a task brief on stdin and never sends forwarded Codex flags or positional arguments to Jev. Private phone gateways and authenticated remote tunnels are excluded. User settings, credential files, Keychain contents, logs, local usage records and evaluation captures are excluded. The installed router is not changed by downloading this source. The public helper also retains a 64 KiB socket response limit and the bridge permits at most two simultaneous recommendations.

# Install for local Codex Desktop

## Prerequisites

Use macOS with Codex Desktop and the Codex CLI installed, plus Bash, Node.js, jq, and curl. The helper needs Node.js even when you use Desktop only. Each user needs their own TypeSafe API key and access to the models they select. No key is supplied in this package. Codex remains the authority on account access.

## Store the TypeSafe key

In Keychain Access, select the login keychain and create a new password item. Set the Keychain Item Name to codex-route-typesafe, Account Name to your macOS short username, and Password to your TypeSafe API key. You can run id -un to find the short username. Approve macOS Keychain access if prompted.

The router looks for an explicit TYPESAFE_API_KEY first, then ~/.config/codex-route/typesafe.env, then the named Keychain item. The installed helper strips the caller environment, so Keychain is the preferred setup here. An existing credential file can take precedence over Keychain; review it privately if the wrong credential is used.

## Install the helper and instruction

1. Extract the source ZIP and open its repository folder as a local Codex project. You may ask Codex to perform the following installation steps; regular use is through Desktop.

```bash
bash ./install-global-jev-bridge.sh
```

2. Merge AGENTS_TEMPLATE.md into ~/.codex/AGENTS.md, preserving unrelated instructions and replacing any older conflicting Jev rule. Do not copy the template over the entire file blindly. The installer installs code only; it does not merge this instruction for you.

3. The installation places code and the catalog in ~/.codex/jev-router and commands in ~/.local/bin. settings.json contains only non-secret Keychain metadata. The helper can run directly without a persistent bridge process.

4. The supplied instruction uses GPT-6 Luna at Extra High as the starter preference. Select that default in your own Desktop settings if available. The installer does not change your Desktop default or active model.

5. Start a fresh local chat so it loads the global instruction, then try a real task. Confirm the chat displays both the model and reasoning effort and stops when the qualified route differs. Also try another project to check instruction loading there.

# Use the helper and CLI

## Check the helper without starting work

```bash
printf '%s\n' 'Build a local project board with saved tasks' | ~/.local/bin/jev-route
```

The JSON result separates Jev’s choice from the final recommendation. A valid typed result has jev.verified true, but that alone does not mean the confidence floor was met. route.source equal to jev-choice identifies a qualified Jev route. Inspect recommendation.model, recommendation.effort, route.override, and jev.confidence_details.

## Preview a CLI recommendation

```bash
printf '%s\n' 'Add a project search filter' | ./codex-route --dry-run --hybrid
```

This asks Jev and prints the selected route without starting Codex. Review the recommendation, then use the launch command below when ready.

## Start a new CLI session

```bash
printf '%s\n' 'Add a project search filter' | ./codex-route --hybrid
```

This makes a new routing call and launches Codex with the resulting model and effort. The CLI does not stop for the Desktop picker; it passes the choice to the new process. Omit --hybrid for local keyword routing only. Keep the script beside its catalog, or use the globally installed command. Supply hybrid task text on stdin; forwarded Codex flags and positional arguments stay local.

## Use an explicit override

```bash
./codex-route --lane luna "Adjust this card spacing"
```

```bash
./codex-route --model gpt-6-sol "Review this implementation"
```

Explicit lane or model overrides bypass Jev. Do not combine --lane and --model. If codex is not on PATH, set CODEX_BIN to its executable path. Run ./codex-route --help for the command options.

## Change a task while paused

Send the revised task instead of “continue.” Codex should refine and route the revised scope before execution. Ordinary discussion, status questions, acknowledgments, and unchanged continuations do not require another Jev call.

# Understand the recommendation

## What Jev receives

Each request sends the task brief, detailed routing criteria, and saved model reference text directly in the request. Jev does not need to open links and is not assumed to remember earlier requests. The catalog contains detailed facts written from official documentation; it is not an exact reproduction of the source pages.

The saved catalog covers GPT-6 Astra, GPT-6.1 Sol, GPT-6 Sol, GPT-6 Luna, GPT-5.6 Sol, GPT-5.6 Terra, GPT-5.6 Luna, and GPT-5.5. GPT-Reserve is excluded. The router offers eligible models as direct choices and asks a separate conditional effort question for each eligible model in the same HTTP call. It reads only the effort answer associated with the chosen model. The local Codex cache supplies availability information when present; the catalog must be maintained as models change.

## Confidence and local rules

The model choice must score at least 0.70. Effort has its own 0.70 floor. If the model qualifies but effort does not, the model can be retained with a disclosed local minimum that favors allowance conservation, reported as effort-confidence-floor. If model confidence is too low, local model routing applies. High-consequence and heavy-work rules can raise the final route above Jev’s advice.

Confidence is the returned Choice score, not a demonstrated probability that the task will succeed. Jev is instructed to conserve included Codex allowance by using Luna and the lowest sufficient effort when they meet the quality bar. API prices are not a proxy for subscription usage. Credit-rate data applies only to eligible credit-billed usage and does not estimate included Plus or Pro weekly allowance exactly.

## Troubleshooting

No Jev recommendation: check Node.js, jq, curl, the Keychain service and account, and credential-file precedence. An inaccessible login keychain or network failure can produce a local fallback. Do not print your credential while diagnosing.

No Desktop pause: inspect route.source first. Fallbacks and matching accepted routes intentionally continue. For a qualified differing route, confirm a fresh chat loaded ~/.codex/AGENTS.md and that no conflicting instruction overrides it.

Model unavailable: select an available model explicitly and update the catalog and policy before relying on automatic routing. A cache is not proof of current entitlement.

The task brief is sent to TypeSafe. Keep credentials and secrets out of it. No Keychain database, local settings, session logs, private network address, or personal project data is included in this release package.

# Source code and sharing

## Included files

The accompanying ZIP contains the complete executable router, saved model catalog, Node helper, local socket bridge, macOS installer, AGENTS_TEMPLATE.md, this guide, README.md, and offline router and bridge checks. Use the source files directly; the Word document is the setup guide rather than a place to copy long scripts.

## Optional local checks

```bash
bash ./test-hybrid-router.sh
```

```bash
node --test ./test-jev-keychain-bridge.mjs
```

These checks use local fixtures and mocks. They check routing behavior and bridge contracts, not general model-selection accuracy, native Desktop compliance, or another user’s account access.

## Official OpenAI references

Model catalog: https://developers.openai.com/api/docs/models

- GPT-6 Astra: https://developers.openai.com/api/docs/models/gpt-6-astra
- GPT-6 Sol: https://developers.openai.com/api/docs/models/gpt-6-sol
- GPT-6.1 Sol: https://developers.openai.com/api/docs/models/gpt-6.1-sol
- GPT-6 Luna: https://developers.openai.com/api/docs/models/gpt-6-luna
- GPT-5.6 Sol: https://developers.openai.com/api/docs/models/gpt-5.6-sol
- GPT-5.6 Terra: https://developers.openai.com/api/docs/models/gpt-5.6-terra
- GPT-5.6 Luna: https://developers.openai.com/api/docs/models/gpt-5.6-luna
- GPT-5.5: https://developers.openai.com/api/docs/models/gpt-5.5
## Project links

Source repository: https://github.com/Bulato597-data/codex-jev-router

Current source ZIP: https://github.com/Bulato597-data/codex-jev-router/archive/refs/heads/main.zip

## License

This project is available under the MIT License. See LICENSE.
