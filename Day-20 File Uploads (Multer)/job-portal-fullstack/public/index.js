const API = '/api';
const app = document.getElementById('app');
const nav = document.getElementById('nav');
const state = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  view: 'jobs',
  arg: null,
};

/* ---------- helpers ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n ? 'PKR ' + Number(n).toLocaleString() : 'Salary not listed');
const date = (d) => (d ? new Date(d).toLocaleDateString() : '');

function toast(msg, isErr) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3000);
}

async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = {};
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(API + path, { method, headers, body: payload });
  if (raw) {
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Request failed');
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.token) logout(true);
    throw new Error(data.message || data.err || 'Request failed');
  }
  return data;
}

function saveSession(data) {
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', JSON.stringify(data.user));
}

function logout(silent) {
  state.token = state.user = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  if (!silent) toast('Logged out');
  go('jobs');
}

function go(view, arg = null) {
  state.view = view;
  state.arg = arg;
  render();
}

/* ---------- nav ---------- */
function renderNav() {
  const u = state.user;
  const links = [['jobs', 'Jobs']];
  if (u?.role === 'jobseeker') links.push(['myApps', 'My Applications']);
  if (u?.role === 'employer') links.push(['myJobs', 'My Jobs'], ['postJob', 'Post a Job']);
  if (u?.role === 'admin') links.push(['admin', 'Admin']);
  nav.innerHTML =
    links.map(([v, l]) => `<button class="link" data-go="${v}">${l}</button>`).join('') +
    (u
      ? `<span class="muted">${esc(u.name)} (${esc(u.role)})</span><button data-act="logout">Logout</button>`
      : `<button data-go="login">Login</button><button class="primary" data-go="signup">Sign up</button>`);
}

/* ---------- views ---------- */
const jobCard = (j) => `
  <div class="card between">
    <div>
      <h3>${esc(j.title)} <span class="badge ${j.status}">${j.status}</span></h3>
      <div class="muted">${esc(j.company)} · ${esc(j.location)} · ${esc(j.jobType)} · ${money(j.salary)}</div>
    </div>
    <button data-go="job" data-arg="${j._id}">View</button>
  </div>`;

