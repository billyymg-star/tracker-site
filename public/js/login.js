document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorMsg = document.getElementById('errorMsg');
  errorMsg.classList.remove('show');

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      errorMsg.textContent = data.error || 'Erreur de connexion.';
      errorMsg.classList.add('show');
      return;
    }

    window.location.href = '/dashboard.html';
  } catch (err) {
    errorMsg.textContent = 'Impossible de contacter le serveur.';
    errorMsg.classList.add('show');
  }
});
