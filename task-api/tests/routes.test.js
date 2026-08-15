const request = require('supertest');
const app = require('../src/app');
const taskService = require('../src/services/taskService');

beforeEach(() => {
  taskService._reset();
});

function makeTask(overrides = {}) {
  return { title: 'Test task', ...overrides };
}

describe('GET /tasks', () => {
  test('happy path: returns all tasks as JSON array', async () => {
    taskService.create(makeTask({ title: 'A' }));
    taskService.create(makeTask({ title: 'B' }));

    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
  });

  test('returns empty array when no tasks exist', async () => {
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('KNOWN BEHAVIOR: status filter takes precedence over pagination (ignores page/limit)', async () => {
    for (let i = 0; i < 15; i++) {
      taskService.create(makeTask({ title: `t${i}`, status: 'todo' }));
    }
    const res = await request(app).get('/tasks?status=todo&page=1&limit=5');
    expect(res.status).toBe(200);
    // All todo tasks are returned; pagination params are ignored when status is set
    expect(res.body).toHaveLength(15);
  });
});

describe('GET /tasks?status=...', () => {
  beforeEach(() => {
    taskService.create(makeTask({ status: 'todo' }));
    taskService.create(makeTask({ status: 'in_progress' }));
    taskService.create(makeTask({ status: 'done' }));
  });

  test('happy path: filters by exact status', async () => {
    const res = await request(app).get('/tasks?status=todo');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe('todo');
  });

  test('returns empty array for unknown status', async () => {
    const res = await request(app).get('/tasks?status=archived');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('KNOWN BEHAVIOR (suspected bug): substring matching via .includes()', async () => {
    // status='do' is a substring of BOTH 'todo' AND 'done' -> both match
    const res = await request(app).get('/tasks?status=do');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((t) => t.status).sort()).toEqual(['done', 'todo']);
  });
});

describe('GET /tasks?page=...&limit=...', () => {
  beforeEach(() => {
    for (let i = 1; i <= 25; i++) {
      taskService.create(makeTask({ title: `t${i}` }));
    }
  });

  test('happy path: page 1 returns the first page of tasks', async () => {
    const res = await request(app).get('/tasks?page=1&limit=10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(10);
    expect(res.body[0].title).toBe('t1');
  });

  test('page 2 returns the second page of tasks', async () => {
    const res = await request(app).get('/tasks?page=2&limit=10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(10);
    expect(res.body[0].title).toBe('t11');
  });

  test('a request without page behaves as page 1 (first page)', async () => {
    // page omitted -> parseInt(undefined) NaN -> || 1 -> page 1
    const res = await request(app).get('/tasks?limit=10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(10);
    expect(res.body[0].title).toBe('t1');
  });

  test('invalid pagination params default to page 1 / limit 10', async () => {
    const res = await request(app).get('/tasks?page=abc&limit=xyz');
    expect(res.status).toBe(200);
    // page/limit parse to NaN -> || 1 / || 10 -> first page
    expect(res.body[0].title).toBe('t1');
    expect(res.body).toHaveLength(10);
  });

  test('a page beyond the available data returns an empty list', async () => {
    const res = await request(app).get('/tasks?page=10&limit=10');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /tasks/stats', () => {
  test('happy path: returns counts and overdue', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    taskService.create(makeTask({ status: 'todo', dueDate: past }));
    taskService.create(makeTask({ status: 'todo', dueDate: future }));
    taskService.create(makeTask({ status: 'done', dueDate: past }));

    const res = await request(app).get('/tasks/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ todo: 2, in_progress: 0, done: 1, overdue: 1 });
  });

  test('returns all zeros when empty', async () => {
    const res = await request(app).get('/tasks/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  test('overdue ignores done tasks even with past dueDate', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    taskService.create(makeTask({ status: 'done', dueDate: past }));
    const res = await request(app).get('/tasks/stats');
    expect(res.body.overdue).toBe(0);
    expect(res.body.done).toBe(1);
  });
});

describe('POST /tasks', () => {
  test('happy path: creates a task and returns 201', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'Write tests' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.title).toBe('Write tests');
    expect(res.body.status).toBe('todo');
    expect(res.body.priority).toBe('medium');
  });

  test('edge case: missing title returns 400', async () => {
    const res = await request(app).post('/tasks').send({ priority: 'high' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('edge case: empty/whitespace title returns 400', async () => {
    const res = await request(app).post('/tasks').send({ title: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('edge case: invalid status returns 400', async () => {
    const res = await request(app).post('/tasks').send({ title: 'X', status: 'nope' });
    expect(res.status).toBe(400);
  });

  test('edge case: invalid dueDate returns 400', async () => {
    const res = await request(app).post('/tasks').send({ title: 'X', dueDate: 'not-a-date' });
    expect(res.status).toBe(400);
  });

  test('edge case: missing body returns 400', async () => {
    const res = await request(app).post('/tasks').send({});
    expect(res.status).toBe(400);
  });
});

describe('PUT /tasks/:id', () => {
  test('happy path: updates task and returns 200', async () => {
    const created = taskService.create(makeTask({ title: 'Old', priority: 'low' }));
    const res = await request(app)
      .put(`/tasks/${created.id}`)
      .send({ title: 'New', priority: 'high' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('New');
    expect(res.body.priority).toBe('high');
  });

  test('edge case: missing id returns 404', async () => {
    const res = await request(app).put('/tasks/missing').send({ title: 'X' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Task not found');
  });

  test('edge case: invalid status returns 400', async () => {
    const created = taskService.create(makeTask({ title: 'T' }));
    const res = await request(app).put(`/tasks/${created.id}`).send({ status: 'weird' });
    expect(res.status).toBe(400);
  });

  test('edge case: empty title returns 400', async () => {
    const created = taskService.create(makeTask({ title: 'T' }));
    const res = await request(app).put(`/tasks/${created.id}`).send({ title: '' });
    expect(res.status).toBe(400);
  });

  test('edge case: partial update with valid field works', async () => {
    const created = taskService.create(makeTask({ title: 'T', priority: 'low' }));
    const res = await request(app).put(`/tasks/${created.id}`).send({ priority: 'high' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('T');
    expect(res.body.priority).toBe('high');
  });
});

describe('DELETE /tasks/:id', () => {
  test('happy path: deletes and returns 204', async () => {
    const created = taskService.create(makeTask({ title: 'Bye' }));
    const res = await request(app).delete(`/tasks/${created.id}`);
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(taskService.findById(created.id)).toBeUndefined();
  });

  test('edge case: missing id returns 404', async () => {
    const res = await request(app).delete('/tasks/missing');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Task not found');
  });

  test('edge case: deleting a task does not affect others', async () => {
    const a = taskService.create(makeTask({ title: 'A' }));
    const b = taskService.create(makeTask({ title: 'B' }));
    await request(app).delete(`/tasks/${a.id}`);
    expect(taskService.findById(b.id)).toBeTruthy();
  });
});

describe('PATCH /tasks/:id/complete', () => {
  test('happy path: marks task done and returns 200', async () => {
    const created = taskService.create(makeTask({ title: 'Do', priority: 'high' }));
    const res = await request(app).patch(`/tasks/${created.id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(typeof res.body.completedAt).toBe('string');
  });

  test('edge case: missing id returns 404', async () => {
    const res = await request(app).patch('/tasks/missing/complete');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Task not found');
  });

  test('KNOWN BEHAVIOR (suspected bug): completing clobbers priority to "medium"', async () => {
    const created = taskService.create(makeTask({ title: 'Important', priority: 'high' }));
    const res = await request(app).patch(`/tasks/${created.id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.priority).toBe('medium'); // original 'high' lost
  });
});
