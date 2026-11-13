const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
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
const eventImageDirectory = path.resolve(
  process.env.EVENT_UPLOAD_DIR || path.join(__dirname, '..', 'uploads', 'events')
);
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
  const isFormData = body instanceof FormData;
  if (body !== undefined && !isFormData) headers['Content-Type'] = 'application/json';
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body)
  });
}

test('student registration and staff event management', async (t) => {
  assert.deepEqual(
    db.prepare('SELECT DISTINCT role FROM users ORDER BY role').all().map((row) => row.role),
    ['staff', 'student']
  );
  const eventColumns = db.prepare('PRAGMA table_info(events)').all().map((row) => row.name);
  const registrationColumns = db.prepare('PRAGMA table_info(registrations)').all().map((row) => row.name);
  assert.equal(eventColumns.includes('registration_method'), false);
  assert.equal(eventColumns.includes('event_mode'), true);
  assert.equal(eventColumns.includes('meeting_url'), true);
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
    const placeholders = createdEventIds.map(() => '?').join(', ');
    const images = createdEventIds.length
      ? db.prepare(`SELECT image_path FROM events WHERE id IN (${placeholders})`).all(...createdEventIds)
      : [];
    for (const event of images) {
      if (event.image_path) {
        fs.rmSync(path.join(eventImageDirectory, event.image_path), { force: true });
      }
    }
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

  const insecureMeetingLink = await request('/api/events', {
    token: staff.token,
    method: 'POST',
    body: {
      title: 'Online event with insecure link',
      description: 'Meeting links must use HTTPS.',
      location: 'Online',
      eventDate: futureDate(),
      capacity: 1,
      category: 'Academic',
      eventMode: 'online',
      meetingUrl: 'http://meet.example.test/session'
    }
  });
  assert.equal(insecureMeetingLink.status, 400);

  const forbidden = await request('/api/events', {
    token: student.token,
    method: 'POST',
    body: { title: 'Not allowed' }
  });
  assert.equal(forbidden.status, 403);

  const createEvent = async (token, title, capacity, details = {}) => {
    const response = await request('/api/events', {
      token,
      method: 'POST',
      body: {
        title,
        description: 'A simple event for testing direct registration.',
        location: 'Test Hall',
        eventDate: futureDate(),
        capacity,
        category: 'Academic',
        eventMode: details.eventMode || 'in_person',
        meetingUrl: details.meetingUrl || ''
      }
    });
    assert.equal(response.status, 201);
    const event = await response.json();
    createdEventIds.push(event.id);
    assert.equal(event.registered_count, 0);
    return event;
  };

  const fullEvent = await createEvent(staff.token, 'Test capacity event', 1);
  const onlineEvent = await createEvent(staff.token, 'Test online event', 5, {
    eventMode: 'online',
    meetingUrl: 'https://meet.example.test/session'
  });
  assert.equal(onlineEvent.event_mode, 'online');
  assert.equal(onlineEvent.meeting_url, 'https://meet.example.test/session');
  const staffEvents = await request('/api/staff/events', { token: staff.token });
  assert.equal(staffEvents.status, 200);
  assert.ok((await staffEvents.json()).some((event) => event.id === onlineEvent.id));
  assert.equal((await request('/api/staff/events', { token: student.token })).status, 403);
  const otherStaffEvents = await request('/api/staff/events', { token: secondStaff.token });
  assert.equal((await otherStaffEvents.json()).some((event) => event.id === onlineEvent.id), false);
  const publicOnlineEvents = await request('/api/events');
  const listedOnlineEvent = (await publicOnlineEvents.json()).find((event) => event.id === onlineEvent.id);
  assert.equal(listedOnlineEvent.event_mode, 'online');
  assert.equal(Object.prototype.hasOwnProperty.call(listedOnlineEvent, 'meeting_url'), false);
  assert.equal((await request(`/api/events/${onlineEvent.id}`)).status, 401);
  const privateOnlineEvent = await request(`/api/events/${onlineEvent.id}`, { token: student.token });
  assert.equal((await privateOnlineEvent.json()).meeting_url, '');
  const ownerOnlineEvent = await request(`/api/events/${onlineEvent.id}`, { token: staff.token });
  assert.equal((await ownerOnlineEvent.json()).meeting_url, onlineEvent.meeting_url);
  const onlineRegistration = await request('/api/registrations', {
    token: student.token,
    method: 'POST',
    body: { eventId: onlineEvent.id }
  });
  assert.equal(onlineRegistration.status, 201);
  const registeredOnlineEvent = await request(`/api/events/${onlineEvent.id}`, { token: student.token });
  assert.equal((await registeredOnlineEvent.json()).meeting_url, onlineEvent.meeting_url);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1sAAAAASUVORK5CYII=',
    'base64'
  );
  const createPhotoForm = (alt, fileBytes = png) => {
    const form = new FormData();
    form.set('title', 'Test event with photo');
    form.set('description', 'An event with an uploaded accessible photo.');
    form.set('location', 'Test Gallery');
    form.set('eventDate', futureDate());
    form.set('capacity', '5');
    form.set('category', 'Community');
    form.set('imageAlt', alt);
    form.set('image', new Blob([fileBytes], { type: 'image/png' }), 'event.png');
    return form;
  };
  const missingImageAlt = await request('/api/events', {
    token: staff.token,
    method: 'POST',
    body: createPhotoForm('')
  });
  assert.equal(missingImageAlt.status, 400);

  const invalidImage = await request('/api/events', {
    token: staff.token,
    method: 'POST',
    body: createPhotoForm('A test event photo.', Buffer.from('not an image'))
  });
  assert.equal(invalidImage.status, 400);

  const oversizedImage = await request('/api/events', {
    token: staff.token,
    method: 'POST',
    body: createPhotoForm('An oversized test image.', Buffer.alloc(2 * 1024 * 1024 + 1))
  });
  assert.equal(oversizedImage.status, 413);

  const photoResponse = await request('/api/events', {
    token: staff.token,
    method: 'POST',
    body: createPhotoForm('A small test image for an event.')
  });
  assert.equal(photoResponse.status, 201);
  const photoEvent = await photoResponse.json();
  createdEventIds.push(photoEvent.id);
  assert.equal(photoEvent.staff_id, staff.user.id);
  assert.equal(photoEvent.staff_name, staff.user.name);
  assert.match(photoEvent.image_url, /^\/api\/event-images\/[a-f0-9]{32}\.png$/);
  assert.equal(photoEvent.image_alt, 'A small test image for an event.');
  const listedPhotoEvent = (await (await request('/api/events')).json())
    .find((event) => event.id === photoEvent.id);
  assert.equal(listedPhotoEvent.image_url, photoEvent.image_url);
  assert.equal(listedPhotoEvent.image_alt, photoEvent.image_alt);
  const photoFile = await request(photoEvent.image_url);
  assert.equal(photoFile.status, 200);
  assert.equal(photoFile.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await photoFile.arrayBuffer()), png);

  const updatePhotoEvent = await request(`/api/events/${photoEvent.id}`, {
    token: staff.token,
    method: 'PUT',
    body: {
      title: photoEvent.title,
      description: 'Updated event description.',
      location: photoEvent.location,
      eventDate: photoEvent.event_date,
      capacity: photoEvent.capacity,
      category: photoEvent.category
    }
  });
  assert.equal(updatePhotoEvent.status, 200);
  assert.equal((await updatePhotoEvent.json()).image_url, photoEvent.image_url);

  const replacementForm = createPhotoForm('A replacement event photo.');
  replacementForm.set('title', photoEvent.title);
  replacementForm.set('location', photoEvent.location);
  replacementForm.set('eventDate', photoEvent.event_date);
  replacementForm.set('capacity', String(photoEvent.capacity));
  replacementForm.set('category', photoEvent.category);
  const replacementResponse = await request(`/api/events/${photoEvent.id}`, {
    token: staff.token,
    method: 'PUT',
    body: replacementForm
  });
  assert.equal(replacementResponse.status, 200);
  const replacementEvent = await replacementResponse.json();
  assert.notEqual(replacementEvent.image_url, photoEvent.image_url);
  assert.equal(replacementEvent.image_alt, 'A replacement event photo.');
  assert.equal((await request(photoEvent.image_url)).status, 404);
  assert.equal((await request(replacementEvent.image_url)).status, 200);

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
