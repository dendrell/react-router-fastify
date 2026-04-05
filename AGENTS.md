# Agents Development Guide

## Commands

Use `pnpm` for installing packages and running commands.

Essential commands: `build`, `test`, `test:coverage`, `typecheck`, `publint`, `lint`, `format`,
`format:check`.

## Development Cycle

1. Make targeted changes in `src/`. Internal code lives under `./src/lib/`, anything exported to the
   public API lives under `./src/*.ts` root files.
2. Run `pnpm test` (or `pnpm test src/path/to/file.test.ts` while iterating).
3. Run `pnpm lint` before finishing (runs `typecheck` only).
4. If changes are substantial, run `pnpm test:coverage`.
5. If output/public API surface changes, run `pnpm build` (publint runs automatically as
   `postbuild`).
