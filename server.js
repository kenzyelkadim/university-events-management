const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('./db');
const { verifyPassword } = require('./auth');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const sessions = new Map();
const eventImageDirectory = path.resolve(
  process.env.EVENT_UPLOAD_DIR || path.join(__dirname, 'uploads', 'events')
);
const CATEGORIES = new Set(['Academic', 'Careers', 'Community', 'Social', 'Sports', 'Workshop', 'General']);
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 9 },
  fileFilter(req, file, done) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      const error = new Error('Choose a JPG, PNG or WebP image.');
      error.status = 400;
      done(error);
      return;
    }
    done(null, true);
  }
});

// Serve the website and accept JSON data from its forms.
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/event-images/:filename', (req, res) => {
  const filename = req.params.filename;
  if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(filename)) return fail(res, 404, 'Event photo not found.');
  const imagePath = path.join(eventImageDirectory, filename);
  if (!fs.existsSync(imagePath)) return fail(res, 404, 'Event photo not found.');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  return res.type(path.extname(filename)).sendFile(imagePath);
});

// Small helpers used by several API routes.
function fail(res, status, message) {
  return res.status(status).json({ message });
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function requestBody(req) {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
}

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function getUser(req) {
  const authorization = req.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const userId = sessions.get(token);
  const user = userId
    ? db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(userId)
    : null;
  return user;
}

function requireRoles(...roles) {
  return (req, res, next) => {
    req.user = getUser(req);
    if (!req.user) return fail(res, 401, 'Please sign in to continue.');
    if (!roles.includes(req.user.role)) return fail(res, 403, 'You do not have permission to do that.');
    next();
  };
}

function canManageEvent(user, event) {
  return user.role === 'staff' && event.staff_id === user.id;
}

function eventById(id) {
  return db.prepare(`
    SELECT e.id, e.title, e.description, e.location, e.event_date, e.capacity,
      e.staff_id, e.category, e.image_alt, e.event_mode, e.meeting_url,
      CASE WHEN e.image_path IS NULL THEN NULL ELSE '/api/event-images/' || e.image_path END AS image_url,
      u.name AS staff_name,
      (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS registered_count
    FROM events e JOIN users u ON u.id = e.staff_id
    WHERE e.id = ?
  `).get(id);
}

function validEvent(body, hasImage, allowPastDate = false) {
  const title = cleanText(body.title, 120);
  const description = cleanText(body.description, 2000);
  const location = cleanText(body.location, 160);
  const category = cleanText(body.category, 60);
  const eventDate = cleanText(body.eventDate, 10);
  const capacity = Number(body.capacity);
  const imageAlt = cleanText(body.imageAlt, 180);
  const eventMode = body.eventMode === undefined || body.eventMode === ''
    ? 'in_person'
    : cleanText(body.eventMode, 20);
  const meetingUrl = cleanText(body.meetingUrl, 500);
  const dateIsValid = isCalendarDate(eventDate);

  if (!title || !description || !location || !CATEGORIES.has(category) || !dateIsValid) {
    return { error: 'Enter a title, description, location, category and valid event date.' };
  }
  if (!allowPastDate && eventDate < new Date().toISOString().slice(0, 10)) {
    return { error: 'Choose today or a future date for a new event.' };
  }
  if (!['in_person', 'online'].includes(eventMode)) {
    return { error: 'Choose whether the event is in person or online.' };
  }
  if (eventMode === 'online') {
    let parsedMeetingUrl;
    try {
      parsedMeetingUrl = new URL(meetingUrl);
    } catch {
      return { error: 'Enter a valid HTTPS meeting link for an online event.' };
    }
    if (parsedMeetingUrl.protocol !== 'https:' || parsedMeetingUrl.username || parsedMeetingUrl.password) {
      return { error: 'Meeting links must use HTTPS and cannot contain embedded credentials.' };
    }
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) {
    return { error: 'Capacity must be a whole number between 1 and 10,000.' };
  }
  if (hasImage && !imageAlt) return { error: 'Describe the event photo for screen-reader users.' };
  return {
    title, description, location, category, eventDate, capacity, imageAlt,
    eventMode, meetingUrl: eventMode === 'online' ? meetingUrl : ''
  };
}

function imageExtension(file) {
  const bytes = file.buffer;
  if (file.mimetype === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (file.mimetype === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (file.mimetype === 'image/webp'
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return '';
}

function storeEventImage(file) {
  const extension = imageExtension(file);
  if (!extension) {
    const error = new Error('The selected file is not a valid JPG, PNG or WebP image.');
    error.status = 400;
    throw error;
  }
  const filename = `${crypto.randomBytes(16).toString('hex')}.${extension}`;
  fs.mkdirSync(eventImageDirectory, { recursive: true });
  fs.writeFileSync(path.join(eventImageDirectory, filename), file.buffer, { flag: 'wx' });
  return filename;
}

function removeEventImage(filename) {
  if (!filename) return;
  try {
    fs.unlinkSync(path.join(eventImageDirectory, filename));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not remove replaced event photo.', error);
  }
}

// Sign in and account details.
app.post('/api/auth/login', (req, res) => {
  const body = requestBody(req);
  const email = cleanText(body.email, 254).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof body.password !== 'string') {
    return fail(res, 400, 'Enter a valid email address and password.');
  }
  const account = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!account || !verifyPassword(body.password, account.password_hash)) {
    return fail(res, 401, 'Email or password is incorrect.');
  }
  const user = {
    id: account.id,
    name: account.name,
    email: account.email,
    role: account.role,
  };
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, user.id);
  return res.json({ token, user });
});

app.post('/api/auth/logout', (req, res) => {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  sessions.delete(token);
  res.json({ message: 'You have signed out.' });
});

app.get('/api/me', requireRoles('student', 'staff'), (req, res) => {
  res.json(req.user);
});

// Browse and manage events.
app.get('/api/events', (req, res) => {
  const search = cleanText(req.query.search, 120);
  const category = cleanText(req.query.category, 60);
  const conditions = ["e.event_date >= date('now')"];
  const values = [];
  if (search) {
    conditions.push('(e.title LIKE ? OR e.description LIKE ? OR e.location LIKE ?)');
    values.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (category) {
    conditions.push('e.category = ?');
    values.push(category);
  }
  const events = db.prepare(`
    SELECT e.id, e.title, e.description, e.location, e.event_date, e.capacity,
      e.staff_id, e.category, e.image_alt, e.event_mode,
      CASE WHEN e.image_path IS NULL THEN NULL ELSE '/api/event-images/' || e.image_path END AS image_url,
      u.name AS staff_name,
      (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS registered_count
    FROM events e JOIN users u ON u.id = e.staff_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY e.event_date, e.title
  `).all(...values);
  res.json(events);
});

app.get('/api/staff/events', requireRoles('staff'), (req, res) => {
  const events = db.prepare(`
    SELECT e.id, e.title, e.description, e.location, e.event_date, e.capacity,
      e.staff_id, e.category, e.image_alt, e.event_mode, e.meeting_url,
      CASE WHEN e.image_path IS NULL THEN NULL ELSE '/api/event-images/' || e.image_path END AS image_url,
      u.name AS staff_name,
      (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS registered_count
    FROM events e JOIN users u ON u.id = e.staff_id
    WHERE e.staff_id = ?
    ORDER BY e.event_date, e.title
  `).all(req.user.id);
  res.json(events);
});

app.get('/api/events/:id', requireRoles('student', 'staff'), (req, res) => {
  const event = eventById(Number(req.params.id));
  if (!event) return fail(res, 404, 'Event not found.');
  if (event.event_mode === 'online') {
    const isOwner = req.user.role === 'staff' && event.staff_id === req.user.id;
    const isRegisteredStudent = req.user.role === 'student'
      && db.prepare('SELECT 1 FROM registrations WHERE event_id = ? AND student_id = ?')
        .get(event.id, req.user.id);
    if (!isOwner && !isRegisteredStudent) event.meeting_url = '';
  }
  res.json(event);
});

app.post('/api/events', requireRoles('staff'), imageUpload.single('image'), (req, res) => {
  const data = validEvent(requestBody(req), Boolean(req.file));
  if (data.error) return fail(res, 400, data.error);
  const imagePath = req.file ? storeEventImage(req.file) : null;
  let result;
  try {
    result = db.prepare(`
      INSERT INTO events (title, description, location, event_date, capacity, staff_id,
                          category, image_path, image_alt, event_mode, meeting_url)
      VALUES (@title, @description, @location, @eventDate, @capacity, @staffId,
              @category, @imagePath, @imageAlt, @eventMode, @meetingUrl)
    `).run({ ...data, staffId: req.user.id, imagePath });
  } catch (error) {
    removeEventImage(imagePath);
    throw error;
  }
  res.status(201).json(eventById(Number(result.lastInsertRowid)));
});

app.put('/api/events/:id', requireRoles('staff'), imageUpload.single('image'), (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(Number(req.params.id));
  if (!event) return fail(res, 404, 'Event not found.');
  if (!canManageEvent(req.user, event)) return fail(res, 403, 'You can only edit events you created.');
  const data = validEvent(requestBody(req), Boolean(req.file), true);
  if (data.error) return fail(res, 400, data.error);
  const registered = db.prepare(
    'SELECT COUNT(*) AS count FROM registrations WHERE event_id = ?'
  ).get(event.id).count;
  if (data.capacity < registered) return fail(res, 409, 'Capacity cannot be lower than the number of registered students.');
  const imagePath = req.file ? storeEventImage(req.file) : event.image_path;
  const imageAlt = req.file ? data.imageAlt : event.image_alt;
  try {
    db.prepare(`
    UPDATE events SET title = @title, description = @description, location = @location,
      event_date = @eventDate, capacity = @capacity, category = @category,
      image_path = @imagePath, image_alt = @imageAlt,
      event_mode = @eventMode, meeting_url = @meetingUrl
    WHERE id = @id
    `).run({ ...data, imagePath, imageAlt, id: event.id });
  } catch (error) {
    if (req.file) removeEventImage(imagePath);
    throw error;
  }
  if (req.file && event.image_path) removeEventImage(event.image_path);
  res.json(eventById(event.id));
});

// Students see their registrations; staff see attendees for their own events.
app.get('/api/registrations', requireRoles('student', 'staff'), (req, res) => {
  const eventId = Number(req.query.eventId);
  let where;
  let values;
  if (req.user.role === 'student') {
    where = 'r.student_id = ?';
    values = [req.user.id];
  } else if (Number.isInteger(eventId) && eventId > 0) {
    where = 'r.event_id = ?';
    values = [eventId];
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event || !canManageEvent(req.user, event)) return fail(res, 403, 'You can only view attendees for your events.');
  } else {
    return fail(res, 400, 'Choose an event to view its attendees.');
  }
  const registrations = db.prepare(`
    SELECT r.id, r.attended, r.registered_at, r.student_id, r.event_id,
      u.name AS student_name, u.email AS student_email,
      e.title AS event_title, e.event_date, e.location, e.capacity,
      (SELECT COUNT(*) FROM registrations registered
       WHERE registered.event_id = e.id) AS registered_count
    FROM registrations r
    JOIN users u ON u.id = r.student_id
    JOIN events e ON e.id = r.event_id
    WHERE ${where}
    ORDER BY r.registered_at DESC, u.name
  `).all(...values);
  res.json(registrations);
});

app.post('/api/registrations', requireRoles('student'), (req, res) => {
  const eventId = Number(requestBody(req).eventId);
  if (!Number.isInteger(eventId) || eventId < 1) return fail(res, 400, 'Choose a valid event.');
  const event = eventById(eventId);
  if (!event) return fail(res, 404, 'Event not found.');
  if (event.event_date < new Date().toISOString().slice(0, 10)) return fail(res, 409, 'Registration is closed for this event.');
  const existing = db.prepare(
    'SELECT id FROM registrations WHERE event_id = ? AND student_id = ?'
  ).get(eventId, req.user.id);
  if (existing) {
    return fail(res, 409, 'You already have a registration for this event.');
  }
  const register = db.transaction(() => {
    const registered = db.prepare(
      'SELECT COUNT(*) AS count FROM registrations WHERE event_id = ?'
    ).get(eventId).count;
    if (registered >= event.capacity) return false;
    db.prepare('INSERT INTO registrations (event_id, student_id) VALUES (?, ?) ')
      .run(eventId, req.user.id);
    return true;
  });
  if (!register()) return fail(res, 409, 'This event has reached capacity.');
  res.status(201).json({ message: 'You are registered for this event.' });
});

app.patch('/api/registrations/:id/attendance', requireRoles('staff'), (req, res) => {
  const registration = db.prepare(`
    SELECT r.*, e.staff_id FROM registrations r
    JOIN events e ON e.id = r.event_id WHERE r.id = ?
  `).get(Number(req.params.id));
  if (!registration) return fail(res, 404, 'Registration not found.');
  if (registration.staff_id !== req.user.id) return fail(res, 403, 'You can only check in attendees for your events.');
  const attended = requestBody(req).attended;
  if (attended !== true) return fail(res, 400, 'Attendance can only be marked as attended.');
  db.prepare('UPDATE registrations SET attended = 1 WHERE id = ?').run(registration.id);
  res.json({ message: 'Attendance recorded.' });
});

// Return clear JSON errors instead of Express's default HTML error page.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Event photos must be 2 MB or smaller.'
      : 'Choose one event photo and try again.';
    return fail(res, status, message);
  }
  const malformedJson = error instanceof SyntaxError && error.status === 400 && 'body' in error;
  if (malformedJson) return fail(res, 400, 'Request body must contain valid JSON.');
  if (error.status === 400) return fail(res, 400, error.message);
  console.error(error);
  fail(res, 500, 'An unexpected server error occurred.');
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`University Events is running at http://localhost:${PORT}`));
}

module.exports = app;
