# Codex Model Router and Jev Guide

Desktop and CLI setup for macOS • September 30 2026

This package helps Codex users choose a model and reasoning effort for a new task. Codex refines the request into a concise brief, Jev evaluates independent, explicitly defined Noul statements against the task and saved model reference, and deterministic local rules combine those probabilities into the final recommendation. The aim is the lightest model and effort sufficient for the complete task without sacrificing quality.

## How the Desktop workflow works

1. Send a new actionable task in a local Codex Desktop chat. Codex prepares the brief without expanding your scope and sends it once to the installed Jev helper.

2. When a validated set of Jev Noul answers is composed into a final route that differs from the active model or effort, Codex reports the recommendation and ends its turn. It performs no task research, file reads, edits, or implementation while waiting. If the active selection is unknown, the instruction also requires a pause for confirmation.

3. Open the Desktop model picker. Select the final recommended model and reasoning effort, then send “continue.” Codex resumes the same task without another Jev call unless the task materially changes.

4. If the composed route already matches the active selection, work continues. If Jev is unavailable or returns malformed answers, the local policy continues without asking you to switch.

## What the pause looks like

Illustrative output only: Jev reports `complex_agentic_coding: 0.91`. Local composition selects GPT-6.1 Sol, High. Local override: none. Select GPT-6.1 Sol and High in the Desktop picker, then say “continue.” Noul values are probabilities for their stated facts, not confidence scores.

## Scope and limits

The Desktop pause is an assistant instruction, not an application-level execution lock. The helper cannot change the Desktop picker. The CLI launcher can start a new CLI session with the selected model and effort. This package supports the local Mac workflow; it does not establish automatic native iPhone routing or cloud ChatGPT Work coverage.

# Install for local Codex Desktop

## Prerequisites

Use macOS with Codex Desktop and the Codex CLI installed, plus Bash, Node.js, jq, and curl. The helper needs Node.js even when you use Desktop only. Each user needs their own TypeSafe API key and access to the models they select. No key is supplied in this package. Codex remains the authority on account access.

## Store the TypeSafe key

In Keychain Access, select the login keychain and create a new password item. Set the Keychain Item Name to codex-route-typesafe, Account Name to your macOS short username, and Password to your TypeSafe API key. You can run id -un to find the short username. Approve macOS Keychain access if prompted.

The router looks for an explicit TYPESAFE_API_KEY first, then ~/.config/codex-route/typesafe.env, then the named Keychain item. The installed helper strips the caller environment, so Keychain is the preferred setup here. An existing credential file can take precedence over Keychain; review it privately if the wrong credential is used.

## Install the helper and instruction

1. Extract the ZIP and open its codex-model-router folder as a local Codex project. You may ask Codex to perform the following installation steps; regular use is through Desktop.

```bash
bash ./install-global-jev-bridge.sh
```

2. Open AGENTS_TEMPLATE.md as a Markdown text file and merge its instructions into ~/.codex/AGENTS.md, preserving unrelated instructions and replacing any older conflicting Jev rule. Do not copy the template over the entire file blindly. The installer installs code only; it does not merge this instruction for you.

3. The installation places code and the catalog in ~/.codex/jev-router and commands in ~/.local/bin. settings.json contains only non-secret Keychain metadata. The helper can run directly without a persistent bridge process.

4. The supplied instruction uses GPT-6 Luna at Extra High as the starter preference. Select that default in your own Desktop settings if available. The installer does not change your Desktop default or active model.

5. Start a fresh local chat so it loads the global instruction, then try a real task. Confirm the chat displays both the model and reasoning effort and stops when a composed route differs. Also try another project to check instruction loading there.

# Use the helper and CLI

## Check the helper without starting work

```bash
printf '%s\n' 'Build a local project board with saved tasks' | ~/.local/bin/jev-route
```

The JSON result separates validated Jev Noul answers from the final recommendation. `jev.verified: true` means every expected atomic answer passed schema validation; it does not mean the selected route is likely to succeed. Inspect `jev.nouls`, `jev.details.threshold_policy`, `recommendation.model`, `recommendation.effort`, `route.source`, and `route.override`.

## Preview a CLI recommendation

```bash
printf '%s\n' 'Add a project search filter' | ./codex-route --dry-run --hybrid
```

This asks Jev and prints the selected route without starting Codex. Review the recommendation, then use the launch command below when ready.

For every hybrid CLI launch, provide the task brief on standard input. The router sends only that brief to Jev; it never forwards Codex option values or positional arguments. Jev has no memory, so a new routing request for an ongoing goal must include the complete goal scope and current phase when those details affect the route. A hybrid launch with no stdin brief stops with an error. For sensitive task text, enter it through a protected file or editor rather than a shell command, because shell commands can be saved in history.

## Start a new CLI session

```bash
printf '%s\n' 'Add a project search filter' | ./codex-route --hybrid
```

