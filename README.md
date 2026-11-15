# borrower-sms-agent

A production-grade, compliance-first autonomous AI agent that drafts replies to borrower inbound SMS messages during loan collections and servicing.

Built with **Node.js**, **TypeScript (Strict Mode, Zero `any`)**, and **Zod** schema validation.

---

## Overview

In lending and debt collection operations, outbound borrower communications are strictly governed by federal regulations (e.g. TCPA, CFPB Regulation F). Every automated reply must be safe, legally compliant, auditable, and deterministic.

This service acts as an autonomous inbound SMS processor that:
1. **Validates Inbound Payloads**: Strict schema validation on `{ customerId, message, receivedAt, customerTimezone }`.
2. **Deterministic STOP Opt-Out**: Immediately catches opt-out keywords (e.g., `STOP`, `UNSUBSCRIBE`), invokes `markOptOut(customerId)`, suppresses outbound messaging (`action: "hold"`, `reply: ""`), and bypasses LLM invocation to prevent hallucinations.
3. **TCPA Quiet-Hours Enforcement**: Calculates local borrower time using IANA timezones. Messages outside 8:00 AM – 9:00 PM local time are automatically held (`action: "hold"`).
4. **Tool Execution over JSON Repository**: Provides type-safe tools (`getBalance`, `markOptOut`) operating over borrower records with in-memory test isolation.
5. **Decoupled Model Architecture**: The LLM sits behind an explicit interface (`ILLMClient`), allowing comprehensive deterministic testing via `FakeLLMClient` without third-party network dependencies.
6. **Structured Output Contract**: Guarantees `{ reply, toolCalls, action: "send" | "hold" | "handoff", reason }`, fully validated via Zod schemas.

---

## Architecture & Data Flow

```
                      Inbound SMS Payload
                               │
                               ▼
                    [InboundSMSSchema.parse]
                               │
               ┌───────────────┴───────────────┐
               │                               │
        Is Message "STOP"?                     │
               │                               │
         (Yes: Fast Path)                 (No: Standard)
               │                               │
       markOptOut(customerId)          Check Customer Record
               │                               │
        Return Action: "hold"           Invoke ILLMClient
         (reply: "", no LLM)                   │
                                        Execute Tools (getBalance, etc.)
                                               │
                                        TCPA Quiet-Hours Check
                                        (8am - 9pm borrower local time)
                                               │
                                        [AgentOutputSchema.parse]
                                               │
                                               ▼
                                      Structured Agent Output
```

---

## Project Structure

```
├── data/
│   └── customers.json       # Fixture database containing borrower records
├── src/
│   ├── types.ts             # Domain types & strict union types (zero 'any')
│   ├── schemas.ts           # Zod schemas for input, output, and tool call records
│   ├── repository.ts        # CustomerRepository with lazy auto-load & test isolation
│   ├── compliance.ts        # TCPA quiet-hours & opt-out keyword normalizer
│   ├── agent.ts             # Core SMSAgent orchestrator & compliance guardrails
│   ├── demo.ts              # Runnable verification demo of STOP and balance inquiry
│   ├── index.ts             # Barrel exports
│   └── llm/
│       ├── interface.ts     # ILLMClient contract
│       └── fake.ts          # FakeLLMClient for deterministic unit tests & spies
├── test/
│   └── agent.test.ts        # Node.js native test suite (zero test dependencies)
├── package.json             # ESM configuration and npm scripts
└── tsconfig.json            # Strict TypeScript configuration
```

---

## Getting Started

### Prerequisites
- Node.js 20 or newer (tested on Node.js v26)
- npm 10 or newer

### Installation
```bash
npm install
```

### Typecheck
Verify strict TypeScript compilation with zero `any` types:
```bash
npm run typecheck
```

### Running Tests
Executes the native test suite using Node.js built-in `node:test` and `node:assert/strict` (zero external test frameworks needed):
```bash
npm test
```

### Running the Live Demo
Executes [src/demo.ts](src/demo.ts) demonstrating both the deterministic STOP opt-out path and the model-driven balance inquiry:
```bash
npm run demo
```

---

## Schema Contracts

### Inbound SMS Input
```json
{
  "customerId": "cust_001",
  "message": "What is my current balance?",
  "receivedAt": "2026-11-15T15:00:00Z",
  "customerTimezone": "America/New_York"
}
```

### Structured Output
```json
{
  "reply": "Hi Sarah, your current balance is $1,450.00.",
  "toolCalls": [
    {
      "tool": "getBalance",
      "input": {
        "customerId": "cust_001"
      },
      "output": {
        "balance": 1450.0,
        "currency": "USD"
      }
    }
  ],
  "action": "send",
  "reason": "Customer requested loan balance, retrieved via getBalance tool."
}
```

---

## Test Scenarios Covered

1. **Borrower "STOP" Opt-Out**:
   - Calls `markOptOut(customerId)`.
   - Returns empty reply (`reply: ""`).
   - Sets `action: "hold"`.
   - Completely bypasses LLM invocation (0 invocations).
2. **Punctuation & Normalization**:
   - Handles `"STOP."` and `" stop! "` from mobile auto-complete gracefully.
3. **Model-Assisted Balance Inquiry**:
   - Injects `FakeLLMClient`.
   - Dispatches `getBalance` tool call.
   - Outputs validated draft with `action: "send"`.
4. **TCPA Quiet-Hours Override**:
   - Inbound SMS at 3:30 AM borrower local time.
   - Model drafts reply, but agent automatically overrides action to `"hold"`.
5. **Customer Not Found**:
   - Unknown customer IDs return `action: "handoff"` to prevent unauthenticated data leakage.
6. **LLM Fault Tolerance**:
   - Catches model API exceptions/timeouts and gracefully falls back to `action: "handoff"`.
