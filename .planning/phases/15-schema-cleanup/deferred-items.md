# Deferred Items — Phase 15

## Pre-existing TypeScript Build Error

**File:** `src/actions/agent-config-actions.ts:25`
**Error:** `Type 'InputJsonValue | undefined' is not assignable to type 'string | NullableStringFieldUpdateOperationsInput | null | undefined'`
**Cause:** `Prisma.InputJsonValue` type used for a SQLite string field — Prisma's SQLite adapter doesn't support JSON native types so the type mismatch exists.
**Status:** Pre-existing before Phase 15 started (exists in commit 7fb3ce9)
**Impact:** Build fails with TypeScript error but runtime works correctly
**Action needed:** Fix in a future cleanup phase — replace `Prisma.InputJsonValue` with `string | null` or use proper type assertion
