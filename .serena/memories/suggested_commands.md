# Suggested Commands

## Build & Run
- `npx tsc --noEmit` - Type-check without emitting
- `npx tsc` - Build to dist/
- `npx tsx src/index.ts` - Run in dev mode
- `node dist/index.js` - Run production build

## Testing
- `npx vitest run --reporter verbose` - Run all tests
- `npx vitest run test_scripts/config.test.ts` - Run specific test file

## Dependencies
- `npm install` - Install dependencies

## Required Env Vars (ALL mandatory, no defaults)
LLM_PROVIDER, LLM_MODEL, LLM_API_KEY, DATABASE_PATH, WATCH_DIRECTORY, API_PORT, CONSOLIDATION_INTERVAL_MS
