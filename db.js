const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(__dirname, 'events.db'));
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma('foreign_keys = ON');

// Create the main tables the first time the app starts.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('student', 'staff')),
    faculty TEXT NOT NULL DEFAULT 'Computer Science',
    password_hash TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
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

  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    attended INTEGER NOT NULL DEFAULT 0 CHECK (attended IN (0, 1)),
    registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id),
    FOREIGN KEY (student_id) REFERENCES users(id),
    UNIQUE (event_id, student_id)
  );
`);

// Add newer fields to databases created by earlier versions of the project.
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('users', 'faculty', "TEXT NOT NULL DEFAULT 'Computer Science'");
ensureColumn('users', 'password_hash', 'TEXT');
ensureColumn('events', 'category', "TEXT NOT NULL DEFAULT 'General'");
ensureColumn('events', 'image_path', 'TEXT');
ensureColumn('events', 'image_alt', "TEXT NOT NULL DEFAULT ''");
ensureColumn('events', 'event_mode', "TEXT NOT NULL DEFAULT 'in_person'");
ensureColumn('events', 'meeting_url', "TEXT NOT NULL DEFAULT ''");
ensureColumn('registrations', 'attended', 'INTEGER NOT NULL DEFAULT 0');

// Keep existing databases compatible with the two current roles and event ownership.
db.prepare("UPDATE users SET role = 'staff' WHERE role = 'organizer'").run();
const eventColumns = db.prepare('PRAGMA table_info(events)').all();
if (eventColumns.some((item) => item.name === 'organizer_id')
  && !eventColumns.some((item) => item.name === 'staff_id')) {
  db.exec('ALTER TABLE events RENAME COLUMN organizer_id TO staff_id');
}
const initialRegistrationColumns = db.prepare('PRAGMA table_info(registrations)').all().map((item) => item.name);
if (initialRegistrationColumns.includes('applied_at') && !initialRegistrationColumns.includes('registered_at')) {
  db.exec('ALTER TABLE registrations RENAME COLUMN applied_at TO registered_at');
}

const legacyEventFields = new Set(['eligible_faculty', 'application_question', 'registration_method']);
const legacyRegistrationFields = new Set(['status', 'application_answer']);
const currentEventColumns = db.prepare('PRAGMA table_info(events)').all();
const currentRegistrationColumns = db.prepare('PRAGMA table_info(registrations)').all();
const eventFields = currentEventColumns.map((item) => item.name);
const registrationFields = currentRegistrationColumns.map((item) => item.name);
const needsSimpleWorkflowMigration = eventFields.some((field) => legacyEventFields.has(field))
  || registrationFields.some((field) => legacyRegistrationFields.has(field));

if (needsSimpleWorkflowMigration) {
  const removedApplications = registrationFields.includes('status')
    ? db.prepare("SELECT COUNT(*) AS count FROM registrations WHERE status != 'approved'").get().count
    : 0;
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE events_clean (
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
      INSERT INTO events_clean
        (id, title, description, location, event_date, capacity, staff_id, category, image_path,
         image_alt, event_mode, meeting_url)
      SELECT id, title, description, location, event_date, capacity, staff_id, category, image_path,
        image_alt, event_mode, meeting_url
      FROM events;

      CREATE TABLE registrations_clean (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        attended INTEGER NOT NULL DEFAULT 0 CHECK (attended IN (0, 1)),
        registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events_clean(id),
        FOREIGN KEY (student_id) REFERENCES users(id),
        UNIQUE (event_id, student_id)
      );
    `);
    const activeOnly = registrationFields.includes('status') ? " WHERE status = 'approved'" : '';
    const timestampColumn = registrationFields.includes('registered_at') ? 'registered_at' : 'applied_at';
    db.exec(`
      INSERT INTO registrations_clean (id, event_id, student_id, attended, registered_at)
      SELECT id, event_id, student_id, attended, ${timestampColumn}
      FROM registrations${activeOnly};
      DROP TABLE registrations;
      DROP TABLE events;
      ALTER TABLE events_clean RENAME TO events;
      ALTER TABLE registrations_clean RENAME TO registrations;
    `);
  })();
  db.pragma('foreign_keys = ON');
  const foreignKeyErrors = db.pragma('foreign_key_check');
  if (foreignKeyErrors.length) throw new Error('Legacy registration migration left invalid references.');
  if (removedApplications) {
    console.info(`Removed ${removedApplications} legacy non-registration application record(s); active registrations were retained.`);
  }
}

// These indexes keep the common event and registration lookups quick.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
  CREATE INDEX IF NOT EXISTS idx_registrations_event ON registrations(event_id);
  CREATE INDEX IF NOT EXISTS idx_registrations_student ON registrations(student_id);
`);

module.exports = db;
