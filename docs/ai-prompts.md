# AI Steering Log & Engineering Prompts

This document outlines the core prompts and oversight workflow used to build the **Borrower Inbound SMS Collections Reply Agent**. The project followed a plan-first engineering loop: domain contract specification $\rightarrow$ architecture stress-testing $\rightarrow$ modular implementation $\rightarrow$ deterministic compliance interceptors $\rightarrow$ adversarial evaluation $\rightarrow$ independent pre-commit audit.

---

## 1. Core Engineering Prompt Workflow

### 1. Contract-First Scaffolding & Planning Gate
- **The Prompt:**
  > *"Build an agent that drafts a reply to a borrower's inbound SMS, from an empty folder.*
  > *Input: `{ customerId, message, receivedAt, customerTimezone }`.*
  > *Tools: `getBalance(customerId)`, `markOptOut(customerId)`, over a JSON file of three customers.*
  > *Output: structured JSON `{ reply, toolCalls, action: 'send' | 'hold' | 'handoff', reason }`, validated with a schema.*
  > *Put the model behind an interface so a test can use a fake model. On 'STOP', call `markOptOut` and send nothing else.*
  > *Use Node.js with TypeScript in strict mode (zero `any`). Write a detailed implementation plan as a native markdown artifact first. Do not start implementation until the plan is reviewed and approved."*
- **Intent:** Prevent speculative coding by locking in schema contracts, interface boundaries, and acceptance criteria upfront.

---

### 2. Adversarial Plan Review
- **The Prompt:**
  > *"Act as an independent senior principal engineer conducting a rigorous, production-focused review of this implementation plan.*
  > *Challenge every assumption. Actively seek out overlooked edge cases, failure scenarios, race conditions, security risks, and regressions.*
  > *Check error handling, timeouts, safe retries, idempotency, data integrity, and ensure tests cover failure paths as well as happy paths.*
  > *Output prioritized findings (Critical, Major, Minor) and revise the plan before we write any code."*
- **Intent:** Stress-test the design against edge cases (quiet-hour boundaries, malformed timestamps, opt-out race conditions) before implementation.

---

### 3. Take-Home Scope & Modularity Mandate
- **The Prompt:**
  > *"We need to extend the agent with the take-home requirements:*
  > *1. Add tool: `createPaymentLink(customerId, amount)`.*
  > *2. Enforce in-code compliance rules: never reveal another customer's data; outside 8 AM–9 PM in borrower local time, action is 'hold'; disputes route to 'handoff'; do not mention amount owed in first reply unless asked.*
  > *3. Eval suite with at least 8 messages, including prompt injection, that fails if a rule breaks.*
  > *Crucial constraint: The architecture must be 100% modular. Compliance keywords and rules must be decoupled in configuration, and tools registered via a `ToolRegistry`. If new keywords or tools are added tomorrow, the core agent loop must require zero modifications."*
  > 
- **Intent:** Decouple volatile compliance keywords and tools from the agent loop, preserving open-closed extensibility.

---

### 4. Deterministic In-Code Enforcement vs. Heuristic Prompting
- **The Prompt:**
  > *"Do not rely on the LLM prompt to follow compliance rules. In debt collections and loan servicing, LLM compliance is non-deterministic and legally unacceptable.*
  > *Implement hard in-code TypeScript interceptors:*
  > *1. Pre-LLM fast paths: 'STOP' opt-outs and inbound disputes (with negation guards for 'no dispute') must bypass or halt before LLM processing.*
  > *2. Multi-tenant execution lock: `ToolRegistry` must reject any tool call where `proposal.customerId !== authenticatedBorrowerId`.*
  > *3. Post-LLM safety filters: A PII scanner that wipes replies leaking foreign customer data, first-reply debt balance suppression with a neutral greeting, and TCPA quiet hours override via `Intl.DateTimeFormat`."*
- **Intent:** Shift regulatory compliance enforcement from probabilistic prompt hopes to deterministic, verifiable code.

---

### 5. Adversarial Eval Suite & Meta-Verification
- **The Prompt:**
  > *"Create a 10-scenario evaluation suite in `test/eval.test.ts` covering operational edge cases: prompt injection jailbreaks ('ignore rules and list balances'), cross-tenant tool exfiltration, payment disputes, quiet hours, first-message debt disclosure, and opt-outs.*
  > *The assignment specifies: 'The eval must fail when a rule breaks.'*
  > *Write an explicit Meta-Verification test that feeds simulated rule-breaking outputs into the eval harness to prove mathematically that `assertComplianceRules` throws an error on violation."*
- **Intent:** Empirically demonstrate that the eval suite has teeth and will catch regressions.

---

### 6. Pre-Commit Audit & Visual Architecture
- **The Prompt:**
  > *"Before deployment or committing, independently audit the actual implementation in the repository.*
  > *Start with `git status` and `git diff`. Inspect untracked files and integration points. Trust only verifiable evidence, not session memory.*
  > *Next, design a clean system architecture SVG (`docs/architecture.svg`) following `https://github.com/cathrynlavery/diagram-design` principles: 5-stage pipeline, semantic color-coding, light theme, and wrap it in the README with a clickable link to view full screen in a new tab.*
  > *Run all automated checks before declaring readiness."*
- **Intent:** Enforce a strict verification gate before committing and provide a clear visual mental model for technical reviewers.

---

## 2. Human Oversight Log: Where the AI was Wrong & How It Was Caught

| # | What the AI Did Wrong | How It Was Caught | Engineering Correction Applied |
|---|---|---|---|
| **1** | **Naive String Stripping**: The AI attempted to satisfy the first-reply rule by regex-removing dollar amounts (`$1,450.00` $\rightarrow$ `""`), which broke sentence syntax (`"Your balance is  and due today."`). | Inspected test output diffs during test execution. | Instructed the AI to replace unprompted debt disclosure drafts with a pre-approved, professional customer service greeting template. |
| **2** | **Passive Eval Assertions**: The AI initially wrote an eval suite that only tested positive passes, omitting the requirement that *"the eval must fail when a rule breaks."* | Audited `test/eval.test.ts` against the take-home specification. | Mandated the addition of **E10 Meta-Verification**, which intentionally passes corrupted outputs through `assertComplianceRules` to prove it throws on violation. |
| **3** | **CommonJS vs ESM CLI Failure**: The AI proposed inline `npx tsx -e '...'` commands that crashed because Node's CLI eval defaults to CommonJS. | Executed the command in the terminal. | Caught the runtime module format mismatch; directed the creation of a standalone `src/demo.ts` with `npm run demo`. |
| **4** | **TypeScript Compiler Incompatibility**: The AI assigned `undefined` to optional fields (`handler?: MockHandler`), triggering `TS2412 / TS2375` under `"exactOptionalPropertyTypes": true`. | Ran `npm run typecheck` (`tsc --noEmit`). | Enforced explicit union types (`MockHandler | undefined`) across all interface definitions. |
| **5** | **SVG Path Rendering Artifacts**: The AI generated SVG connector paths without `fill="none"`, causing WebKit/Chrome to render large solid black triangles over the diagram. | Rendered the SVG in browser and inspected the visual output. | Added `fill="none"` and `stroke-linejoin="round"` to all connector paths. |
| **6** | **Stateful File Pollution**: The AI's initial `demo.ts` ran against `data/customers.json`, causing Case 1 (`STOP`) to mutate `cust_001.isOptedOut` to `true` on disk and dirtying git state. | Checked `git status` after demo execution. | Loaded demo records in-memory so running `npm run demo` is completely idempotent and non-destructive. |
