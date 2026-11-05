const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../public/js/hospital.js'),
  'utf8'
);

async function renderWebsite(website) {
  const elements = new Map();
  const detail = {
    innerHTML: '',
    setAttribute() {}
  };
  const message = {};
  const name = { textContent: '' };
  elements.set('hospital-detail', detail);
  elements.set('hospital-detail-message', message);
  elements.set('hospital-name', name);

  const api = {
    async request() {
      return { data: {
        _id: '507f1f77bcf86cd799439011',
        name: 'Synthetic facility',
        city: 'Lahore',
        verificationStatus: 'Pending',
        website
      } };
    },
    escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[character]);
    },
    statusClass() { return 'badge-neutral'; },
    loading() {},
    setNotice() {},
    formatDate() { return ''; },
    showError(_element, error) { throw new Error(error); }
  };

  vm.runInNewContext(source, {
    window: { LifeLink: api, location: { search: '?id=507f1f77bcf86cd799439011' } },
    document: { getElementById: (id) => elements.get(id) },
    URLSearchParams,
    URL
  }, { filename: 'hospital.js' });
  await new Promise((resolve) => setImmediate(resolve));
  return detail.innerHTML;
}

test('hospital details render only HTTP and HTTPS website links', async () => {
  const safeHtml = await renderWebsite('https://facility.example/path');
  assert.match(safeHtml, /href="https:\/\/facility\.example\/path"/);

  const unsafeHtml = await renderWebsite('javascript:alert(1)');
  assert.doesNotMatch(unsafeHtml, /href=/);
});
