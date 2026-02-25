# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A CLI tool for tracking Adjusted Cost Base (ACB) for Canadian stock trading. Supports both an interactive TUI mode (Ink/React) and inline commands (Commander.js).

**This is a financial application.** Users rely on it to correctly calculate capital gains for tax reporting to the CRA. A silent wrong result is the worst possible outcome — it's worse than a crash. Every code change touching calculations, data storage, or transaction processing must preserve correctness. When in doubt, fail loudly rather than produce a plausible-looking wrong number. The codebase has runtime invariant assertions, dual-path verification, and property-based tests specifically to catch these issues — do not weaken or bypass them.

## Commands

```bash
bun run start           # Run the app (TUI mode by default)
bun run dev             # Run with watch mode
bun test                # Run all tests
bun test --watch        # Run tests in watch mode
bun run typecheck       # TypeScript type checking
```

Single test file: `bun test tests/core/acb.test.ts`

## Architecture

**Entry Point** (`src/index.ts`): Routes between TUI mode (default) and inline commands based on CLI args.

**Modes**:
- TUI: React-based terminal UI using Ink (`src/ui/`)
- Inline: Commander.js commands (`src/cli/commands/`) for scripting: `buy`, `sell`, `list`

**Core Layers**:
- `src/core/acb.ts`: Pure ACB calculation functions (buy averages cost, sell calculates capital gains)
- `src/db/`: Drizzle ORM with SQLite, per-user databases stored at `~/.acb-cli/users/{username}.db`
- `src/db/repositories/`: Transaction and stock CRUD with automatic ACB snapshot tracking
- `src/services/`: User management, exchange rates (USD/CAD conversion)

**Data Model**: Stocks have transactions; each transaction creates a snapshot capturing ACB state at that point. Snapshots enable capital gain calculation on sells.

## Key Patterns

- All monetary values stored in both original currency and CAD
- ACB recalculation: `recalculateAcbFromTransactions()` can rebuild state from transaction history
- Database connections created per-user via `createDatabaseConnection({ username })`

## Validation

After making code changes, run both of these in the background:
- `bun run typecheck 2>&1 | head -50`
- `bun test 2>&1 | head -80`

## Setup

After cloning, configure git to use the committed hooks:
```bash
git config core.hooksPath .githooks
```
