const filtersForm = document.getElementById('filters');
const eventsStatus = document.getElementById('events-status');
const eventList = document.getElementById('event-list');
const eventCount = document.getElementById('event-count');
const showMore = document.getElementById('show-more-events');
const pageSize = 8;
let eventsToDisplay = [];
let visibleCount = pageSize;

const eventArtwork = {
  'Welcome Week Fair': {
    src: '/freshers.jpg',
    alt: 'Students listening to a speaker at a campus event.'
  },
  'Careers in Tech Talk': {
    src: '/speech2.jpg',
    alt: 'A speaker presenting at an event.'
  },
  'Pottery Painting Evening': {
    src: '/painting.jpg',
    alt: 'Students painting colorful designs on ceramic pottery.'
  },
  'Guest Speaker: Designing Better Cities': {
    src: '/speech.jpg',
    alt: 'A guest speaker presenting to an audience.'
  },
  'University Football Team Tryouts': {
    src: '/sports.jpg',
    alt: 'A player practicing on a sports field.'
  }
};

// Build event cards with text nodes so event data is displayed safely.
function makeEventCard(event) {
  const item = document.createElement('li');
  const card = document.createElement('article');
  card.className = 'event-card';
  const title = document.createElement('h2');
  const titleLink = document.createElement('a');
  titleLink.href = `/student/event.html?id=${encodeURIComponent(event.id)}`;
  titleLink.textContent = event.title;
  title.append(titleLink);

  const fallbackArtwork = eventArtwork[event.title];
  if (fallbackArtwork) {
    const image = document.createElement('img');
    image.className = 'event-image';
    image.src = fallbackArtwork.src;
    image.alt = fallbackArtwork.alt;
    image.loading = 'lazy';
    image.decoding = 'async';
    card.append(image);
  }

  const date = document.createElement('p');
  date.textContent = new Date(`${event.event_date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const details = document.createElement('p');
  details.textContent = `${event.category} · ${event.location}`;
  const capacity = document.createElement('p');
  capacity.textContent = `${event.registered_count} of ${event.capacity} places taken`;
  const method = document.createElement('span');
  method.className = 'badge event-method';
  method.textContent = 'First come, first served';
  card.append(title, date, details, capacity, method);
  item.append(card);
  return item;
}

function renderEvents() {
  const visible = eventsToDisplay.slice(0, visibleCount);
  eventList.replaceChildren(...visible.map(makeEventCard));
  eventCount.textContent = `Showing ${visible.length} of ${eventsToDisplay.length} event${eventsToDisplay.length === 1 ? '' : 's'}.`;
  showMore.hidden = visible.length >= eventsToDisplay.length;
}

// Read the filters, request matching events, then show the results.
async function loadEvents() {
  const formData = new FormData(filtersForm);
  const params = new URLSearchParams();
  for (const [key, value] of formData) if (value) params.set(key, value);
  App.showMessage(eventsStatus, 'Loading events…');
  eventCount.textContent = '';
  showMore.hidden = true;
  eventList.replaceChildren();
  try {
    const events = await App.api(`/api/events?${params}`);
    eventsToDisplay = events;
    visibleCount = pageSize;
    if (!events.length) {
      eventCount.textContent = 'Showing 0 events.';
      App.showMessage(eventsStatus, 'No events match these filters. Try changing your search or category.');
      return;
    }
    renderEvents();
    App.showMessage(eventsStatus, 'Events loaded. Results are ordered by date.');
  } catch (error) {
    App.showMessage(eventsStatus, error.message, 'error');
  }
}

filtersForm.addEventListener('submit', (event) => {
  event.preventDefault();
  loadEvents();
});
document.getElementById('clear-filters').addEventListener('click', () => {
  filtersForm.reset();
  loadEvents();
});
showMore.addEventListener('click', () => {
  visibleCount += pageSize;
  renderEvents();
});

App.requireUser(['student']).then(loadEvents).catch((error) => {
  if (!document.getElementById('page-message').textContent) {
    App.showMessage(document.getElementById('page-message'), error.message, 'error');
  }
});