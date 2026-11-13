(async function () {
  const eventSelect = document.getElementById('event-select');
  const search = document.getElementById('attendee-search');
  const status = document.getElementById('attendance-status');
  const count = document.getElementById('attendee-count');
  const rows = document.getElementById('attendee-rows');
  let attendees = [];

  function renderAttendees(announce = true) {
    const query = search.value.trim().toLocaleLowerCase();
    const visible = attendees.filter((attendee) =>
      `${attendee.student_name} ${attendee.student_email}`.toLocaleLowerCase().includes(query)
    );

    rows.replaceChildren();
    for (const attendee of visible) {
      const row = document.createElement('tr');
      row.dataset.registrationId = attendee.id;

      const name = document.createElement('th');
      name.scope = 'row';
      name.textContent = attendee.student_name;
      name.dataset.label = 'Student';

      const email = document.createElement('td');
      email.textContent = attendee.student_email;
      email.dataset.label = 'Email';

      const attendance = document.createElement('td');
      attendance.dataset.label = 'Attendance';
      if (attendee.attended) {
        attendance.textContent = 'Attended';
        attendance.tabIndex = -1;
      } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Mark attended';
        button.setAttribute('aria-label', `Mark attended for ${attendee.student_name}`);
        button.addEventListener('click', () => markAttended(attendee, button));
        attendance.append(button);
      }

      row.append(name, email, attendance);
      rows.append(row);
    }

    count.textContent = `Showing ${visible.length} of ${attendees.length} attendee${attendees.length === 1 ? '' : 's'}.`;
    const message = visible.length
      ? `${visible.length} attendee${visible.length === 1 ? '' : 's'} shown.`
      : attendees.length ? 'No attendees match this search.' : 'No students have registered for this event yet.';
    if (announce) App.showMessage(status, message);
    else {
      status.textContent = message;
      status.className = 'message';
      status.hidden = false;
    }
  }

  async function loadAttendees() {
    if (!eventSelect.value) {
      attendees = [];
      rows.replaceChildren();
      count.textContent = '';
      App.showMessage(status, 'Choose an event to view its attendees.');
      return;
    }

    App.showMessage(status, 'Loading attendees…');
    count.textContent = '';
    rows.replaceChildren();
    try {
      attendees = await App.api(`/api/registrations?eventId=${encodeURIComponent(eventSelect.value)}`);
      renderAttendees();
    } catch (error) {
      App.showMessage(status, error.message, 'error');
    }
  }

  async function markAttended(attendee, button) {
    button.disabled = true;
    try {
      await App.api(`/api/registrations/${attendee.id}/attendance`, {
        method: 'PATCH',
        body: JSON.stringify({ attended: true })
      });
      attendee.attended = 1;
      renderAttendees(false);
      App.showMessage(status, `${attendee.student_name} marked as attended.`);
      rows.querySelector(`[data-registration-id="${attendee.id}"] td:last-child`)?.focus();
    } catch (error) {
      App.showMessage(status, error.message, 'error');
      button.disabled = false;
    }
  }

  eventSelect.addEventListener('change', loadAttendees);
  search.addEventListener('input', () => renderAttendees(false));
  search.addEventListener('change', () => renderAttendees(true));

  try {
    await App.requireUser(['staff']);
    const ownedEvents = await App.api('/api/staff/events');
    for (const event of ownedEvents) {
      eventSelect.add(new Option(`${event.title} — ${event.event_date}`, event.id));
    }

    if (!ownedEvents.length) {
      App.showMessage(status, 'You have not created any events with attendee lists yet.');
      return;
    }

    const requestedEvent = new URLSearchParams(location.search).get('eventId');
    const selectedEvent = ownedEvents.find((event) => String(event.id) === requestedEvent);
    const today = new Date().toISOString().slice(0, 10);
    const nextEvent = ownedEvents.find((event) => event.event_date >= today);
    eventSelect.value = String(selectedEvent ? selectedEvent.id : nextEvent ? nextEvent.id : ownedEvents[0].id);
    await loadAttendees();
  } catch (error) {
    App.showMessage(status, error.message, 'error');
  }
})();
