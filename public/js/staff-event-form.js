(async function () {
  // The same form is used to create and edit events.
  const form = document.getElementById('event-form');
  const message = document.getElementById('form-message');
  const eventId = new URLSearchParams(location.search).get('id');
  const imageInput = document.getElementById('event-image');
  const imageAlt = document.getElementById('image-alt');
  const imagePreview = document.getElementById('image-preview');
  const meetingField = document.getElementById('meeting-link-field');
  const meetingUrl = document.getElementById('meetingUrl');
  const eventModeError = document.getElementById('eventMode-error');
  let previewUrl = '';
  let hasAttemptedSubmit = false;
  form.noValidate = true;

  function updateMeetingField() {
    const selectedMode = form.querySelector('input[name="eventMode"]:checked')?.value;
    const isOnline = selectedMode === 'online';
    meetingField.hidden = !isOnline;
    meetingUrl.required = isOnline;
    if (!isOnline) meetingUrl.value = '';
  }

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
      .filter((control) => control.willValidate && control.type !== 'file' && control.type !== 'submit');
    const invalidRadioNames = new Set();
    let firstInvalid = null;
    for (const control of controls) {
      if (control.type === 'radio') {
        if (invalidRadioNames.has(control.name)) continue;
        invalidRadioNames.add(control.name);
        const group = Array.from(form.querySelectorAll(`input[type="radio"][name="${control.name}"]`));
        const valid = group.some((radio) => radio.checked);
        if (control.name === 'eventMode') {
          eventModeError.hidden = valid;
          eventModeError.textContent = valid ? '' : 'Choose the event format.';
          for (const radio of group) {
            if (valid) {
              radio.removeAttribute('aria-invalid');
              radio.removeAttribute('aria-describedby');
            } else {
              radio.setAttribute('aria-invalid', 'true');
              radio.setAttribute('aria-describedby', eventModeError.id);
            }
          }
          if (!valid) {
            firstInvalid ||= group[0];
          }
        }
        continue;
      }
      if (!updateFieldError(control)) firstInvalid ||= control;
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return false;
    }
    return true;
  }

  imageInput.addEventListener('change', () => {
    imageAlt.required = imageInput.files.length > 0;
    if (hasAttemptedSubmit) updateFieldError(imageAlt);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = imageInput.files.length ? URL.createObjectURL(imageInput.files[0]) : '';
    imagePreview.hidden = !previewUrl;
    if (previewUrl) imagePreview.src = previewUrl;
  });
  form.querySelectorAll('input[name="eventMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      updateMeetingField();
      if (hasAttemptedSubmit) validateForm();
    });
  });
  updateMeetingField();
  document.getElementById('eventDate').min = new Date().toISOString().slice(0, 10);

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
      form.querySelector(`input[name="eventMode"][value="${event.event_mode || 'in_person'}"]`).checked = true;
      meetingUrl.value = event.meeting_url || '';
      updateMeetingField();
      const today = new Date().toISOString().slice(0, 10);
      if (event.event_date < today) document.getElementById('eventDate').min = event.event_date;
      imageAlt.value = event.image_alt || '';
      if (event.image_url) {
        imagePreview.src = event.image_url;
        imagePreview.hidden = false;
      }
    }
  } catch (error) {
    App.showMessage(message, error.message, 'error');
    form.querySelector('button[type="submit"]').disabled = true;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hasAttemptedSubmit = true;
    if (!validateForm()) {
      App.showMessage(message, 'Please correct the highlighted fields.', 'error');
      return;
    }
    const data = new FormData(form);
    data.set('capacity', String(Number(data.get('capacity'))));
    App.showMessage(message, 'Saving event…');
    try {
      await App.api(eventId ? `/api/events/${eventId}` : '/api/events', {
        method: eventId ? 'PUT' : 'POST',
        body: data
      });
      location.assign('/staff/events.html?saved=1');
    } catch (error) {
      App.showMessage(message, error.message, 'error');
    }
  });
})();
