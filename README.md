# ACB CLI

Command line tool to track adjusted cost base for Canadian stock trading.

## Features

- Multi-user support with encrypted SQLite databases
- Interactive TUI mode for easy navigation
- Inline commands for scripting
- Track stocks in CAD or USD (with automatic conversion)
- Calculate capital gains on sell transactions

## Installation

```bash
bun install
```

## Usage

### Interactive Mode

Launch the interactive terminal UI:

```bash
bun run start
```

Or directly:

```bash
bun run src/index.ts
```

### Inline Commands

**List portfolio:**
```bash
bun run src/index.ts list --user <username>
```

**List transactions for a stock:**
```bash
bun run src/index.ts list --user <username> --stock <ticker>
```

**Record a buy:**
```bash
bun run src/index.ts buy --user <username> --stock <ticker> --transaction <qty>x<price> --date <YYYY-MM-DD>
```

Example:
```bash
bun run src/index.ts buy --user simperreault --stock AAPL --transaction 10x150 --date 2026-01-01
```

**Record a sell:**
```bash
bun run src/index.ts sell --user <username> --stock <ticker> --transaction <qty>x<price> --date <YYYY-MM-DD>
```

### Options

- `--user <username>`: Required. The user account to use.
- `--stock <ticker>`: Stock ticker symbol.
- `--transaction <qty>x<price>`: Transaction in format "10x150" (10 shares at $150).
- `--date <date>`: Transaction date (YYYY-MM-DD or "today").
- `--fees <amount>`: Transaction fees (default: 0).
- `--password <password>`: Database password for encrypted accounts.

## Development

**Run tests:**
```bash
bun test
```

**Type check:**
```bash
bun run typecheck
```

**Watch mode:**
```bash
bun run dev
```

## Data Storage

User databases are stored at `~/.acb-cli/users/<username>.db`. Each user has their own encrypted SQLite database.

## Currency Conversion

USD stocks are automatically converted to CAD for ACB calculations. Currently using a hardcoded rate of 1.38 CAD/USD. Bank of Canada API integration is planned for future releases.

## License

MIT
