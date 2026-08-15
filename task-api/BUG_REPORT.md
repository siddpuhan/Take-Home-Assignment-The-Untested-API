# Bug Report

This report documents bugs discovered during the testing phase of the
Task Manager API. Each bug is supported by the existing source code
(`src/`) and by the assertions in our test suite (`tests/taskService.test.js`,
`tests/routes.test.js`). No production code was modified.

---

## Bug 1 — Pagination offset is calculated as `page * limit`

**Status: Fixed**

### 1. Title
Pagination off-by-one: the first page of results is never returned.

### 2. Location
- `src/services/taskService.js` — `getPaginated()` (lines 11–14)
- `src/routes/tasks.js` — `GET /tasks` query parsing (lines 19–24)

### 3. Expected behavior
`GET /tasks?page=1&limit=10` (and `page` omitted, which conventionally means
page 1) should return the **first** `limit` tasks. `page=2` should return the
second page, and so on.

### 4. Actual behavior
`getPaginated(page, limit)` computes `offset = page * limit` and slices
`tasks.slice(offset, offset + limit)`.

- Because `offset = page * limit`, a request for **page 1** produces
  `offset = 1 * limit`, which **skips the first `limit` items** and returns
  items `limit+1` through `2*limit` instead of items 1 through `limit`.
- In the route (`src/routes/tasks.js`), `pageNum = parseInt(page) || 1` and
  `limitNum = parseInt(limit) || 10`. Since `parseInt(undefined)` is `NaN` and
  `0 || 1`…, any request that omits `page` (or passes `0`) collapses to
  `page = 1`, which then yields `offset = 1 * limit`. As a result, **the first
  `limit` tasks are unreachable through the API** — e.g. `GET /tasks?limit=10`
  returns tasks 11–20 rather than tasks 1–10.

### 5. How the bug was discovered through testing
- `tests/routes.test.js` → "GET /tasks?page=...&limit=..." →
  "KNOWN BEHAVIOR (suspected bug): page defaults to 1 via parseInt(...) || 1,
  so first item is unreachable": requesting `?limit=10` returns `t11` as the
  first element, proving offset starts at 10 rather than 0.
- `tests/routes.test.js` → "KNOWN BEHAVIOR (suspected bug): page=1 skips the
  first page": `?page=1&limit=10` returns tasks 11–20.
- `tests/taskService.test.js` → "KNOWN BEHAVIOR (suspected bug): offset uses
  page*limit, so page=1 skips the first limit items": `getPaginated(1, 10)`
  returns `task 11` first.

### 6. Root cause
The offset formula in `getPaginated` adds the current page's worth of items to
the offset, instead of the number of already-consumed pages. Pagination is
1-indexed in the API, so the offset for page `p` should be `(p - 1) * limit`.
The route-level `parseInt(page) || 1` default compounds this by making
`page` effectively `1` (never `0`) whenever it is missing or falsy.

### 7. Proposed fix
- In `taskService.getPaginated`, use `const offset = (page - 1) * limit;`
- In `src/routes/tasks.js`, parse `page`/`limit` so that `1` is the minimum
  sensible page and `limit` is clamped to a positive default (e.g. treat
  `page < 1` as `1`, and fall back to `10` only when the value is genuinely
  absent/invalid rather than `0`).

### 8. Severity / impact
**High.** Pagination is a core listing feature. As written, clients can never
retrieve the first page of results, and page numbers do not correspond to
intuitive page boundaries. This will silently drop the earliest tasks from any
paginated listing.

### 9. Fix
Changed pagination offset from `page * limit` to `(page - 1) * limit`.

### 10. Regression coverage
Added unit and integration tests covering page 1, page 2, page 3,
partial pages, out-of-range pages, and omitted/invalid pagination values.

### 11. Verification
62 tests passing, 0 failures, 94.77% statement coverage.

---

## Bug 2 — Status filtering uses substring matching

### 1. Title
`getByStatus()` matches by substring (`.includes()`) instead of exact equality.

### 2. Location
- `src/services/taskService.js` — `getByStatus()` (line 9)

### 3. Expected behavior
Filtering by status should return only tasks whose `status` is **exactly** the
requested value (e.g. `?status=done` returns only `done` tasks).

### 4. Actual behavior
`getByStatus(status)` returns `tasks.filter((t) => t.status.includes(status))`.
Because `.includes()` performs substring containment, a query for `"do"`
matches any status string containing `"do"` — which includes both `"todo"`
and `"done"`. Similarly `"in"` matches `"in_progress"`.

### 5. How the bug was discovered through testing
- `tests/taskService.test.js` → "KNOWN BEHAVIOR (suspected bug): uses
  substring matching via .includes()": `getByStatus('do')` returns 2 tasks
  (`'todo'` and `'done'`), and `getByStatus('in')` returns 1 task
  (`'in_progress'`).
- `tests/routes.test.js` → "GET /tasks?status=..." → "KNOWN BEHAVIOR (suspected
  bug): substring matching via .includes()": `GET /tasks?status=do` returns 2
  tasks (`'todo'` and `'done'`), not just `'done'`.

### 6. Root cause
The filter predicate uses `String.prototype.includes()` (substring test)
where an exact-equality comparison (`===`) is required for an enum-style field
like `status`.

### 7. Proposed fix
Change the predicate to exact equality:
`t.status === status`. Optionally validate that the requested `status` is one
of the known values (`todo`, `in_progress`, `done`) and return an empty list
(or `400`) for unknown statuses.

### 8. Severity / impact
**Medium/High.** Status is a defined enum. Substring matching produces
incorrect, over-broad result sets and makes filtering unreliable for any
caller that assumes exact matching — e.g. a dashboard filtering "done" tasks
would also surface "todo" tasks. It also risks matching unintended future
status values that happen to contain the queried substring.

---

## Bug 3 — Completing a task changes its priority

### 1. Title
`completeTask()` overwrites the task's `priority` with `"medium"`.

### 2. Location
- `src/services/taskService.js` — `completeTask()` (line 69)

### 3. Expected behavior
Marking a task complete should update its completion state (`status` →
`done`, `completedAt` set to a timestamp) **without changing unrelated fields**
such as `priority`.

### 4. Actual behavior
`completeTask()` builds the updated object as:
```
{
  ...task,
  priority: 'medium',
  status: 'done',
  completedAt: new Date().toISOString(),
}
```
The hardcoded `priority: 'medium'` discards the task's previous priority
regardless of its original value.

### 5. How the bug was discovered through testing
- `tests/taskService.test.js` → "KNOWN BEHAVIOR (suspected bug): clobbers
  priority to 'medium'": a task created with `priority: 'high'` returns
  `priority: 'medium'` after completion.
- `tests/routes.test.js` → "PATCH /tasks/:id/complete" → "KNOWN BEHAVIOR
  (suspected bug): completing clobbers priority to 'medium'": same behavior
  observed over HTTP — a `high`-priority task becomes `medium` after the
  `complete` call.

### 6. Root cause
`completeTask()` explicitly sets `priority: 'medium'` in the merged object
rather than preserving `task.priority` (which is already carried over by the
`...task` spread). The line is redundant at best and destructive at worst.

### 7. Proposed fix
Remove the `priority: 'medium'` assignment from the updated object so the
spread (`...task`) preserves the existing `priority`. The function should only
set `status` and `completedAt`.

### 8. Severity / impact
**Medium.** Completion silently corrupts business data (priority). While it
does not break the request, it loses information that may be important for
reporting, sorting, or user expectations, and the change is non-obvious
(clients completing a task did not ask to change priority).
