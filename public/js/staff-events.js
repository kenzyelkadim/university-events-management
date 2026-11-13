(async function () {
  const status = document.getElementById('events-status');
  const rows = document.getElementById('event-rows');
  const count = document.getElementById('event-count');
  const showMore = document.getElementById('show-more-events');
  const pageSize = 10;
  let events = [];
  let sortKey = 'event_date';
  let sortDirection = 1;
  let visibleCount = pageSize;

  function renderEvents() {
    const sorted = [...events].sort((a, b) => {
      const left = a[sortKey];
      const right = b[sortKey];
      const comparison = typeof left === 'number'
        ? left - right
        : String(left).localeCompare(String(right));
      return comparison * sortDirection;
    });
    const visible = sorted.slice(0, visibleCount);
    rows.replaceChildren();
    for (const event of visible) {
      const row = document.createElement('tr');
      const title = document.createElement('th');
      title.scope = 'row';
      title.textContent = event.title;
      title.dataset.label = 'Event';
      const date = document.createElement('td');
      date.textContent = new Date(`${event.event_date}T00:00:00`).toLocaleDateString();
      date.dataset.label = 'Date';
      const registered = document.createElement('td');
      registered.textContent = `${event.registered_count} / ${event.capacity}`;
      registered.dataset.label = 'Places registered';
      const action = document.createElement('td');
      action.dataset.label = 'Actions';
      const edit = document.createElement('a');
      edit.href = `/staff/event-form.html?id=${event.id}`;
      edit.textContent = 'Edit';
      edit.setAttribute('aria-label', `Edit ${event.title}`);
      const attendees = document.createElement('a');
      attendees.href = `/staff/attendees.html?eventId=${event.id}`;
      attendees.textContent = 'Attendees';
      attendees.setAttribute('aria-label', `View attendees for ${event.title}`);
      action.append(edit, document.createTextNode(' · '), attendees);
      row.append(title, date, registered, action);
      rows.append(row);
    }

    count.textContent = `Showing ${visible.length} of ${events.length} event${events.length === 1 ? '' : 's'}.`;
    showMore.hidden = visible.length >= events.length;
  }

  document.querySelectorAll('.table-sort').forEach((button) => {
    button.addEventListener('click', () => {
      const header = button.closest('th');
      if (sortKey === button.dataset.sort) sortDirection *= -1;
      else {
        sortKey = button.dataset.sort;
        sortDirection = 1;
      }
      document.querySelectorAll('.table-sort').forEach((sortButton) => {
        sortButton.closest('th').setAttribute('aria-sort', 'none');
      });
      header.setAttribute('aria-sort', sortDirection === 1 ? 'ascending' : 'descending');
      visibleCount = pageSize;
      renderEvents();
    });
  });
  showMore.addEventListener('click', () => {
    visibleCount += pageSize;
    renderEvents();
  });

  try {
    await App.requireUser(['staff']);
    events = await App.api('/api/staff/events');
    const params = new URLSearchParams(location.search);
    const saved = params.get('saved') === '1';
    params.delete('saved');
    history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}`);
    if (!events.length) {
      count.textContent = 'Showing 0 events.';
      App.showMessage(status, 'You have not created any events yet.');
      return;
    }
    renderEvents();
    App.showMessage(status, saved ? 'Event saved successfully.' : 'Your events are ready.');
  } catch (error) {
    App.showMessage(status, error.message, 'error');
  }
})();
