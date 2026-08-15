# Submission Notes

## What I Would Test Next

These are future improvements beyond the current assignment scope:

- **Combined filtering and pagination**: `GET /tasks` currently short-circuits to full status filtering when `status` is present, ignoring `page`/`limit`. I would add tests and behavior for filtering *and* paginating together.
- **Stronger pagination validation**: `page`/`limit` rely on `parseInt(...) || default`, so `0`, negative, or non-numeric values collapse silently. I would add explicit bounds (minimum page 1, positive limit, optional max page size).
- **Protected/server-managed fields**: `PUT /tasks/:id` merges arbitrary body fields, allowing clients to overwrite `id`, `createdAt`, or `completedAt`. I would test and enforce restrictions on server-managed fields.
- **Unexpected error / 500 paths**: The global error handler in `app.js` is currently untested. I would add tests that force thrown exceptions (e.g. invalid UUID handling) to confirm the 500 contract.
- **Additional date and status edge cases**: malformed `dueDate` on update, timezone handling for `overdue`, and unknown/legacy status values in `getStats` and `getByStatus`.

## What Surprised Me

- **Pagination skipped the first page**: `getPaginated` used `offset = page * limit`, so page 1 returned items 11–20 instead of 1–10, and the first `limit` items were unreachable. Verified by tests and fixed to `(page - 1) * limit`.
- **Completing a task changed its priority**: `completeTask` hardcodes `priority: 'medium'`, silently discarding the task's original priority. This is documented as a bug in `BUG_REPORT.md` (not fixed, as only one fix was required).
- **Status filtering used substring matching**: `getByStatus` uses `status.includes(...)`, so `?status=do` matched both `todo` and `done`. Documented as a bug; exact-equality is the correct behavior.
- **The API uses an in-memory store**: All state lives in a module-level array and resets on restart. This shaped the test strategy (`_reset()` per test) and is a major production consideration.

## Questions Before Production

- What database or persistence layer will replace the in-memory store, and what are the migration implications for the current service signatures?
- What authentication and authorization model is required (e.g. API keys, OAuth, per-user scopes)?
- Should task reassignment be permitted by any user, or restricted by ownership/role permissions?
- What are the expected pagination and filtering semantics (1-based pages, combined filters, default/max limits)?
- What validation rules and standardized API error contract (status codes, error body shape) should all endpoints follow?
- What logging, monitoring, and rate-limiting requirements exist for a production deployment?
