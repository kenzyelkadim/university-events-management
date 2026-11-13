(async function () {
  const status = document.getElementById('dashboard-status');
  const nextEvent = document.getElementById('next-event');

  try {
    await App.requireUser(['student']);
    const [events, registrations] = await Promise.all([
      App.api('/api/events'),
      App.api('/api/registrations')
    ]);
    document.getElementById('upcoming-count').textContent = String(events.length);
    document.getElementById('registration-count').textContent = String(registrations.length);

    const today = new Date().toISOString().slice(0, 10);
    const nextRegistration = registrations
      .filter((registration) => registration.event_date >= today)
      .sort((a, b) => a.event_date.localeCompare(b.event_date))[0];
    if (nextRegistration) {
      const link = document.createElement('a');
      link.href = `/student/event.html?id=${encodeURIComponent(nextRegistration.event_id)}`;
      link.textContent = `${nextRegistration.event_title} — ${new Date(`${nextRegistration.event_date}T00:00:00`).toLocaleDateString()}`;
      nextEvent.replaceChildren(link);
    } else {
      nextEvent.textContent = 'You have no upcoming registrations.';
      const browse = document.createElement('a');
      browse.href = '/student/events.html';
      browse.textContent = 'Browse upcoming events';
      nextEvent.append(document.createTextNode(' '), browse);
    }
    App.showMessage(status, 'Dashboard loaded.');
  } catch (error) {
    App.showMessage(status, error.message, 'error');
  }
})();
