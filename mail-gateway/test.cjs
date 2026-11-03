const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sent = [];
const cache = new Map();
const context = {
  JSON,
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-token' }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  CacheService: { getScriptCache: () => ({ get: key => cache.get(key), put: (key, value) => cache.set(key, value) }) },
  Utilities: {
    base64Decode: value => [...Buffer.from(value, 'base64')],
    newBlob: (bytes, mimeType, name) => ({ bytes, mimeType, name })
  },
  MailApp: { sendEmail: (...args) => sent.push(args) },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: text => ({ setMimeType: () => ({ text }) })
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + '/Code.gs', 'utf8'), context);
const payload = {
  token: 'test-token', userId: 'member-1', subject: '시험 제안', body: '시험 본문',
  files: [{ name: '제안서.html', mimeType: 'text/html', base64: Buffer.from('hello').toString('base64') }]
};
const submit = value => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(value) } }).text);
assert.equal(submit({ ...payload, token: 'wrong' }).ok, false);
assert.equal(sent.length, 0);
assert.equal(submit(payload).ok, true);
assert.equal(sent.length, 1);
assert.equal(sent[0][0], 'js-parkrio@naver.com');
assert.equal(sent[0][3].attachments[0].name, '제안서.html');
assert.equal(submit(payload).ok, false);
assert.equal(sent.length, 1);
console.log('메일 주소·첨부파일·중복 발송 제한 확인 완료');
