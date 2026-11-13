(async function () {
  const form = document.getElementById('event-form');
  const message = document.getElementById('form-message');
  const eventId = new URLSearchParams(location.search).get('id');
  const dateInput = document.getElementById('eventDate');
  form.noValidate = true;
  dateInput.min = new Date().toISOString().slice(0, 10);

  function updateFieldError(control) {
    let error = document.getElementById(`${control.id}-error`);
    if (!error) {
      error = document.createElement('p');
      error.id = `${control.id}-error`;
      error.className = 'field-error';
      control.insertAdjacentElement('afterend', error);
    }

    if (control.validity.valid) {
      control.removeAttribute('aria-invalid');
      error.hidden = true;
      error.textContent = '';
      const describedBy = (control.getAttribute('aria-describedby') || '')
        .split(/\s+/).filter((id) => id && id !== error.id);
      if (describedBy.length) control.setAttribute('aria-describedby', describedBy.join(' '));
      else control.removeAttribute('aria-describedby');
      return true;
    }

    control.setAttribute('aria-invalid', 'true');
    error.textContent = control.validationMessage || 'Check this field.';
    error.hidden = false;
    const describedBy = new Set((control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    describedBy.add(error.id);
    control.setAttribute('aria-describedby', Array.from(describedBy).join(' '));
    return false;
  }

  function validateForm() {
    const controls = Array.from(form.elements)
      .filter((control) => control.willValidate && control.type !== 'submit');
    let firstInvalid;
    for (const control of controls) {
      if (!updateFieldError(control)) firstInvalid ||= control;
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return false;
    }
    return true;
  }

  try {
    const user = await App.requireUser(['staff']);
    if (eventId) {
      if (!/^\d+$/.test(eventId)) throw new Error('Choose a valid event.');
      const event = await App.api(`/api/events/${eventId}`);
      if (event.staff_id !== user.id) throw new Error('You can only edit events you created.');
      document.getElementById('form-title').textContent = 'Edit event';
      document.getElementById('save-event').textContent = 'Save changes';
      for (const [name, value] of Object.entries({
        title: event.title,
        description: event.description,
        location: event.location,
        eventDate: event.event_date,
        category: event.category,
        capacity: event.capacity
      })) form.elements[name].value = value;
      if (event.event_date < dateInput.min) dateInput.min = event.event_date;
    }
  } catch (error) {
    App.showMessage(message, error.message, 'error');
    form.querySelector('button[type="submit"]').disabled = true;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!validateForm()) {
      App.showMessage(message, 'Please correct the highlighted fields.', 'error');
      return;
    }

    const data = Object.fromEntries(new FormData(form));
    data.capacity = Number(data.capacity);
    App.showMessage(message, 'Saving event…');
    try {
      await App.api(eventId ? `/api/events/${eventId}` : '/api/events', {
        method: eventId ? 'PUT' : 'POST',
        body: JSON.stringify(data)
      });
      location.assign('/staff/events.html?saved=1');
    } catch (error) {
      App.showMessage(message, error.message, 'error');
    }
  });
})();