This makes a new routing call and launches Codex with the resulting model and effort. The CLI does not stop for the Desktop picker; it passes the choice to the new process. Omit --hybrid for local keyword routing only. Keep the script beside its catalog, or use the globally installed command.

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

Each request sends the complete task brief, an explicit no-memory boundary, criteria for fifteen independent Noul questions, the deterministic composition rubric, and saved model reference text directly in the request. Jev cannot retrieve earlier requests or stored goals, supply missing objectives, or invent criteria. The catalog contains detailed facts written from official documentation; it is not an exact reproduction of the source pages.

The saved catalog covers GPT-6 Astra, GPT-6.1 Sol, GPT-6 Sol, GPT-6 Luna, GPT-5.6 Sol, GPT-5.6 Terra, GPT-5.6 Luna, and GPT-5.5. GPT-Reserve is excluded. In one HTTP call, Jev evaluates fifteen independent Noul questions in parallel against the same task state. Local code applies the explicit thresholds and composition table; Jev does not select a model or effort. The local Codex cache supplies availability information when present; the catalog must be maintained as models change.

## Noul thresholds and local rules

A Noul value is the 0–1 probability that its one stated condition is true. Values at or above 0.70 count as positive; values at or below 0.30 count as negative; the middle band is uncertain and routes to GPT-6 Sol at medium unless a higher-priority positive signal applies. These are initial router policy thresholds, not TypeSafe-provided confidence scores or calibrated success probabilities. The composition table selects Astra for positive frontier signals or when both defined multi-phase-goal conditions are positive, GPT-6.1 Sol for its complex-coding or computer-use signal, Sol for standard substantial-work signals, and Luna when all signals are negative. Deterministic local classification and sensitive/heavy safety floors remain final.

### Multi-phase goal boundary

A long timeline or the words “goal” or “plan” do not make work complex. Jev has no memory, so these questions use only the complete goal and current phase included in this request. The router asks two separate yes/no questions: does the full outcome require **at least three substantive delivery milestones**, and do later milestones **materially depend on decisions or validated outputs from earlier milestones**? Each stage must represent a meaningful deliverable, not a checklist step. Both Noul probabilities must meet the 0.70 positive threshold to route to GPT-6 Astra at high effort. A separate `incomplete_goal_context` Noul asks whether the request refers to an ongoing goal phase but omits the full scope. A positive result routes to GPT-6 Sol at medium unless a stronger positive signal applies; Jev must not guess the missing goal from prior turns or memory. Any uncertain Noul also routes to GPT-6 Sol at medium unless a stronger positive signal applies. Two or more of the four separate frontier signals are still required for xhigh; multi-phase status by itself never raises Astra to xhigh.

TypeSafe’s [Confidence guide](https://docs.typesafe.ai/confidence) explains that Choice and Score confidence comes from their output distributions; Noul does not return confidence. Its [coding-agents guide](https://docs.typesafe.ai/introduction/coding-agents) describes Jev as a structured decision component used inside a coding agent, not a replacement for the coding-agent model. The router uses Noul probabilities only for the stated independent conditions, not as a demonstrated probability that the task will succeed. Local composition is explicit so the subscription-allowance preference can be inspected and changed in code. The router preserves included Codex subscription allowance: prefer GPT-6 Luna at the lowest effort that meets the task’s quality and verification needs, and use Sol or Astra only when their added capability is needed. OpenAI says allowance use varies with model, task, and settings; higher reasoning effort can consume more allowance without guaranteeing a better result. The catalog provides Standard-mode credit rates for all eight models as a directional signal for eligible credit-billed usage: GPT-6 Luna is 2.5 / 0.25 / 12.5 credits per million input / cached-input / output tokens, GPT-6.1 Sol is 50 / 2.5 / 250, and GPT-6 Sol is 50 / 5 / 250. These credit rates do not give an exact per-task conversion for included subscription allowance. API token prices are not used as a proxy for subscription use. This package makes no guarantee of task accuracy or subscription savings. See [OpenAI’s included Work and Codex allowance guidance](https://help.openai.com/en/articles/20001516-managing-usage-with-gpt-6-astra-in-work-and-codex) and the [Codex credit rate card](https://help.openai.com/en/articles/11481834-chatgpt-rate-card-business-enterpriseedu-credit-based-pricing).

## Troubleshooting

No Jev recommendation: check Node.js, jq, curl, the Keychain service and account, and credential-file precedence. An inaccessible login keychain or network failure can produce a local fallback. Do not print your credential while diagnosing.

No Desktop pause: inspect route.source first. Fallbacks and matching accepted routes intentionally continue. For a differing composed route, confirm a fresh chat loaded ~/.codex/AGENTS.md and that no conflicting instruction overrides it.

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

- Source repository: https://github.com/Bulato597-data/codex-jev-router
- Ready-to-extract ZIP: https://github.com/Bulato597-data/codex-jev-router/releases/latest/download/Codex-Model-Router-Public-Package.zip

## License

This project is available under the MIT License. See [LICENSE](LICENSE).
