// Deploy this web app from 435parkrio@gmail.com, running as its owner.
// Set MAIL_GATEWAY_TOKEN in Script Properties. Never put it in this file.
const PROPOSAL_RECIPIENT = 'js-parkrio@naver.com';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const expected = PropertiesService.getScriptProperties().getProperty('MAIL_GATEWAY_TOKEN');
    if (!expected || data.token !== expected) throw new Error('인증 실패');
    if (!data.userId || !data.subject || !data.body || !Array.isArray(data.files)) {
      throw new Error('제안서 형식 오류');
    }
    if (data.files.length > 6) throw new Error('첨부파일 개수 초과');

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throw new Error('잠시 후 다시 시도해 주세요.');
    try {
      const cache = CacheService.getScriptCache();
      const key = 'proposal-' + String(data.userId).replace(/[^a-zA-Z0-9-]/g, '');
      if (cache.get(key)) throw new Error('잠시 후 다시 제출할 수 있습니다.');
      const files = data.files.map(file => {
        const bytes = Utilities.base64Decode(file.base64);
        if (bytes.length > 5 * 1024 * 1024) throw new Error('파일 크기 초과');
        return Utilities.newBlob(bytes, file.mimeType || 'application/octet-stream',
          String(file.name || 'attachment').slice(0, 120));
      });
      MailApp.sendEmail(PROPOSAL_RECIPIENT, data.subject, data.body, {
        name: '파크리오마당',
        attachments: files
      });
      cache.put(key, 'sent', 300);
    } finally {
      lock.releaseLock();
    }
    return jsonResult({ ok: true });
  } catch (error) {
    return jsonResult({ ok: false, error: String(error.message || error) });
  }
}

function jsonResult(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
