# Contributing to Document Exporter

Thanks for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/rogerdigital/document-exporter.git
cd document-exporter
npm install
npm run dev
```

## Testing

```bash
npm test
npm run test:watch
```

## Building

```bash
npm run build
```

## Submitting Changes

1. Fork the repo and create a feature branch from `main`
2. Make your changes with clear, descriptive commits (conventional commits: `feat:`, `fix:`, `chore:`, `docs:`)
3. Add tests for new functionality
4. Ensure `npm run build` and `npm test` pass
5. Open a pull request against `main`

## Reporting Issues

Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Obsidian version and OS

## Code Style

- TypeScript strict mode
- Use `@/` path alias for imports
- Tests live alongside source (`*.test.ts`)
- Duck-typing over `instanceof` for testability
