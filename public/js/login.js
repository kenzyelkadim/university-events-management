const loginForm = document.getElementById('login-form');
const authMessage = document.getElementById('auth-message');

function enterPortal(user) {
  const home = user.role === 'student'
    ? '/student/dashboard.html'
    : '/staff/dashboard.html';
  location.assign(home);
}

// Send the sign-in details, save the session token, and open the user's main task.
loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  App.showMessage(authMessage, 'Signing in…');
  try {
    const formData = new FormData(loginForm);
    const data = await App.api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: formData.get('email'),
        password: formData.get('password')
      })
    });
    App.setSession(data);
    enterPortal(data.user);
  } catch (error) {
    App.showMessage(authMessage, error.message, 'error');
  }
});
