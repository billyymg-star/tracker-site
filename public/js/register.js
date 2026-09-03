document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorMsg = document.getElementById('errorMsg');
  errorMsg.classList.remove('show');

  const name = document.getElementById('name').value;
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      errorMsg.textContent = data.error || 'Erreur lors de la création du compte.';
      errorMsg.classList.add('show');
      return;
    }

    window.location.href = '/login.html';
  } catch (err) {
    errorMsg.textContent = 'Impossible de contacter le serveur.';
    errorMsg.classList.add('show');
  }
});
