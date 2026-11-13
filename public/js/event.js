(async function () {
  // Load the event and show the direct registration action.
  const detail = document.getElementById('event-detail');
  const status = document.getElementById('event-status');
  const title = document.getElementById('event-title');
  const id = new URLSearchParams(location.search).get('id');

  try {
    await App.requireUser(['student']);
    if (!id || !/^\d+$/.test(id)) throw new Error('Choose a valid event.');
    const event = await App.api(`/api/events/${encodeURIComponent(id)}`);
    const registrations = await App.api('/api/registrations');
    const registration = registrations.find((item) => item.event_id === event.id);
    const placesLeft = Math.max(0, event.capacity - event.registered_count);
    detail.replaceChildren();

    title.textContent = event.title;
    document.title = `${event.title} | University Events`;
    const description = document.createElement('p');
    description.textContent = event.description;
    description.className = 'lead';
    const info = document.createElement('dl');
    for (const [label, value] of [
      ['Date', new Date(`${event.event_date}T00:00:00`).toLocaleDateString(undefined, { dateStyle: 'long' })],
      ['Location', event.location],
      ['Category', event.category],
      ['Event contact', event.staff_name],
      ['Places remaining', `${placesLeft} of ${event.capacity}`]
    ]) {
      const term = document.createElement('dt');
      term.textContent = label;
      const descriptionItem = document.createElement('dd');
      descriptionItem.textContent = value;
      info.append(term, descriptionItem);
    }
    const feedback = document.createElement('p');
    feedback.className = 'message event-feedback';
    detail.append(feedback, description, info);

    if (registration) {
      App.showMessage(feedback, 'You are registered for this event.');
    } else if (placesLeft === 0) {
      App.showMessage(feedback, 'This event is full.');
    } else {
      const attendanceReminder = document.createElement('p');
      attendanceReminder.className = 'message';
      attendanceReminder.textContent = 'Before registering: please make sure you expect to attend. You cannot cancel your registration in the app, and your place will remain reserved.';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Register for this event';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const result = await App.api('/api/registrations', {
            method: 'POST',
            body: JSON.stringify({ eventId: event.id })
          });
          App.showMessage(feedback, result.message);
          button.remove();
          const registrationsLink = document.createElement('a');
          registrationsLink.href = '/student/registrations.html';
          registrationsLink.textContent = 'View my registrations';
          detail.append(registrationsLink);
          registrationsLink.focus();
        } catch (error) {
          App.showMessage(feedback, error.message, 'error');
          button.disabled = false;
        }
      });
      detail.append(attendanceReminder, button);
    }
    App.showMessage(status, 'Event details loaded.');
  } catch (error) {
    App.showMessage(status, error.message, 'error');
  }
})();