# University Events Management System

A small coursework application built with semantic HTML, CSS, vanilla JavaScript, Express and SQLite. It has two account types: students discover and register for events; the Event Team publishes events and records attendance. Organizers and ushers share the Event Team account type. Account administration is handled outside the app.

## Run locally

Requirements: Node.js 24 and npm.

```powershell
npm install
npm start
```

Open `http://localhost:3000`. Starting the app creates the database schema but does not add accounts or events.

To add fictional coursework data, run this once before starting the app:

```powershell
npm run seed
```

For deployment, set `DATABASE_PATH` to the persistent SQLite file path. It defaults to `events.db`. Relative configured paths resolve from the process working directory, and the database's parent directory is created automatically.

The seed command can be run again without duplicating seeded users, events or registrations. It adds missing sample data and does not delete existing events or registrations. Seeded sample accounts use the demo password `campus123`. Startup preserves active registrations and attendance while migrating older event-manager accounts to the staff role. Obsolete application records that were not approved as registrations are removed during the one-time database migration.

The optional seed data includes 10 fictional students, one Event Team account, five upcoming events and example registrations. Events include a welcome fair, a technology careers talk, pottery painting, a guest speaker and football tryouts. Sign-in requires an account already present in the university database.

Authentication is a simplified coursework implementation. Passwords are stored as salted hashes, and in-memory sessions expire when the server restarts. A real deployment needs individual account provisioning and password management, persistent secure sessions, HTTPS, CSRF protections, rate limiting, privacy review and production secrets/configuration.

## Project structure

```text
server.js                         Express API and authorization rules
db.js                             SQLite schema and migrations
seed.js                           Optional coursework users, events and registrations
auth.js                           Salted password hashing and verification
events.db                         Default local SQLite database (`DATABASE_PATH`)
public/
  index.html                      University email and password sign-in
  style.css                       Shared responsive and accessibility styles
  *.jpg                           Event photos
  js/
    common.js                     API helper, session state, role navigation
    login.js                      Handle sign-in
    student-dashboard.js          Student activity overview
    staff-dashboard.js            Event Team activity overview
    events.js                     Search and event filters
    event.js                      Event details and registration
    registrations.js              Student registration list
    staff-events.js               Event Team event list
    staff-event-form.js           Create/edit event form
    staff-attendees.js            Search attendees and mark attendance
  student/
    dashboard.html
    events.html
    event.html
    registrations.html
  staff/
    dashboard.html
    events.html
    event-form.html
    attendees.html
```

## Page and interaction inventory

| Area | Page | Main interactions |
|---|---|---|
| Student / staff | Sign in | Sign in with an existing university account |
| Student | Dashboard | Upcoming-event and registration counts; next registered event |
| Student | Browse events | Search title/description/location; filter by category; show more results. Hover or focus an event card and activate anywhere on it to open details. |
| Student | Event details | View date, location and capacity; register while places remain |
| Student | My registrations | Current status and event details |
| Event Team | Dashboard | Upcoming events, registration totals and next event |
| Event Team | Manage events | Create/edit, sort and progressively reveal events, including past events |
| Event Team | Check in attendees | Search attendees for any owned event, including past events, and mark attendance |

## Data model

```text
users (1) ──< events (staff_id)
users (1) ──< registrations >── (1) events
```

- `users`: name, unique email and account type (`student`, `staff`). The app labels the staff account type “Event Team.”
- `events`: title, description, date, location, capacity, category and staff owner.
- Event cards use the existing static campus photos where a matching sample event has artwork.
- Older image and online-event database columns are retained for existing databases but are no longer used by the app.
- `registrations`: unique event/student pair, attendance flag and registration date.
- Foreign keys and indexes support referential integrity and event/registration lookups.

Students can register for any event with space. Registration is immediate and places are awarded first come, first served. Event Team members can view registered students and mark attendance. Event capacity cannot be lowered below the number already registered.

## Backend route contract

All JSON errors use `{ "message": "..." }`. Protected routes require a bearer token from the provided-account login flow.

| Method | Route | Access | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | Public | Sign in with an existing email and password |
| POST | `/api/auth/logout` | Public | End the in-memory session |
| GET | `/api/me` | Signed in | Current user and role |
| GET | `/api/events` | Public | Upcoming event list; optional `search` and `category` filters |
| GET | `/api/events/:id` | Signed in | Event details |
| GET | `/api/staff/events` | Event Team (`staff`) | All events owned by the current staff member, including past events |
| POST | `/api/events` | Event Team (`staff`) | Create an event |
| PUT | `/api/events/:id` | Owning Event Team member | Update an event |
| GET | `/api/registrations` | Signed in | Student's registrations or the Event Team's attendee list for one of its events |
| POST | `/api/registrations` | Student | Register for an event |
| PATCH | `/api/registrations/:id/attendance` | Owning Event Team member | Mark a registered student as attended |

## Validation and business rules

- Sign-in is available only for accounts already in the database; there is no public account-creation form.
- Event title (1–120), description (1–2,000), location (1–160), category and valid date are required.
- New events must be today or in the future. Existing past events remain editable for attendance records.
- Capacity is an integer from 1 to 10,000; it cannot be lowered below registered students.
- A student can register once per event. A full event rejects new registrations with a clear message.
- Students cannot cancel registrations in the app; the event details and registrations pages remind them to register only if they expect to attend.
- Only the Event Team member who created an event may edit it, view its attendees or mark attendance.
- Event Team event and attendee lists include past events; the student browse list remains upcoming-only.
- Attendance can only be marked as attended; it cannot be undone through the app.

## Accessibility checklist

- Semantic landmarks, one page-level `h1`, descriptive form labels, and skip links.
- Keyboard-operable navigation and controls; visible high-contrast focus indication.
- Native input constraints plus server validation; feedback uses polite live status regions.
- Errors and status are not communicated by colour alone; status labels are text.
- Responsive layouts, tables that become labelled stacked rows on narrow screens, and flexible typography/layout for 200% zoom.
- Verify contrast and actual screen-reader/keyboard behavior in the target browsers before submission; automated checks do not replace manual review.
- Accessibility evaluation remains a coursework deliverable; run and document the required automated and manual checks before submission.

## Test plan

Automated smoke/API tests run with `npm test`. Manual coursework checks:

1. Run `npm run seed`, sign in with a seeded student and Event Team member, and confirm each opens the correct dashboard.
2. Search/filter events by text and category; verify empty/loading/error states and that events are open to all students.
3. Test registration, duplicate registration, and full-event limits.
4. Create/edit events; check required fields, invalid dates/capacity, capacity reduction and staff ownership.
5. Search an event's attendees and mark someone as attended; confirm past events remain available and another Event Team member cannot view or check in attendees.
6. Complete every flow with keyboard only, at 200% zoom and with a screen reader; review contrast and narrow-screen layout.

## Deployment outline

For assessment demonstration, optionally run `npm run seed` before starting the app. For a hosted deployment, set `DATABASE_PATH` to persistent storage, set `PORT` from the hosting platform, serve only over HTTPS, and replace coursework authentication with secure credential provisioning and sessions. Back up the database and test migrations before each deployment. Do not commit local database files, real user data, secrets or production credentials.
