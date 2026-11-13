const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');
const app = require('../server');
const db = require('../db');
const { hashPassword } = require('../auth');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const testPassword = 'test-password';
const testEmails = {
  staff: `staff-${suffix}@example.test`,
  secondStaff: `second-staff-${suffix}@example.test`,
  student: `student-${suffix}@example.test`,
  secondStudent: `second-${suffix}@example.test`
};
const createdUserIds = [];
const createdEventIds = [];
let server;
let baseUrl;

function futureDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 30);
  return date.toISOString().slice(0, 10);
}

function pastDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function request(path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

test('database migration removes retired event metadata and preserves event records', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'university-events-migration-'));
  const databasePath = path.join(directory, 'legacy.db');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const legacyDb = new Database(databasePath);
  legacyDb.pragma('foreign_keys = ON');
  legacyDb.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('student', 'staff'))
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      location TEXT NOT NULL,
      event_date TEXT NOT NULL,
      capacity INTEGER NOT NULL CHECK (capacity > 0),
      staff_id INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      image_path TEXT,
      image_alt TEXT NOT NULL DEFAULT '',
      event_mode TEXT NOT NULL DEFAULT 'in_person',
      meeting_url TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (staff_id) REFERENCES users(id)
    );
    CREATE TABLE registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      attended INTEGER NOT NULL DEFAULT 0 CHECK (attended IN (0, 1)),
      registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES events(id),
      FOREIGN KEY (student_id) REFERENCES users(id),
      UNIQUE (event_id, student_id)
    );
    INSERT INTO users (id, name, email, role) VALUES
      (1, 'Event Team', 'staff@example.test', 'staff'),
      (2, 'Student', 'student@example.test', 'student');
    INSERT INTO events (
      id, title, description, location, event_date, capacity, staff_id, category,
      image_path, image_alt, event_mode, meeting_url
    ) VALUES (
      41, 'Legacy event', 'Event description', 'Main Hall', '2026-12-01', 10, 1, 'Academic',
      'legacy.jpg', 'Legacy image text', 'online', 'https://example.test/meeting'
    );
    INSERT INTO registrations (id, event_id, student_id, attended, registered_at)
    VALUES (73, 41, 2, 1, '2026-10-10 12:00:00');
  `);
  legacyDb.close();

  const dbModulePath = path.resolve(__dirname, '..', 'db.js');
  const migrationResult = execFileSync(process.execPath, ['-e', `
    const db = require(${JSON.stringify(dbModulePath)});
    const result = {
      columns: db.prepare('PRAGMA table_info(events)').all().map((row) => row.name),
      event: db.prepare('SELECT id, title, description, location, event_date, capacity, staff_id, category FROM events WHERE id = 41').get(),
      registration: db.prepare('SELECT id, event_id, student_id, attended, registered_at FROM registrations WHERE id = 73').get()
    };
    console.log(JSON.stringify(result));
    db.close();
  `], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_PATH: databasePath },
    encoding: 'utf8'
  });
  const result = JSON.parse(migrationResult);
  for (const column of ['image_path', 'image_alt', 'event_mode', 'meeting_url']) {
    assert.equal(result.columns.includes(column), false);
  }
  assert.deepEqual(result.event, {
    id: 41,
    title: 'Legacy event',
    description: 'Event description',
    location: 'Main Hall',
    event_date: '2026-12-01',
    capacity: 10,
    staff_id: 1,
    category: 'Academic'
  });
  assert.deepEqual(result.registration, {
    id: 73,
    event_id: 41,
    student_id: 2,
    attended: 1,
    registered_at: '2026-10-10 12:00:00'
  });
});

test('student registration and staff event management', async (t) => {
  assert.deepEqual(
    db.prepare('SELECT DISTINCT role FROM users ORDER BY role').all().map((row) => row.role),
    ['staff', 'student']
  );
  const eventColumns = db.prepare('PRAGMA table_info(events)').all().map((row) => row.name);
  const registrationColumns = db.prepare('PRAGMA table_info(registrations)').all().map((row) => row.name);
  assert.equal(eventColumns.includes('registration_method'), false);
  assert.equal(eventColumns.includes('image_path'), false);
  assert.equal(eventColumns.includes('image_alt'), false);
  assert.equal(eventColumns.includes('event_mode'), false);
  assert.equal(eventColumns.includes('meeting_url'), false);
  assert.equal(eventColumns.includes('application_question'), false);
  assert.equal(eventColumns.includes('eligible_faculty'), false);
  assert.equal(registrationColumns.includes('status'), false);
  assert.equal(registrationColumns.includes('application_answer'), false);
  assert.equal(registrationColumns.includes('applied_at'), false);
  assert.equal(registrationColumns.includes('registered_at'), true);
  const insertUser = db.prepare('INSERT INTO users (name, email, role) VALUES (?, ?, ?)');
  for (const [role, email] of Object.entries(testEmails)) {
    const storedRole = role === 'staff' || role === 'secondStaff' ? 'staff' : 'student';
    const result = insertUser.run(role, email, storedRole);
    createdUserIds.push(Number(result.lastInsertRowid));
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(hashPassword(testPassword), Number(result.lastInsertRowid));
  }
  const ids = Object.fromEntries(Object.keys(testEmails).map((role, index) => [role, createdUserIds[index]]));

  t.after(() => {
    if (server) server.close();
    for (const id of createdEventIds) db.prepare('DELETE FROM registrations WHERE event_id = ?').run(id);
    if (createdUserIds.length) {
      const placeholders = createdUserIds.map(() => '?').join(', ');
      db.prepare(`DELETE FROM registrations WHERE student_id IN (${placeholders})`).run(...createdUserIds);
    }
    for (const id of createdEventIds) db.prepare('DELETE FROM events WHERE id = ?').run(id);
    if (createdUserIds.length) {
      const placeholders = createdUserIds.map(() => '?').join(', ');
      db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...createdUserIds);
    }
  });

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const removedSignup = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'New student', email: `new-${suffix}@example.test` }
  });
  assert.equal(removedSignup.status, 404);
  assert.equal((await request('/api/dashboard')).status, 404);
  assert.equal((await request('/api/events')).status, 200);
  assert.equal((await request('/api/staff/events')).status, 401);
  assert.equal((await request('/staff/events.html')).status, 200);
  assert.equal((await request('/staff/dashboard.html')).status, 200);
  assert.equal((await request('/student/dashboard.html')).status, 200);
  assert.equal((await request('/js/staff-dashboard.js')).status, 200);
  assert.equal((await request('/js/student-dashboard.js')).status, 200);
  assert.equal((await request('/js/staff-events.js')).status, 200);
  assert.equal((await request('/organizer/events.html')).status, 404);

  async function login(email, password = testPassword) {
    const response = await request('/api/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(response.status, 200);
    return response.json();
  }

  const student = await login(testEmails.student);
  const secondStudent = await login(testEmails.secondStudent);
  const staff = await login(testEmails.staff);
  const secondStaff = await login(testEmails.secondStaff);
  assert.equal(staff.user.role, 'staff');
  const staffProfile = await request('/api/me', { token: staff.token });
  assert.equal((await staffProfile.json()).role, 'staff');

  const badLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: testEmails.student, password: 'wrong-password' }
  });
  assert.equal(badLogin.status, 401);

  const invalidDate = await request('/api/events', {
    token: staff.token,
    method: 'POST',
    body: {
      title: 'Invalid date event',
      description: 'This date does not exist',
      location: 'Test Hall',
      eventDate: '2026-02-31',
      capacity: 1,
      category: 'Academic'
    }
  });
  assert.equal(invalidDate.status, 400);

  const pastEvent = await request('/api/events', {
    token: staff.token,
    method: 'POST',
    body: {
      title: 'Past event',
      description: 'New events must not be in the past.',
      location: 'Test Hall',
      eventDate: pastDate(),
      capacity: 1,
      category: 'Academic'
    }
  });
  assert.equal(pastEvent.status, 400);

  const forbidden = await request('/api/events', {
    token: student.token,
    method: 'POST',
    body: { title: 'Not allowed' }
  });
  assert.equal(forbidden.status, 403);

  const createEvent = async (token, title, capacity) => {
    const response = await request('/api/events', {
      token,
      method: 'POST',
      body: {
        title,
        description: 'A simple event for testing direct registration.',
        location: 'Test Hall',
        eventDate: futureDate(),
        capacity,
        category: 'Academic'
      }
    });
    assert.equal(response.status, 201);
    const event = await response.json();
    createdEventIds.push(event.id);
    assert.equal(event.registered_count, 0);
    assert.equal(Object.hasOwn(event, 'image_url'), false);
    assert.equal(Object.hasOwn(event, 'event_mode'), false);
    assert.equal(Object.hasOwn(event, 'meeting_url'), false);
    return event;
  };

  const fullEvent = await createEvent(staff.token, 'Test capacity event', 1);
  const staffEvents = await request('/api/staff/events', { token: staff.token });
  assert.equal(staffEvents.status, 200);
  assert.equal((await request('/api/staff/events', { token: student.token })).status, 403);

  const directRegistration = await request('/api/registrations', {
    token: student.token,
    method: 'POST',
    body: { eventId: fullEvent.id }
  });
  assert.equal(directRegistration.status, 201);

  const duplicateRegistration = await request('/api/registrations', {
    token: student.token,
    method: 'POST',
    body: { eventId: fullEvent.id }
  });
  assert.equal(duplicateRegistration.status, 409);

  const fullRegistration = await request('/api/registrations', {
    token: secondStudent.token,
    method: 'POST',
    body: { eventId: fullEvent.id }
  });
  assert.equal(fullRegistration.status, 409);

  const registeredEvent = await createEvent(staff.token, 'Test attendee event', 2);
  const attendeeRegistration = await request('/api/registrations', {
    token: secondStudent.token,
    method: 'POST',
    body: { eventId: registeredEvent.id }
  });
  assert.equal(attendeeRegistration.status, 201);
  db.prepare('UPDATE events SET event_date = ? WHERE id = ?').run(pastDate(), registeredEvent.id);
  const pastStaffEvents = await request('/api/staff/events', { token: staff.token });
  assert.ok((await pastStaffEvents.json()).some((event) => event.id === registeredEvent.id));
  const upcomingStudentEvents = await request('/api/events');
  assert.equal((await upcomingStudentEvents.json()).some((event) => event.id === registeredEvent.id), false);

  const staffRows = await request(`/api/registrations?eventId=${registeredEvent.id}`, { token: staff.token });
  assert.equal(staffRows.status, 200);
  const [attendee] = await staffRows.json();
  assert.equal(attendee.registered_count, 1);

  const otherStaffRows = await request(`/api/registrations?eventId=${registeredEvent.id}`, { token: secondStaff.token });
  assert.equal(otherStaffRows.status, 403);
  const missingEvent = await request('/api/registrations', { token: staff.token });
  assert.equal(missingEvent.status, 400);

  const checkedIn = await request(`/api/registrations/${attendee.id}/attendance`, {
    token: staff.token,
    method: 'PATCH',
    body: { attended: true }
  });
  assert.equal(checkedIn.status, 200);

  const otherStaffCheckIn = await request(`/api/registrations/${attendee.id}/attendance`, {
    token: secondStaff.token,
    method: 'PATCH',
    body: { attended: true }
  });
  assert.equal(otherStaffCheckIn.status, 403);

  const studentCheckIn = await request(`/api/registrations/${attendee.id}/attendance`, {
    token: student.token,
    method: 'PATCH',
    body: { attended: true }
  });
  assert.equal(studentCheckIn.status, 403);

  const undoCheckIn = await request(`/api/registrations/${attendee.id}/attendance`, {
    token: staff.token,
    method: 'PATCH',
    body: { attended: false }
  });
  assert.equal(undoCheckIn.status, 400);

  const studentRegistrations = await request('/api/registrations', { token: secondStudent.token });
  const registrations = await studentRegistrations.json();
  assert.ok(registrations.some((item) => item.event_id === registeredEvent.id && item.attended === 1));

  assert.equal(ids.staff, staff.user.id);
});
