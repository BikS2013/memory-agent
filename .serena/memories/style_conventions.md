# Style and Conventions

## Code Style
- ESM imports with .js extensions (e.g., `import { foo } from './bar.js'`)
- Strict TypeScript (strict: true, noUncheckedIndexedAccess: true)
- kebab-case for file names (e.g., ingest-agent.ts)
- PascalCase for classes/interfaces, camelCase for functions/variables
- UPPER_SNAKE_CASE for constants

## Configuration
- NO fallback/default values for config settings - throw exceptions
- All config from environment variables

## Database
- Singular table names: Memory, Consolidation, ProcessedFile
- camelCase column names
- Prepared statements for all queries

## Testing
- Tests in test_scripts/ directory
- Vitest framework
- In-memory SQLite (:memory:) for database tests
