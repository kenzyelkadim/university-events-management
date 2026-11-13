(async function () {
  // Load the student's registrations and add one table row for each event.
  const status = document.getElementById('registrations-status');
  const rows = document.getElementById('registration-rows');
  const browseLink = document.getElementById('browse-events-link');
  try {
    await App.requireUser(['student']);
    const registrations = await App.api('/api/registrations');
    rows.replaceChildren();
    if (!registrations.length) {
      App.showMessage(status, 'You do not have any registrations yet.');
      browseLink.hidden = false;
      return;
    }
    browseLink.hidden = true;
    for (const registration of registrations) {
      const row = document.createElement('tr');
      const eventCell = document.createElement('th');
      eventCell.scope = 'row';
      eventCell.dataset.label = 'Event';
      const link = document.createElement('a');
      link.href = `/student/event.html?id=${registration.event_id}`;
      link.textContent = registration.event_title;
      eventCell.append(link);
      const date = document.createElement('td');
      date.textContent = new Date(`${registration.event_date}T00:00:00`).toLocaleDateString();
      date.dataset.label = 'Date';
      const location = document.createElement('td');
      location.textContent = registration.location;
      location.dataset.label = 'Location';
      const state = document.createElement('td');
      state.append(registrationBadge(registration));
      state.dataset.label = 'Status';
      row.append(eventCell, date, location, state);
      rows.append(row);
    }
    App.showMessage(status, `${registrations.length} registration${registrations.length === 1 ? '' : 's'}.`);
  } catch (error) {
    App.showMessage(status, error.message, 'error');
  }

  function registrationBadge(registration) {
    const badge = document.createElement('span');
    badge.className = `badge ${registration.attended ? 'badge-attended' : 'badge-registered'}`;
    badge.textContent = registration.attended ? 'Attended' : 'Registered';
    return badge;
  }
})();