# MikroORM bug repro: phantom changeset for nullable flattened @Embedded when fieldName contains an underscore

## Bug

When a `@Embedded` property is:

- `prefix: false` (flattened columns)
- `nullable: true`
- its `fieldName` contains an underscore (e.g. `comment_template`)

...and the entity is loaded via `joined` populate strategy through a `OneToOne` relation,
`flush()` produces a phantom changeset for that field even though nothing was changed.
The changeset payload contains `undefined`, which results in an `UPDATE` with no columns
in the `SET` clause, and Postgres throws:

```
DriverException: No data provided
```

Renaming the `fieldName` to something without an underscore (e.g. `commenttemplate`)
makes the bug disappear, with no other code changes. Using `strategy: 'select-in'`
instead of the default `joined` strategy also avoids the bug.

## Setup

Requires Docker and Node.js.

```bash
docker run -d --name mikro-repro-pg \
  -e POSTGRES_USER=test \
  -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=test \
  -p 5433:5432 \
  postgres:16-alpine

npm install
```

## Run

```bash
npm run repro
```

## Expected output

```
hydrated value: CommentTemplate { value: 'hello' }
--- changesets before flush ---
[]
--- calling flush() with no changes made ---
flush succeeded without error (bug NOT reproduced)
```

## Actual output

```
hydrated value: CommentTemplate { value: 'hello' }
--- changesets before flush ---
[
  {
    entityName: 'Child',
    type: 'update',
    payload: { commentTemplate: undefined }
  }
]
--- calling flush() with no changes made ---
flush failed as expected (bug reproduced): DriverException: No data provided
```

## To confirm the workaround

In `repro.ts`, change:

```ts
{ populate: ["child"], strategy: "joined" }
```

to:

```ts
{ populate: ["child"], strategy: "select-in" }
```

and re-run — the changeset list will be empty and `flush()` will succeed.

## To confirm the underscore is the trigger

In `repro.ts`, change the `fieldName` from `comment_template` to `commenttemplate`
(update the `create table` DDL to match), and re-run with `strategy: "joined"` —
the bug disappears.

## Versions

- `@mikro-orm/core`: 7.1.5
- `@mikro-orm/postgresql`: 7.1.5
- node: 25.9.0
- OS: macOS
