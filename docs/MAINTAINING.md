# Maintaining Documentation

Runtime has a small hand-written guide and a generated API reference.

## Hand-Written Files

- [`README.md`](../README.md) is the package entry point.
- [`concepts.md`](./concepts.md) explains the core model.
- [`canonical-api.md`](./canonical-api.md) helps developers choose an entry point.
- [`architecture.md`](./architecture.md) defines package and state ownership.
- Focused guides explain interaction persistence, coordination, and Intelligence.

Keep these files short and current.
Delete superseded plans instead of preserving them beside the active API.

## Generated Files

TypeDoc generates `docs/api` from the source entry points in `typedoc.json`.
The primitive catalog is generated from public package exports.

Do not edit generated files by hand.
Change source comments or exports, then run:

```bash
pnpm run docs:api
```

## Required Check

```bash
pnpm run docs:check
```

This command rebuilds the package, regenerates API docs, checks that committed generated output matches, and runs deterministic documentation checks.

The checks require:

- every public export path to have a TypeDoc entry point;
- local Markdown links to resolve;
- retired API names to stay out of current guides and examples;
- hand-written Markdown to avoid em dashes;
- the generated primitive catalog to match current exports.

## Adding A Public Module

When adding a `package.json` export:

1. add its source file to `tsup.config.ts`;
2. add the same source file to `typedoc.json`;
3. add a label to `scripts/gen-primitive-catalog.mjs` when required;
4. regenerate `docs/api`;
5. add one focused example only when the existing examples do not cover the workflow.

## Removing An API

Remove the export, implementation, tests, generated docs, and every first-party caller together.
Do not add a compatibility alias unless an external consumer contract explicitly requires it.
