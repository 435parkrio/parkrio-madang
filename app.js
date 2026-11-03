const form = document.querySelector('#proposalForm');
const status = document.querySelector('#formStatus');
const draftKey = 'parkriomadang-proposal-draft-v1';
const directMailEnabled = window.PARKRIO_SUPABASE?.directMailEnabled === true;

if (directMailEnabled) {
  document.querySelector('.proposal-disclaimer').textContent = '로그인한 회원은 제안서 파일과 선택한 첨부파일을 관리사무소 수신 주소로 보낼 수 있습니다. 발송 결과를 확인한 뒤 접수 여부는 관리사무소에 확인해 주세요.';
  document.querySelector('.proposal-steps').innerHTML = '<div><span>01</span> 제안 내용 작성</div><div><span>02</span> 제안서와 파일 발송</div><div><span>03</span> 수신 여부 확인</div>';
  document.querySelector('.form-badge').textContent = '파일로 발송';
  document.querySelector('.form-footnote').textContent = '제출일이 자동 기록된 제안서가 HTML 파일로 첨부됩니다. 선택한 파일도 함께 발송됩니다. 한 번에 최대 5개, 파일당 5MB, 총 8MB까지 첨부할 수 있습니다.';
  form.querySelector('button[type="submit"]').innerHTML = '제안서와 첨부파일 보내기 <span aria-hidden="true">→</span>';
}

const draftFields = ['title','submitter','resolution','reason','details','cost','regulation','other'];
try {
  const saved = JSON.parse(localStorage.getItem(draftKey) || 'null');
  if (saved && typeof saved === 'object') {
    draftFields.forEach(name => { if (typeof saved[name] === 'string') form.elements[name].value = saved[name]; });
    status.textContent = '이 기기에 임시저장된 내용을 불러왔습니다.';
  }
} catch { /* A corrupt local draft is ignored. */ }

document.querySelector('#saveDraft').addEventListener('click', () => {
  const draft = Object.fromEntries(draftFields.map(name => [name, form.elements[name].value]));
  try {
    localStorage.setItem(draftKey, JSON.stringify(draft));
    status.textContent = '입력한 글을 이 기기에 임시저장했습니다. 첨부파일은 저장되지 않습니다.';
  } catch { status.textContent = '이 브라우저에서는 임시저장을 사용할 수 없습니다.'; }
});

