# University Events Management System

A university events website created for coursework. Students can browse events and register for them, while the Event Team can create events, manage them and record attendance.

## Features

**Students**
- Browse and search upcoming events.
- Filter events by category.
- View event details and available places.
- Register for events and view their registrations.

**Event Team**
- View an event management dashboard.
- Create and edit events.
- View and search attendee lists.
- Mark students as attended.

## Technologies Used

- HTML and CSS
- JavaScript
- Node.js and Express
- SQLite

## Running the Project

Make sure Node.js and npm are installed. Then open a terminal in the project folder and run:

```bash
npm install
npm run seed
npm start
```

Open the application at:

`http://localhost:3000`

The seed command adds fictional students, an Event Team account, sample events and registrations to the database.

The sample accounts use the password:

`campus123`

## Running Tests

To run the available automated tests:

```bash
npm test
```

## Notes

The application uses SQLite to store users, events and registrations. Uploaded event images are stored locally.

This is a coursework project, so authentication and account management are simplified and are not intended for production use.

Accessibility has been considered during development, including form labels, keyboard navigation and responsive layouts. Further automated and manual accessibility testing is part of the project evaluation.
