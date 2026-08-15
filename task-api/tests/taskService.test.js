const taskService = require('../src/services/taskService');

beforeEach(() => {
  taskService._reset();
});

describe('taskService.getAll', () => {
  test('returns an empty array when store is empty', () => {
    expect(taskService.getAll()).toEqual([]);
  });

  test('returns a copy of all created tasks', () => {
    const a = taskService.create({ title: 'A' });
    const b = taskService.create({ title: 'B' });
    const all = taskService.getAll();
    expect(all).toHaveLength(2);
    expect(all.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  test('returns a new array (not the internal reference)', () => {
    taskService.create({ title: 'A' });
    const all = taskService.getAll();
    all.push('mutated');
    expect(taskService.getAll()).toHaveLength(1);
  });
});

describe('taskService.findById', () => {
  test('returns undefined for missing id', () => {
    expect(taskService.findById('nope')).toBeUndefined();
  });

  test('returns the matching task', () => {
    const t = taskService.create({ title: 'Find me' });
    const found = taskService.findById(t.id);
    expect(found.id).toBe(t.id);
    expect(found.title).toBe('Find me');
  });
});

describe('taskService.getByStatus', () => {
  beforeEach(() => {
    taskService.create({ title: 'todo task', status: 'todo' });
    taskService.create({ title: 'in progress', status: 'in_progress' });
    taskService.create({ title: 'done task', status: 'done' });
  });

  test('happy path: filters by exact status', () => {
    const todos = taskService.getByStatus('todo');
    expect(todos).toHaveLength(1);
    expect(todos[0].title).toBe('todo task');
  });

  test('returns empty array for unknown status', () => {
    expect(taskService.getByStatus('archived')).toEqual([]);
  });

  test('KNOWN BEHAVIOR (suspected bug): uses substring matching via .includes()', () => {
    // status='do' is a substring of BOTH 'todo' AND 'done' -> both match
    const r = taskService.getByStatus('do');
    expect(r).toHaveLength(2);
    expect(r.map((t) => t.status).sort()).toEqual(['done', 'todo']);

    // status='in' matches 'in_progress' (substring containment)
    const r2 = taskService.getByStatus('in');
    expect(r2).toHaveLength(1);
    expect(r2[0].status).toBe('in_progress');
  });
});

describe('taskService.getPaginated', () => {
  beforeEach(() => {
    for (let i = 1; i <= 25; i++) {
      taskService.create({ title: `task ${i}` });
    }
  });

  test('happy path: page 1 (offset 0) returns the first page of tasks', () => {
    const page = taskService.getPaginated(1, 10);
    expect(page).toHaveLength(10);
    expect(page[0].title).toBe('task 1');
  });

  test('page 2 returns the second page of tasks', () => {
    const page = taskService.getPaginated(2, 10); // offset (2-1)*10 = 10
    expect(page).toHaveLength(10);
    expect(page[0].title).toBe('task 11');
  });

  test('page 3 returns the third page of tasks', () => {
    const page = taskService.getPaginated(3, 10); // offset (3-1)*10 = 20
    expect(page).toHaveLength(5);
    expect(page[0].title).toBe('task 21');
  });

  test('returns fewer items when a page is partially filled', () => {
    const last = taskService.getPaginated(3, 10); // 25 total -> tasks 21..25
    expect(last).toHaveLength(5);
  });

  test('returns empty array when page is beyond the available data', () => {
    expect(taskService.getPaginated(10, 10)).toEqual([]);
  });
});

describe('taskService.getStats', () => {
  test('returns zeroed counts and zero overdue when empty', () => {
    expect(taskService.getStats()).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  test('happy path: counts by status and computes overdue', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();

    taskService.create({ title: 't1', status: 'todo', dueDate: past });
    taskService.create({ title: 't2', status: 'todo', dueDate: future });
    taskService.create({ title: 't3', status: 'in_progress', dueDate: past });
    taskService.create({ title: 't4', status: 'done', dueDate: past }); // done => not overdue

    const stats = taskService.getStats();
    expect(stats).toEqual({ todo: 2, in_progress: 1, done: 1, overdue: 2 });
  });

  test('overdue is false when dueDate is null', () => {
    taskService.create({ title: 'no due', status: 'todo', dueDate: null });
    expect(taskService.getStats().overdue).toBe(0);
  });

  test('tasks with unknown status are not counted in known buckets', () => {
    taskService.create({ title: 'weird', status: 'archived' });
    const stats = taskService.getStats();
    expect(stats.todo).toBe(0);
    expect(stats.in_progress).toBe(0);
    expect(stats.done).toBe(0);
    expect(stats.overdue).toBe(0);
  });
});

describe('taskService.create', () => {
  test('happy path: creates a task with defaults', () => {
    const t = taskService.create({ title: 'New task' });
    expect(t.id).toBeDefined();
    expect(t.title).toBe('New task');
    expect(t.description).toBe('');
    expect(t.status).toBe('todo');
    expect(t.priority).toBe('medium');
    expect(t.dueDate).toBeNull();
    expect(t.completedAt).toBeNull();
    expect(typeof t.createdAt).toBe('string');
  });

  test('honors provided optional fields', () => {
    const due = '2030-01-01T00:00:00.000Z';
    const t = taskService.create({
      title: 'Custom',
      description: 'desc',
      status: 'in_progress',
      priority: 'high',
      dueDate: due,
    });
    expect(t.description).toBe('desc');
    expect(t.status).toBe('in_progress');
    expect(t.priority).toBe('high');
    expect(t.dueDate).toBe(due);
  });

  test('adds the task to the store', () => {
    const t = taskService.create({ title: 'Persisted' });
    expect(taskService.findById(t.id)).toBeTruthy();
  });

  test('KNOWN BEHAVIOR (no route-level enforcement here): accepts invalid status/priority values', () => {
    // create() does not validate enums; it stores whatever it is given.
    const t = taskService.create({ title: 'X', status: 'bogus', priority: 'critical' });
    expect(t.status).toBe('bogus');
    expect(t.priority).toBe('critical');
  });
});

describe('taskService.update', () => {
  test('happy path: updates provided fields and returns updated task', () => {
    const t = taskService.create({ title: 'Original', priority: 'low' });
    const updated = taskService.update(t.id, { title: 'Updated', priority: 'high' });
    expect(updated.title).toBe('Updated');
    expect(updated.priority).toBe('high');
    expect(taskService.findById(t.id).title).toBe('Updated');
  });

  test('returns null for missing id', () => {
    expect(taskService.update('missing', { title: 'x' })).toBeNull();
  });

  test('preserves fields that are not provided', () => {
    const t = taskService.create({ title: 'Keep', description: 'd', priority: 'low' });
    taskService.update(t.id, { title: 'Changed' });
    const after = taskService.findById(t.id);
    expect(after.description).toBe('d');
    expect(after.priority).toBe('low');
  });

  test('KNOWN BEHAVIOR: merges arbitrary fields including id/createdAt', () => {
    const t = taskService.create({ title: 'A' });
    const originalId = t.id;
    const updated = taskService.update(t.id, { id: 'forged', createdAt: '1970-01-01T00:00:00.000Z' });
    expect(updated.id).toBe('forged');
    expect(updated.createdAt).toBe('1970-01-01T00:00:00.000Z');
    // Note: the task is now findable by the forged id, not the original
    expect(taskService.findById('forged')).toBeTruthy();
    expect(taskService.findById(originalId)).toBeUndefined();
  });
});

describe('taskService.remove', () => {
  test('happy path: removes an existing task and returns true', () => {
    const t = taskService.create({ title: 'To remove' });
    expect(taskService.remove(t.id)).toBe(true);
    expect(taskService.findById(t.id)).toBeUndefined();
  });

  test('returns false for missing id', () => {
    expect(taskService.remove('nope')).toBe(false);
  });
});

describe('taskService.completeTask', () => {
  test('happy path: marks task done with completedAt timestamp', () => {
    const t = taskService.create({ title: 'Do it', priority: 'high' });
    const done = taskService.completeTask(t.id);
    expect(done.status).toBe('done');
    expect(typeof done.completedAt).toBe('string');
    expect(taskService.findById(t.id).status).toBe('done');
  });

  test('returns null for missing id', () => {
    expect(taskService.completeTask('missing')).toBeNull();
  });

  test('KNOWN BEHAVIOR (suspected bug): clobbers priority to "medium"', () => {
    const t = taskService.create({ title: 'Important', priority: 'high' });
    const done = taskService.completeTask(t.id);
    expect(done.priority).toBe('medium'); // original 'high' is lost
  });
});

describe('taskService._reset', () => {
  test('clears all tasks', () => {
    taskService.create({ title: 'A' });
    taskService.create({ title: 'B' });
    taskService._reset();
    expect(taskService.getAll()).toEqual([]);
  });
});
