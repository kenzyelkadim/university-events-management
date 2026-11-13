const db = require('./db');
const { hashPassword } = require('./auth');

const seedPassword = 'campus123';

// Use dates relative to today so the sample events stay upcoming.
function dateAfter(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Keep the sample accounts, events, and registrations together as one update.
const seed = db.transaction(() => {
  const addUser = db.prepare(`
    INSERT OR IGNORE INTO users (name, email, role, password_hash)
    VALUES (?, ?, ?, ?)
  `);
  const addSeedUser = (name, email, role) => {
    addUser.run(name, email, role, hashPassword(seedPassword));
  };
  addSeedUser('Amira Hassan', 'amira.hassan@example.edu', 'student');
  addSeedUser('Omar Adel', 'omar.adel@example.edu', 'student');
  addSeedUser('Nour El-Sayed', 'nour.elsayed@example.edu', 'student');
  addSeedUser('Karim Mahmoud', 'karim.mahmoud@example.edu', 'student');
  addSeedUser('Salma Youssef', 'salma.youssef@example.edu', 'student');
  addSeedUser('Youssef Hassan', 'youssef.hassan@example.edu', 'student');
  addSeedUser('Mariam Fathy', 'mariam.fathy@example.edu', 'student');
  addSeedUser('Hana Mostafa', 'hana.mostafa@example.edu', 'student');
  addSeedUser('Mostafa Ibrahim', 'mostafa.ibrahim@example.edu', 'student');
  addSeedUser('Farida Nabil', 'farida.nabil@example.edu', 'student');
  addSeedUser('Mariam Ibrahim', 'mariam.ibrahim@example.edu', 'staff');

  const staffMember = db.prepare('SELECT id FROM users WHERE email = ?').get('mariam.ibrahim@example.edu');
  const events = [
    {
      title: 'Welcome Week Fair',
      description: 'Meet student societies and discover campus activities.',
      location: 'Main Hall',
      date: dateAfter(30),
      capacity: 100,
      category: 'Community'
    },
    {
      title: 'Careers in Tech Talk',
      description: 'Hear from graduates working across the technology sector.',
      location: 'Lecture Theatre 2',
      date: dateAfter(35),
      capacity: 40,
      category: 'Careers',
      registrations: [
        'amira.hassan@example.edu',
        'karim.mahmoud@example.edu',
        'mariam.fathy@example.edu'
      ]
    },
    {
      title: 'Pottery Painting Evening',
      description: 'Paint a small ceramic piece, meet other students and take your finished work home.',
      location: 'Student Arts Studio',
      date: dateAfter(45),
      capacity: 24,
      category: 'Social',
      registrations: [
        'amira.hassan@example.edu',
        'nour.elsayed@example.edu',
        'hana.mostafa@example.edu',
        'farida.nabil@example.edu'
      ]
    },
    {
      title: 'Guest Speaker: Designing Better Cities',
      description: 'Urban designer Dr Lina Hassan discusses accessible public spaces and answers student questions.',
      location: 'Main Lecture Theatre',
      date: dateAfter(48),
      capacity: 60,
      category: 'Academic',
      registrations: [
        'salma.youssef@example.edu',
        'farida.nabil@example.edu',
        'nour.elsayed@example.edu'
      ]
    },
    {
      title: 'University Football Team Tryouts',
      description: 'Meet the coaches and take part in friendly skill and fitness drills. Bring sportswear and water.',
      location: 'North Campus Sports Field',
      date: dateAfter(50),
      capacity: 30,
      category: 'Sports',
      registrations: [
        'omar.adel@example.edu',
        'karim.mahmoud@example.edu',
        'mostafa.ibrahim@example.edu',
        'youssef.hassan@example.edu'
      ]
    },
  ];
  const addEvent = db.prepare(`
    INSERT INTO events (title, description, location, event_date, capacity, staff_id, category)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const event of events) {
    let savedEvent = db.prepare('SELECT id FROM events WHERE title = ? AND staff_id = ?')
      .get(event.title, staffMember.id);
    if (!savedEvent) {
      const result = addEvent.run(
        event.title,
        event.description,
        event.location,
        event.date,
        event.capacity,
        staffMember.id,
        event.category
      );
      savedEvent = { id: Number(result.lastInsertRowid) };
    }

    for (const email of event.registrations || []) {
      const student = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      db.prepare(`
        INSERT OR IGNORE INTO registrations (event_id, student_id)
        VALUES (?, ?)
      `).run(savedEvent.id, student.id);
    }
  }
});

// Insert sample rows only when they are not already in the database.
seed();
console.log(`Sample data is ready. Seeded accounts use password: ${seedPassword}`);
db.close();