const views = {
  async jobs() {
    app.innerHTML = `
      <h1>Find your next job</h1>
      <form id="searchForm" class="card">
        <div class="row">
          <input name="search" placeholder="Title, company, keyword">
          <input name="location" placeholder="Location">
          <select name="jobType"><option value="">Any type</option><option>Full-time</option><option>Part-time</option><option>Internship</option></select>
          <select name="sort"><option value="createdAt">Newest</option><option value="salary">Salary</option><option value="title">Title</option></select>
          <button class="primary">Search</button>
        </div>
      </form>
      <div id="jobList"></div>`;
    const load = async (page = 1) => {
      const q = new URLSearchParams(new FormData(document.getElementById('searchForm')));
      q.set('page', page);
      [...q.keys()].forEach((k) => !q.get(k) && q.delete(k));
      const r = await api('/jobs?' + q);
      const p = r.pagination;
      document.getElementById('jobList').innerHTML =
        (r.data.length ? r.data.map(jobCard).join('') : '<p class="muted">No jobs found.</p>') +
        (p.pages > 1
          ? `<div class="row"><button ${p.page <= 1 ? 'disabled' : ''} data-page="${p.page - 1}">Previous</button><span class="muted">Page ${p.page} of ${p.pages}</span><button ${p.page >= p.pages ? 'disabled' : ''} data-page="${p.page + 1}">Next</button></div>`
          : '');
      document.querySelectorAll('[data-page]').forEach((b) => (b.onclick = () => load(+b.dataset.page)));
    };
    document.getElementById('searchForm').onsubmit = (e) => { e.preventDefault(); load().catch((er) => toast(er.message, true)); };
    await load();
  },

  async job(id) {
    const { data: j } = await api('/jobs/' + id);
    const u = state.user;
    let action = '<p class="muted"><a href="#" data-go="login">Login</a> as a jobseeker to apply.</p>';
    if (u?.role === 'jobseeker') {
      action = j.status === 'Open'
        ? `<form id="applyForm" class="card"><h3>Apply for this job</h3>
             <label>Resume (PDF, DOC or DOCX)</label><input type="file" name="resume" accept=".pdf,.doc,.docx" required>
             <label>Cover letter (optional, max 500 characters)</label><textarea name="coverLetter" rows="4" maxlength="500"></textarea>
             <p><button class="primary">Submit application</button></p></form>`
        : '<p class="error">This job is closed.</p>';
    } else if (u) action = '';
    app.innerHTML = `
      <button class="link" data-go="jobs">&larr; All jobs</button>
      <div class="card">
        <h1>${esc(j.title)} <span class="badge ${j.status}">${j.status}</span></h1>
        <div class="muted">${esc(j.company)} · ${esc(j.location)} · ${esc(j.jobType)} · ${money(j.salary)}${j.deadline ? ' · Deadline ' + date(j.deadline) : ''}</div>
        <p class="pre">${esc(j.description)}</p>
      </div>${action}`;
    const f = document.getElementById('applyForm');
    if (f) f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      fd.append('jobId', id);
      try { await api('/applications', { method: 'POST', body: fd }); toast('Application submitted'); go('myApps'); }
      catch (er) { toast(er.message, true); }
    };
  },

  login() { authForm('Login', false); },
  signup() { authForm('Create account', true); },

  async myApps() {
    const { data } = await api('/applications/my');
    app.innerHTML = '<h2>My applications</h2>' + (data.length ? data.map((a) => `
      <div class="card between">
        <div><h3>${esc(a.job?.title || 'Job removed')} <span class="badge ${a.status}">${a.status}</span></h3>
        <div class="muted">${esc(a.job?.company || '')} · Applied ${date(a.appliedAt)}</div></div>
        <div class="actions"><button data-act="resume" data-id="${a._id}">Resume</button><button class="danger" data-act="withdraw" data-id="${a._id}">Withdraw</button></div>
      </div>`).join('') : '<p class="muted">You have not applied to any job yet.</p>');
  },

  postJob() {
    app.innerHTML = `<h2>Post a job</h2><form id="jobForm" class="card">
      <label>Title</label><input name="title" required>
      <label>Company</label><input name="company" required>
      <label>Location</label><input name="location" required>
      <div class="row"><div><label>Job type</label><select name="jobType"><option>Full-time</option><option>Part-time</option><option>Internship</option></select></div>
      <div><label>Salary (PKR / month)</label><input name="salary" type="number" min="0"></div>
      <div><label>Deadline</label><input name="deadline" type="date"></div></div>
      <label>Description</label><textarea name="description" rows="6" required></textarea>
      <p><button class="primary">Publish job</button></p></form>`;
    document.getElementById('jobForm').onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries([...new FormData(e.target)].filter(([, v]) => v !== ''));
      try { await api('/jobs', { method: 'POST', body }); toast('Job posted'); go('myJobs'); }
      catch (er) { toast(er.message, true); }
    };
  },

  async myJobs() {
    const { data } = await api('/jobs/my');
    app.innerHTML = '<h2>My jobs</h2>' + (data.length ? data.map((j) => `
      <div class="card between">
        <div><h3>${esc(j.title)} <span class="badge ${j.status}">${j.status}</span></h3><div class="muted">${esc(j.company)} · ${esc(j.location)}</div></div>
        <div class="actions"><button data-go="applicants" data-arg="${j._id}">Applicants</button>
          ${j.status === 'Open' ? `<button data-act="close" data-id="${j._id}">Close</button>` : ''}
          <button class="danger" data-act="deleteJob" data-id="${j._id}">Delete</button></div>
      </div>`).join('') : '<p class="muted">You have not posted any job yet.</p>');
  },

  async applicants(jobId) {
    const { data } = await api('/applications/job/' + jobId);
    const opts = (s) => ['Applied', 'Shortlisted', 'Rejected', 'Hired'].map((o) => `<option ${o === s ? 'selected' : ''}>${o}</option>`).join('');
    app.innerHTML = `<button class="link" data-go="myJobs">&larr; My jobs</button><h2>Applicants</h2>` + (data.length ? data.map((a) => `
      <div class="card"><div class="between"><div><h3>${esc(a.applicant?.name)}</h3><div class="muted">${esc(a.applicant?.email)} · ${date(a.appliedAt)}</div></div>
        <div class="actions"><select id="st-${a._id}">${opts(a.status)}</select><button data-act="status" data-id="${a._id}">Update</button><button data-act="resume" data-id="${a._id}">Resume</button></div></div>
        ${a.coverLetter ? `<p class="pre muted">${esc(a.coverLetter)}</p>` : ''}</div>`).join('') : '<p class="muted">No applications yet.</p>');
  },

  async admin() {
    const [{ data: s }, { data: users }] = await Promise.all([api('/admin/stats'), api('/admin/users?limit=50')]);
    const stat = (l, v) => `<div class="stat"><b>${v}</b>${l}</div>`;
    app.innerHTML = `<h2>Admin dashboard</h2><div class="stats">${stat('Users', s.users)}${stat('Jobseekers', s.jobseekers)}${stat('Employers', s.employers)}${stat('Jobs', s.jobs)}${stat('Open jobs', s.openJobs)}${stat('Applications', s.applications)}</div>
      <table><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr>${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td>
      <td>${u._id === state.user.id ? '' : `<button class="danger" data-act="deleteUser" data-id="${u._id}">Delete</button>`}</td></tr>`).join('')}</table>`;
  },
};

function authForm(title, isSignup) {
  app.innerHTML = `<form id="authForm" class="card narrow"><h2>${title}</h2>
    ${isSignup ? '<label>Name</label><input name="name" required><label>I am a</label><select name="role"><option value="jobseeker">Jobseeker</option><option value="employer">Employer</option></select>' : ''}
    <label>Email</label><input name="email" type="email" required>
    <label>Password</label><input name="password" type="password" minlength="6" required>
    <p><button class="primary">${title}</button></p></form>`;
  document.getElementById('authForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const data = await api(isSignup ? '/auth/signup' : '/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      saveSession(data);
      toast('Welcome, ' + data.user.name);
      go(data.user.role === 'employer' ? 'myJobs' : data.user.role === 'admin' ? 'admin' : 'jobs');
    } catch (er) { toast(er.message, true); }
  };
}

/* ---------- actions (event delegation) ---------- */
const actions = {
  logout: () => logout(),
  async resume(id) {
    const res = await api(`/applications/${id}/resume`, { raw: true });
    const name = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') || '')?.[1] || 'resume';
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: name });
    a.click();
    URL.revokeObjectURL(a.href);
  },
  async withdraw(id) { if (confirm('Withdraw this application?')) { await api('/applications/' + id, { method: 'DELETE' }); toast('Application withdrawn'); render(); } },
  async status(id) { await api(`/applications/${id}/status`, { method: 'PUT', body: { status: document.getElementById('st-' + id).value } }); toast('Status updated'); },
  async close(id) { await api(`/jobs/${id}/close`, { method: 'PUT' }); toast('Job closed'); render(); },
  async deleteJob(id) { if (confirm('Delete this job and its applications?')) { await api('/jobs/' + id, { method: 'DELETE' }); toast('Job deleted'); render(); } },
  async deleteUser(id) { if (confirm('Delete this user and all their data?')) { await api('/admin/users/' + id, { method: 'DELETE' }); toast('User deleted'); render(); } },
};

document.addEventListener('click', async (e) => {
  const goEl = e.target.closest('[data-go]');
  if (goEl) { e.preventDefault(); return go(goEl.dataset.go, goEl.dataset.arg || null); }
  const actEl = e.target.closest('[data-act]');
  if (actEl) {
    try { await actions[actEl.dataset.act](actEl.dataset.id); } catch (er) { toast(er.message, true); }
  }
});

async function render() {
  renderNav();
  app.innerHTML = '<p class="muted">Loading…</p>';
  try { await views[state.view](state.arg); }
  catch (er) { app.innerHTML = `<p class="error">${esc(er.message)}</p>`; }
}

render();
