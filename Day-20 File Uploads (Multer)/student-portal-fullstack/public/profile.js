const token = localStorage.getItem('token');

// Token hi nahi hai to login page par wapas bhejo
if (!token) {
  window.location.href = '/index.html';
}

const message = document.getElementById('message');
const avatarImg = document.getElementById('avatarImg');
const noPicture = document.getElementById('noPicture');

function showMessage(text, isError) {
  message.textContent = text;
  message.className = isError ? 'message error' : 'message success';
}

// ---------- PROFILE LOAD ----------
async function loadProfile() {
  const res = await fetch('/users/me', {
    headers: { Authorization: `Bearer ${token}` }   // token header mein
  });

  // Token expire ya galat hai
  if (res.status === 401) {
    localStorage.removeItem('token');
    window.location.href = '/index.html';
    return;
  }

  const data = await res.json();
  const user = data.data;

  document.getElementById('userName').textContent = user.name;
  document.getElementById('userEmail').textContent = user.email;

  if (user.avatar) {
    avatarImg.src = `/uploads/${user.avatar}`;
    avatarImg.hidden = false;
    noPicture.hidden = true;
  }
}

// ---------- UPLOAD ----------
document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const fileInput = document.getElementById('avatarInput');
  if (fileInput.files.length === 0) {
    showMessage('Pehle koi image choose karo', true);
    return;
  }

  // File bhejne ke liye JSON nahi, FormData use hota hai
  const formData = new FormData();
  formData.append('avatar', fileInput.files[0]);   // "avatar" = backend ki upload.single('avatar') wali key

  try {
    const res = await fetch('/users/avatar', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },   // yahan Content-Type MAT likhna
      body: formData
    });
    const data = await res.json();

    if (!res.ok) {
      showMessage(data.error || 'Upload fail ho gaya', true);
      return;
    }

    showMessage('Picture upload ho gayi!', false);
    fileInput.value = '';
    loadProfile();   // profile dobara load karo taake nayi picture dikhe
  } catch (err) {
    showMessage('Server se connect nahi ho paya', true);
  }
});

// ---------- LOGOUT ----------
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('token');
  window.location.href = '/index.html';
});

loadProfile();