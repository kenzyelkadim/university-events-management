(function () {
  // Shared helpers used by each page's JavaScript file.
  const tokenKey = 'university-events-token';
  const statusAnnouncement = document.createElement('div');
  statusAnnouncement.className = 'visually-hidden';
  statusAnnouncement.setAttribute('role', 'status');
  statusAnnouncement.setAttribute('aria-atomic', 'true');
  const errorAnnouncement = document.createElement('div');
  errorAnnouncement.className = 'visually-hidden';
  errorAnnouncement.setAttribute('role', 'alert');
  errorAnnouncement.setAttribute('aria-atomic', 'true');
  document.body.append(statusAnnouncement, errorAnnouncement);

  // Add the saved sign-in token and handle JSON responses consistently.
  async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = sessionStorage.getItem(tokenKey);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(url, { ...options, headers });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('The server is running an older version. Stop it and restart with npm start.');
    }
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        sessionStorage.removeItem(tokenKey);
        if (location.pathname !== '/') location.assign('/');
      }
      throw new Error(result.message || 'The request could not be completed.');
    }
    return result;
  }

  function setSession(data) {
    sessionStorage.setItem(tokenKey, data.token);
    sessionStorage.setItem('university-events-user', JSON.stringify(data.user));
  }

  function showMessage(element, message, kind = 'status') {
    element.textContent = message;
    element.className = `message ${kind}`;
    element.hidden = !message;
    statusAnnouncement.textContent = '';
    errorAnnouncement.textContent = '';
    if (message) {
      const announcement = kind === 'error' ? errorAnnouncement : statusAnnouncement;
      requestAnimationFrame(() => {
        announcement.textContent = message;
      });
    }
  }

  // Show different navigation links depending on the signed-in user's role.
  function renderNav(user) {
    const nav = document.getElementById('app-nav');
    if (!nav) return;
    const studentLinks = [
      ['/student/dashboard.html', 'Dashboard'],
      ['/student/events.html', 'Browse events'],
      ['/student/registrations.html', 'My registrations']
    ];
    const eventTeamLinks = [
      ['/staff/dashboard.html', 'Dashboard'],
      ['/staff/events.html', 'Manage events'],
      ['/staff/attendees.html', 'Check in attendees']
    ];
    const links = user.role === 'student' ? studentLinks : eventTeamLinks;
    nav.replaceChildren();
    const list = document.createElement('ul');
    list.className = 'nav-list';
    for (const [href, label] of links) {
      const link = document.createElement('a');
      link.href = href;
      link.textContent = label;
      if (new URL(href, location.origin).pathname === location.pathname) {
        link.setAttribute('aria-current', 'page');
      }
      const item = document.createElement('li');
      item.append(link);
      list.append(item);
    }
    const signOut = document.createElement('button');
    signOut.type = 'button';
    signOut.className = 'link-button';
    signOut.id = 'signout-button';
    signOut.textContent = 'Sign out';
    signOut.addEventListener('click', async () => {
      try {
        await api('/api/auth/logout', { method: 'POST' });
      } finally {
        sessionStorage.removeItem(tokenKey);
        sessionStorage.removeItem('university-events-user');
        location.assign('/');
      }
    });
    const signOutItem = document.createElement('li');
    signOutItem.append(signOut);
    list.append(signOutItem);
    nav.append(list);
  }

  // Check the current session before a protected page loads its content.
  async function requireUser(roles) {
    let user;
    try {
      user = await api('/api/me');
    } catch (error) {
      if (location.pathname !== '/') location.assign('/');
      throw error;
    }
    if (roles && !roles.includes(user.role)) {
      const message = document.getElementById('page-message');
      if (message) showMessage(message, 'You do not have permission to view this page.', 'error');
      const home = user.role === 'student' ? '/student/dashboard.html' : '/staff/dashboard.html';
      location.assign(`${home}?notice=permission`);
      throw new Error('You do not have permission to view this page.');
    }
    renderNav(user);
    if (new URLSearchParams(location.search).get('notice') === 'permission') {
      const message = document.getElementById('page-message');
      if (message) showMessage(message, 'You do not have permission to view that page. You are now on your dashboard.', 'error');
      history.replaceState(null, '', `${location.pathname}${location.hash}`);
    }
    const welcome = document.getElementById('welcome-name');
    if (welcome) welcome.textContent = user.name;
    return user;
  }

  window.App = { api, setSession, showMessage, requireUser, renderNav };
})();