document.querySelector('#attachment').addEventListener('change', event => {
  const files = [...event.target.files];
  document.querySelector('#fileDisplay').textContent = files.length ? files.map(file => file.name).join(', ') : '파일 선택 ＋';
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const value = name => form.elements[name].value.trim();
  const writtenAt = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const attachments = [...document.querySelector('#attachment').files];
  if (directMailEnabled) {
    const client = window.PARKRIO_CLIENT;
    if (!client) { status.textContent = '회원 기능에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'; return; }
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) { status.textContent = '메일로 보내려면 먼저 로그인해 주세요.'; return; }
    const payload = new FormData(form);
    attachments.forEach(file => payload.append('attachment', file));
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    status.textContent = '제안서와 첨부파일을 보내는 중입니다…';
    try {
      const { data, error } = await client.functions.invoke('send-proposal', { body: payload });
      if (error || !data?.ok) throw new Error(data?.error || error?.message || '발송 실패');
      status.textContent = '제안서와 첨부파일을 발송했습니다. 관리사무소에 수신 여부를 확인해 주세요.';
      try { localStorage.removeItem(draftKey); } catch { /* Local storage may be unavailable. */ }
      form.reset();
      document.querySelector('#fileDisplay').textContent = '파일 선택 ＋';
    } catch (error) {
      status.textContent = `발송하지 못했습니다. ${error.message || '잠시 후 다시 시도해 주세요.'}`;
    } finally { submitButton.disabled = false; }
    return;
  }
  const body = [
    '파크리오마당 안건제안서',
    '별지 제7호서식 기반',
    '',
    `제목: ${value('title')}`,
    `제출자: ${value('submitter')}`,
    `작성일: ${writtenAt}`,
    '',
    `1. 의결주문\n${value('resolution')}`,
    `2. 제안이유\n${value('reason')}`,
    `3. 주요내용\n${value('details')}`,
    `4. 비용추계서\n${value('cost') || '해당 없음 / 미기재'}`,
    `5. 참고사항\n가. 근거규정\n${value('regulation') || '미기재'}\n\n나. 기타\n${value('other') || '미기재'}`,
    '',
    attachments.length ? `첨부 예정 파일: ${attachments.map(file => file.name).join(', ')}\n(메일 앱에서 직접 첨부해 주세요.)` : '첨부 예정 파일: 없음',
    '',
    '이 메일은 관리사무소 수신 주소로 보내는 제안입니다. 관리규약 제37조에 따른 공식 서면 제출과 입주자대표회의 상정을 대신하지 않습니다.'
  ].join('\n');
  const subject = `[파크리오마당 안건제안] ${value('title')}`;
  const url = `mailto:js-parkrio@naver.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  if (url.length > 12000) {
    status.textContent = '내용이 길어 메일 앱에 모두 전달되지 않을 수 있습니다. 글을 줄인 뒤 다시 시도하거나 임시저장해 주세요.';
    return;
  }
  status.textContent = attachments.length
    ? '메일 앱의 받는 사람이 비어 있으면 위 주소를 붙여넣고, 파일을 직접 첨부한 뒤 보내기를 눌러 주세요. 아직 발송된 것은 아닙니다.'
    : '메일 앱의 받는 사람이 비어 있으면 위 주소를 붙여넣고, 내용을 확인한 뒤 보내기를 눌러 주세요. 아직 발송된 것은 아닙니다.';
  window.location.href = url;
});

// The library is a local preview until a shared server is connected.
const resourceForm = document.querySelector('#resourceForm');
const resourceList = document.querySelector('#resourceList');
const resourceStatus = document.querySelector('#resourceStatus');
const resourceTabs = [...document.querySelectorAll('[data-library-category]')];
const resourceFile = resourceForm.elements.resourceFile;
const resourceLink = resourceForm.elements.resourceLink;
let activeResourceCategory = 'law';

const libraryDb = new Promise((resolve, reject) => {
  if (!('indexedDB' in window)) { reject(new Error('이 브라우저는 로컬 자료 저장을 지원하지 않습니다.')); return; }
  const request = indexedDB.open('parkriomadang-library', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('resources', { keyPath: 'id', autoIncrement: true });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function libraryRequest(method, value) {
  const db = await libraryDb;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('resources', method === 'getAll' ? 'readonly' : 'readwrite');
    const request = transaction.objectStore('resources')[method](...(value === undefined ? [] : [value]));
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    transaction.oncomplete = () => resolve(request.result);
  });
}

function validWebUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch { return null; }
}

function updateResourceKind() {
  const isFile = resourceForm.elements.resourceKind.value === 'file';
  document.querySelector('#resourceFileField').hidden = !isFile;
  document.querySelector('#resourceLinkField').hidden = isFile;
  resourceFile.required = isFile;
  resourceLink.required = !isFile;
}

function selectResourceCategory(category) {
  activeResourceCategory = category;
  resourceTabs.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.libraryCategory === category)));
  document.querySelector('#resourceCategoryTitle').textContent = { law: '법', rules: '규약과 규정', other: '기타' }[category] || '법';
  resourceForm.elements.resourceCategory.value = category;
  renderLibrary();
}

async function renderLibrary() {
  try {
    const category = activeResourceCategory;
    const resources = (await libraryRequest('getAll'))
      .filter(item => item.category === category)
      .sort((a, b) => b.id - a.id);
    if (category !== activeResourceCategory) return;
    resourceList.replaceChildren();
    document.querySelector('#resourceCount').textContent = `${resources.length}개 자료`;
    document.querySelector('#resourceEmpty').hidden = resources.length > 0;
    resources.forEach(item => {
      const row = document.createElement('li');
      row.className = 'resource-item';
      const icon = document.createElement('span');
      icon.className = 'resource-item-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = item.kind === 'file' ? '↓' : '↗';
      const main = document.createElement('div');
      main.className = 'resource-item-main';
      const link = document.createElement('a');
      link.textContent = item.title;
      if (item.kind === 'file') {
        link.href = '#resources';
        link.addEventListener('click', event => {
          event.preventDefault();
          const objectUrl = URL.createObjectURL(item.file);
          const download = document.createElement('a');
          download.href = objectUrl;
          download.download = item.fileName;
          download.click();
          window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
        });
      } else {
        const url = validWebUrl(item.url);
        if (url) { link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        else { link.href = '#resources'; link.addEventListener('click', event => event.preventDefault()); }
      }
      main.append(link);
      if (item.description) {
        const description = document.createElement('p');
        description.textContent = item.description;
        main.append(description);
      }
      const meta = document.createElement('small');
      meta.textContent = `${item.kind === 'file' ? '파일' : '링크'} · ${new Intl.DateTimeFormat('ko-KR').format(new Date(item.createdAt))}`;
      main.append(meta);
      const remove = document.createElement('button');
      remove.className = 'resource-remove';
      remove.type = 'button';
      remove.textContent = '삭제';
      remove.setAttribute('aria-label', `${item.title} 삭제`);
      remove.addEventListener('click', async () => {
        if (!window.confirm('이 기기에 저장된 자료를 삭제할까요?')) return;
        try { await libraryRequest('delete', item.id); await renderLibrary(); resourceStatus.textContent = '이 기기에 저장된 자료를 삭제했습니다.'; }
        catch { resourceStatus.textContent = '자료를 삭제하지 못했습니다.'; }
      });
      row.append(icon, main, remove);
      resourceList.append(row);
    });
  } catch {
    resourceStatus.textContent = '이 브라우저에서는 자료를 저장하거나 불러올 수 없습니다.';
    resourceForm.querySelector('button[type="submit"]').disabled = true;
  }
}

resourceTabs.forEach(button => button.addEventListener('click', () => selectResourceCategory(button.dataset.libraryCategory)));
resourceForm.querySelectorAll('[name="resourceKind"]').forEach(radio => radio.addEventListener('change', updateResourceKind));
resourceForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!resourceForm.reportValidity()) return;
  const kind = resourceForm.elements.resourceKind.value;
  const item = {
    category: resourceForm.elements.resourceCategory.value,
    title: resourceForm.elements.resourceTitle.value.trim(),
    description: resourceForm.elements.resourceDescription.value.trim(),
    kind,
    createdAt: new Date().toISOString()
  };
  if (!item.title) { resourceStatus.textContent = '자료 제목을 입력해 주세요.'; return; }
  if (kind === 'file') {
    const file = resourceFile.files[0];
    if (!file) { resourceStatus.textContent = '파일을 선택해 주세요.'; return; }
    if (file.size > 20 * 1024 * 1024) { resourceStatus.textContent = '20MB 이하 파일을 선택해 주세요.'; return; }
    item.file = file;
    item.fileName = file.name;
  } else {
    const url = validWebUrl(resourceLink.value.trim());
    if (!url) { resourceStatus.textContent = 'http 또는 https 링크를 입력해 주세요.'; return; }
    item.url = url;
  }
  try {
    await libraryRequest('add', item);
    resourceForm.reset();
    updateResourceKind();
    selectResourceCategory(item.category);
    resourceStatus.textContent = '이 브라우저에 자료를 저장했습니다. 다른 주민에게는 표시되지 않습니다.';
  } catch { resourceStatus.textContent = '자료를 저장하지 못했습니다. 저장 공간을 확인해 주세요.'; }
});
updateResourceKind();
renderLibrary();

