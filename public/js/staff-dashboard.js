(async function () {
  const status = document.getElementById('dashboard-status');
  const nextEvent = document.getElementById('next-event');

  try {
    await App.requireUser(['staff']);
    const events = await App.api('/api/staff/events');
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = events.filter((event) => event.event_date >= today);
    document.getElementById('upcoming-count').textContent = String(upcoming.length);
    document.getElementById('registration-count').textContent = String(
      events.reduce((total, event) => total + event.registered_count, 0)
    );

    if (upcoming.length) {
      const event = upcoming[0];
      const link = document.createElement('a');
      link.href = `/staff/attendees.html?eventId=${encodeURIComponent(event.id)}`;
      link.textContent = `${event.title} — ${new Date(`${event.event_date}T00:00:00`).toLocaleDateString()}`;
      nextEvent.replaceChildren(link);
    } else {
      nextEvent.textContent = 'You have no upcoming events.';
      const create = document.createElement('a');
      create.href = '/staff/event-form.html';
      create.textContent = 'Create an event';
      nextEvent.append(document.createTextNode(' '), create);
    }
    App.showMessage(status, 'Dashboard loaded.');
  } catch (error) {
    App.showMessage(status, error.message, 'error');
  }
})();
