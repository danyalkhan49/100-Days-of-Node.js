const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../public/js/requests.js'),
  'utf8'
);

function createPage(session, postError) {
  const elements = new Map();
  const requests = [];
  const notices = [];
  let submitHandler;
  const list = {
    innerHTML: '',
    addEventListener(type, handler) {
      if (type === 'submit') submitHandler = handler;
    },
    setAttribute() {}
  };
  const filterForm = {
    addEventListener() {},
    reportValidity() { return true; },
    reset() {}
  };
  const reportForm = {
    dataset: {},
    addEventListener() {},
    reportValidity() { return true; },
    reset() {}
  };

  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        textContent: '',
        value: '',
        disabled: false,
        dataset: {},
        addEventListener() {},
        close() {},
        showModal() {}
      });
    }
    return elements.get(id);
  }

  elements.set('request-list', list);
  elements.set('request-filters', filterForm);
  elements.set('report-form', reportForm);

  const api = {
    session: () => session,
    escapeHtml: (value) => String(value == null ? '' : value),
    formatDate: () => 'tomorrow',
    loading() {},
    setNotice(_element, text, type) {
      notices.push({ text, type });
    },
    setBusy(form, busy, label) {
      form.busy = busy;
      form.busyLabel = label;
    },
    setFormMessage() {},
    listFrom: (result) => result.data,
    showError(_element, message) {
      throw new Error(message);
    },
    async request(url, options = {}) {
      requests.push({ url, options });
      if (options.method === 'POST' && postError) throw new Error(postError);
      if (options.method === 'POST') return { message: 'Offer submitted.' };
      return {
        data: [{
          _id: 'request-1',
          bloodGroup: 'O+',
          unitsNeeded: 1,
          unitsFulfilled: 0,
          city: 'Lahore',
          neededBy: new Date(Date.now() + 86400000).toISOString()
        }],
        pagination: { total: 1, totalPages: 1 }
      };
    }
  };

  class MockFormData {
    constructor(form) {
      this.form = form;
    }
    get(key) {
      if (this.form === filterForm) return '';
      return this.form.values && this.form.values[key];
    }
  }

  const context = {
    window: { LifeLink: api, confirm: () => true },
    document: { getElementById: element },
    FormData: MockFormData,
    URLSearchParams,
    encodeURIComponent,
    console
  };
  vm.runInNewContext(source, context, { filename: 'requests.js' });

  return {
    list,
    requests,
    notices,
    async submitOffer() {
      const form = {
        dataset: { requestId: 'request-1' },
        values: { message: 'I can help.' },
        reportValidity: () => true
      };
      const event = {
        target: { closest: (selector) => selector === '[data-offer-form]' ? form : null },
        preventDefault() {}
      };
      await submitHandler(event);
      return form;
    }
  };
}

test('donors see and can submit the Make Offer form', async () => {
  const page = createPage({
    token: 'test-token',
    role: 'donor',
    roles: ['donor', 'requester'],
    id: 'donor-1'
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(page.list.innerHTML, /Make offer/);
  const form = await page.submitOffer();
  const submission = page.requests.find((item) => item.options.method === 'POST');

  assert.equal(submission.url, '/offers');
  assert.deepEqual(JSON.parse(JSON.stringify(submission.options.body)), {
    request: 'request-1',
    message: 'I can help.'
  });
  assert.equal(form.busy, true);
  assert.deepEqual(page.notices.at(-1), { text: 'Offer submitted.', type: 'success' });
});

test('non-donor sessions do not see the Make Offer form', async () => {
  const page = createPage({
    token: 'test-token',
    role: 'requester',
    roles: ['requester'],
    id: 'requester-1'
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.doesNotMatch(page.list.innerHTML, /data-offer-form/);
});

test('offer API errors are shown to the user and release the busy state', async () => {
  const page = createPage({
    token: 'test-token',
    role: 'donor',
    roles: ['donor', 'requester'],
    id: 'donor-1'
  }, 'You are not eligible to donate yet.');
  await new Promise((resolve) => setImmediate(resolve));

  const form = await page.submitOffer();

  assert.equal(form.busy, false);
  assert.deepEqual(page.notices.at(-1), {
    text: 'You are not eligible to donate yet.',
    type: 'error'
  });
});
