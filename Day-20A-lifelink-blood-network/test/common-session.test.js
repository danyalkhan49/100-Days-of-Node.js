const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../public/js/common.js'),
  'utf8'
);

function createStorage(values = new Map()) {
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function createLifeLink(localStorage, sessionStorage) {
  const window = {
    addEventListener() {},
    location: { pathname: '/requests.html', search: '' }
  };
  const document = { addEventListener() {} };
  vm.runInNewContext(source, {
    document,
    localStorage,
    sessionStorage,
    window,
    fetch() {
      return Promise.resolve();
    }
  }, { filename: 'common.js' });
  return window.LifeLink;
}

test('donor role persists with the token and is available in another tab', () => {
  const sharedLocalStorage = createStorage();
  const firstTabSessionStorage = createStorage();
  const firstTab = createLifeLink(sharedLocalStorage, firstTabSessionStorage);

  firstTab.saveSession('header.eyJpZCI6ImRvbm9yLTEifQ.signature', 'donor', 'Donor');

  const secondTab = createLifeLink(sharedLocalStorage, createStorage());
  assert.equal(secondTab.session().role, 'donor');
  assert.deepEqual(Array.from(secondTab.session().roles), ['donor', 'requester']);
});

test('clearing a session removes the role from shared and tab storage', () => {
  const sharedLocalStorage = createStorage();
  const tabSessionStorage = createStorage();
  const api = createLifeLink(sharedLocalStorage, tabSessionStorage);

  api.saveSession('header.eyJpZCI6ImRvbm9yLTEifQ.signature', 'donor', 'Donor');
  api.clearSession();

  assert.equal(sharedLocalStorage.getItem('lifelink_token'), null);
  assert.equal(sharedLocalStorage.getItem('lifelink_role'), null);
  assert.equal(tabSessionStorage.getItem('lifelink_role'), null);
});
