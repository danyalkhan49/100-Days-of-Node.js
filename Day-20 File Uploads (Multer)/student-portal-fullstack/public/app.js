const message = document.getElementById('message');

function showMessage(text, isError) {
  message.textContent = text;
  message.className = isError ? 'message error' : 'message success';
}
function getErrorText(data) {
  if (data?.errors?.length > 0) {
    return data.errors.map((e) => e.msg).join(', ');
  }
  return data?.error || 'Something went wrong';
}

async function readResponse(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

// ---------- SIGNUP ----------
document.getElementById('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const body = {
    name: document.getElementById('signupName').value,
    email: document.getElementById('signupEmail').value,
    password: document.getElementById('signupPassword').value
  };

  try {
    const res = await fetch('/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await readResponse(res);

    if (!res.ok) {
      showMessage(getErrorText(data), true);
      return;
    }

    showMessage('Registered! You can now log in below.', false);
    e.target.reset();
  } catch {
    showMessage('Could not connect to the server.', true);
  }
});

// ---------- LOGIN ----------
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const body = {
    email: document.getElementById('loginEmail').value,
    password: document.getElementById('loginPassword').value
  };

  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await readResponse(res);

    if (!res.ok) {
      showMessage(getErrorText(data), true);
      return;
    }

    if (!data.token) {
      showMessage('The server did not return an authentication token.', true);
      return;
    }

    localStorage.setItem('token', data.token);
    window.location.href = '/profile.html';
  } catch {
    showMessage('Could not connect to the server.', true);
  }
});