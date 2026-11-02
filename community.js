// Member features use the existing Supabase project. Authorization is enforced by its RLS policies.
(() => {
  const authDialog = document.querySelector('#authDialog');
  const postDialog = document.querySelector('#postDialog');
  const detailDialog = document.querySelector('#detailDialog');
  const profileDialog = document.querySelector('#profileDialog');
  const authForm = document.querySelector('#authForm');
  const postForm = document.querySelector('#postForm');
  const profileForm = document.querySelector('#profileForm');
  const commentForm = document.querySelector('#commentForm');
  const config = window.PARKRIO_SUPABASE;
  document.querySelector('#operatorInfo').textContent = `운영 주체: ${config?.operatorName || '미정'} · 문의처: ${config?.contactEmail || '미정'}`;
  const client = window.supabase?.createClient && config?.url && config?.publishableKey
    ? window.supabase.createClient(config.url, config.publishableKey)
    : null;
  let user = null;
  let profile = null;
  let restricted = false;
  let notices = [];
  let boardPosts = [];
  let selectedPost = null;
  let authMode = 'login';

  const $ = selector => document.querySelector(selector);
  const isAdmin = () => user?.app_metadata?.site_role === 'admin';
  const dateLabel = value => new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' }).format(new Date(value));
  const setStatus = (selector, message) => { $(selector).textContent = message; };
  const errorText = error => error?.message || '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  const close = dialog => { if (dialog.open) dialog.close(); };

  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => close(document.getElementById(button.dataset.close))));
  [authDialog, postDialog, detailDialog, profileDialog].forEach(dialog => dialog.addEventListener('click', event => {
    if (event.target === dialog) close(dialog);
  }));

  function openAuth(mode = 'login') {
    if (!client) {
      window.alert('회원 기능 연결을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.');
      return;
    }
    authMode = mode;
    authForm.reset();
    const titles = { login: '로그인', signup: '회원가입', reset: '비밀번호 재설정', recovery: '새 비밀번호 설정' };
    $('#authTitle').textContent = titles[mode];
    $('#authIntro').textContent = {
      login: '이메일과 비밀번호로 로그인하세요.',
      signup: '가입 후 도착하는 이메일에서 인증을 완료해 주세요.',
      reset: '비밀번호 재설정 메일을 보내드립니다.',
      recovery: '새 비밀번호를 입력해 주세요.'
    }[mode];
    $('#signupFields').hidden = mode !== 'signup';
    authForm.elements.fullName.required = mode === 'signup';
    authForm.elements.nickname.required = mode === 'signup';
    $('#passwordField').hidden = mode === 'reset';
    authForm.elements.password.required = mode !== 'reset';
    authForm.elements.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    authForm.elements.email.closest('label').hidden = mode === 'recovery';
    authForm.elements.email.required = mode !== 'recovery';
    $('#authSubmit').textContent = mode === 'signup' ? '인증 메일 받기' : mode === 'reset' ? '재설정 메일 받기' : mode === 'recovery' ? '새 비밀번호 저장' : '로그인';
    setStatus('#authStatus', '');
    authDialog.showModal();
  }

  document.querySelectorAll('[data-auth]').forEach(button => button.addEventListener('click', () => openAuth(button.dataset.auth)));
  authForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!authForm.reportValidity()) return;
    $('#authSubmit').disabled = true;
    setStatus('#authStatus', '처리 중입니다…');
    try {
      const email = authForm.elements.email.value.trim();
      const password = authForm.elements.password.value;
      if (authMode === 'signup') {
        const { error } = await client.auth.signUp({
          email, password,
          options: {
            data: {
              full_name: authForm.elements.fullName.value.trim(),
              building: authForm.elements.building.value.trim(),
              unit: authForm.elements.unit.value.trim(),
              nickname: authForm.elements.nickname.value.trim()
            }
          }
        });
        if (error) throw error;
        setStatus('#authStatus', '가입 요청을 받았습니다. 이메일의 인증 링크를 확인한 뒤 로그인해 주세요.');
      } else if (authMode === 'login') {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        close(authDialog);
      } else if (authMode === 'reset') {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
        if (error) throw error;
        setStatus('#authStatus', '재설정 메일을 보냈습니다. 이메일을 확인해 주세요.');
      } else {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        setStatus('#authStatus', '새 비밀번호를 저장했습니다.');
      }
    } catch (error) {
      setStatus('#authStatus', errorText(error));
    } finally {
      $('#authSubmit').disabled = false;
    }
  });

  async function ensureProfile() {
    if (!user) { profile = null; return; }
    const { data, error } = await client.from('profiles').select('user_id,nickname,full_name,building,unit').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    if (data) { profile = data; return; }
    const metadata = user.user_metadata || {};
    const fallback = (user.email || '이웃').split('@')[0].slice(0, 30);
    const nickname = String(metadata.nickname || fallback).trim().slice(0, 30);
    const newProfile = {
      user_id: user.id,
      nickname: nickname.length >= 2 ? nickname : '이웃',
      full_name: String(metadata.full_name || '').trim().slice(0, 80) || null,
      building: String(metadata.building || '').trim().slice(0, 20) || null,
      unit: String(metadata.unit || '').trim().slice(0, 20) || null
    };
    const created = await client.from('profiles').insert(newProfile).select().single();
    if (created.error) throw created.error;
    profile = created.data;
  }

  async function updateSession() {
    if (!client) {
      $('#noticeList').textContent = '공지사항 연결을 불러오지 못했습니다.';
      $('#boardList').textContent = '회원 기능 연결을 불러오지 못했습니다.';
      return;
    }
    const { data, error } = await client.auth.getUser();
    user = error ? null : data.user;
    try {
      await ensureProfile();
      if (user) {
        const restrictions = await client.from('restrictions').select('user_id').eq('user_id', user.id).maybeSingle();
        restricted = Boolean(restrictions.data);
      } else restricted = false;
    } catch (profileError) {
      console.error('회원 정보를 불러오지 못했습니다.', profileError);
      profile = null;
    }
    document.querySelectorAll('[data-auth]').forEach(button => { button.hidden = Boolean(user); });
    document.querySelectorAll('.member-only').forEach(button => { button.hidden = !user; });
    $('#adminPanel').hidden = !isAdmin();
    $('#newPostButton').disabled = restricted;
    $('#newPostButton').title = restricted ? '이용 제한 중에는 글을 작성할 수 없습니다.' : '';
    await Promise.all([loadNotices(), loadBoard()]);
    if (isAdmin()) await loadAdminMembers();
  }

  client?.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') openAuth('recovery');
    window.setTimeout(updateSession, 0);
  });
  updateSession();

  async function loadNotices() {
    const { data, error } = await client.from('posts').select('id,author_id,author_label,kind,title,body,audience,created_at').eq('kind', 'notice').order('created_at', { ascending: false }).limit(100);
    const list = $('#noticeList');
    list.replaceChildren();
    if (error) { list.textContent = '공지사항을 불러오지 못했습니다.'; return; }
    notices = data || [];
    if (!notices.length) { list.append(emptyMessage('아직 등록된 공지사항이 없습니다.')); return; }
    notices.forEach(post => list.append(postRow(post)));
  }

  async function loadBoard() {
    const list = $('#boardList');
    list.replaceChildren();
    if (!user) {
      boardPosts = [];
      $('#boardCount').textContent = '';
      list.append(emptyMessage('로그인하면 이웃의 글을 읽고 댓글을 쓸 수 있습니다.'));
      return;
    }
    const { data, error } = await client.from('posts').select('id,author_id,author_label,kind,title,body,created_at').eq('kind', 'board').order('created_at', { ascending: false }).limit(100);
    if (error) { list.textContent = '이야기를 불러오지 못했습니다.'; return; }
    boardPosts = data || [];
    renderBoard();
  }

  function emptyMessage(message) {
    const row = document.createElement('p');
    row.className = 'community-empty';
    row.textContent = message;
    return row;
  }

  function postRow(post) {
    const row = document.createElement('article');
    row.className = 'community-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'community-row-title';
    button.textContent = post.title;
    button.addEventListener('click', () => openDetail(post));
    const meta = document.createElement('p');
    meta.className = 'post-meta';
    meta.textContent = [post.author_label, dateLabel(post.created_at), post.kind === 'notice' ? post.audience === 'members' ? '회원 공지' : '전체 공지' : '이웃 이야기'].join(' · ');
    row.append(button, meta);
    return row;
  }

  function renderBoard() {
    const term = $('#postSearch').value.trim().toLocaleLowerCase();
    const matches = boardPosts.filter(post => (post.title + ' ' + post.body).toLocaleLowerCase().includes(term));
    $('#boardCount').textContent = `${matches.length}개 이야기`;
    const list = $('#boardList');
    list.replaceChildren();
    if (!matches.length) list.append(emptyMessage(term ? '검색 결과가 없습니다.' : '아직 등록된 이야기가 없습니다.'));
    else matches.forEach(post => list.append(postRow(post)));
  }
  $('#postSearch').addEventListener('input', renderBoard);

  function openPost(kind, post = null) {
    if (!user) { openAuth('login'); return; }
    if (restricted) { window.alert('이용 제한 중에는 글을 작성하거나 수정할 수 없습니다.'); return; }
    if (kind === 'notice' && !isAdmin()) return;
    postForm.reset();
    postForm.dataset.kind = kind;
    postForm.elements.id.value = post?.id || '';
    postForm.elements.title.value = post?.title || '';
    postForm.elements.body.value = post?.body || '';
    postForm.elements.audience.value = post?.audience || 'public';
    $('#noticeAudienceField').hidden = kind !== 'notice';
    $('#postDialogTitle').textContent = post ? '글 수정' : kind === 'notice' ? '공지 작성' : '이야기 작성';
    setStatus('#postStatus', '');
    close(detailDialog);
    postDialog.showModal();
  }
  $('#newPostButton').addEventListener('click', () => openPost('board'));
  $('#newNoticeButton').addEventListener('click', () => openPost('notice'));
  postForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!postForm.reportValidity() || !user || !profile || restricted) return;
    const id = postForm.elements.id.value;
    const kind = postForm.dataset.kind;
    const fields = {
      title: postForm.elements.title.value.trim(),
      body: postForm.elements.body.value.trim(),
      audience: kind === 'notice' ? postForm.elements.audience.value : 'members'
    };
    if (!fields.title || !fields.body) { setStatus('#postStatus', '제목과 내용을 입력해 주세요.'); return; }
    const result = id
      ? await client.from('posts').update(fields).eq('id', id)
      : await client.from('posts').insert({ ...fields, kind, author_id: user.id, author_label: profile.nickname });
    if (result.error) { setStatus('#postStatus', errorText(result.error)); return; }
    close(postDialog);
    await Promise.all([loadNotices(), loadBoard()]);
  });

  async function openDetail(post) {
    selectedPost = post;
    $('#detailKind').textContent = post.kind === 'notice' ? '공지사항' : '자유로운 이야기';
    $('#detailTitle').textContent = post.title;
    $('#detailMeta').textContent = `${post.author_label} · ${dateLabel(post.created_at)}`;
    $('#detailBody').textContent = post.body;
    const actions = $('#detailActions');
    actions.replaceChildren();
    if (user && (post.author_id === user.id || isAdmin())) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = '수정';
      edit.addEventListener('click', () => openPost(post.kind, post));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '삭제';
      remove.addEventListener('click', async () => {
        if (!window.confirm('이 글과 댓글을 삭제할까요?')) return;
        const { error } = await client.from('posts').delete().eq('id', post.id);
        if (error) { window.alert(errorText(error)); return; }
        close(detailDialog);
        await Promise.all([loadNotices(), loadBoard()]);
      });
      actions.append(edit, remove);
    }
    $('#commentSection').hidden = !user;
    commentForm.hidden = restricted;
    if (user) await loadComments(post.id);
    detailDialog.showModal();
  }

  async function loadComments(postId) {
    const { data, error } = await client.from('comments').select('id,post_id,author_id,author_label,body,created_at').eq('post_id', postId).order('created_at', { ascending: true });
    const list = $('#commentList');
    list.replaceChildren();
    if (error) { list.append(emptyMessage('댓글을 불러오지 못했습니다.')); return; }
    if (!data?.length) { list.append(emptyMessage('첫 댓글을 남겨 보세요.')); return; }
    data.forEach(comment => {
      const row = document.createElement('div');
      row.className = 'comment-row';
      const meta = document.createElement('p');
      meta.className = 'post-meta';
      meta.textContent = `${comment.author_label} · ${dateLabel(comment.created_at)}`;
      const body = document.createElement('p');
      body.textContent = comment.body;
      row.append(meta, body);
      if (user && (comment.author_id === user.id || isAdmin())) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '삭제';
        remove.addEventListener('click', async () => {
          if (!window.confirm('댓글을 삭제할까요?')) return;
          const result = await client.from('comments').delete().eq('id', comment.id);
          if (result.error) window.alert(errorText(result.error));
          else await loadComments(postId);
        });
        row.append(remove);
      }
      list.append(row);
    });
  }

  commentForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!user || !profile || !selectedPost || restricted) return;
    const body = commentForm.elements.body.value.trim();
    if (!body) return;
    const { error } = await client.from('comments').insert({
      post_id: selectedPost.id, author_id: user.id, author_label: profile.nickname, body
    });
    if (error) { setStatus('#commentStatus', errorText(error)); return; }
    commentForm.reset();
    setStatus('#commentStatus', '');
    await loadComments(selectedPost.id);
  });

  function openProfile() {
    if (!user) { openAuth('login'); return; }
    profileForm.elements.email.value = user.email || '';
    profileForm.elements.fullName.value = profile?.full_name || '';
    profileForm.elements.building.value = profile?.building || '';
    profileForm.elements.unit.value = profile?.unit || '';
    profileForm.elements.nickname.value = profile?.nickname || '';
    setStatus('#profileStatus', '');
    profileDialog.showModal();
  }
  $('#profileButton').addEventListener('click', openProfile);
  document.querySelectorAll('[data-profile]').forEach(button => button.addEventListener('click', openProfile));
  profileForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!user || !profileForm.reportValidity()) return;
    const updates = {
      full_name: profileForm.elements.fullName.value.trim() || null,
      building: profileForm.elements.building.value.trim() || null,
      unit: profileForm.elements.unit.value.trim() || null,
      nickname: profileForm.elements.nickname.value.trim()
    };
    const { error } = await client.from('profiles').update(updates).eq('user_id', user.id);
    if (error) { setStatus('#profileStatus', errorText(error)); return; }
    profile = { ...profile, ...updates };
    setStatus('#profileStatus', '내 정보를 저장했습니다.');
  });

  async function logout() {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) window.alert(errorText(error));
    else { close(profileDialog); await updateSession(); }
  }
  $('#logoutButton').addEventListener('click', logout);
  document.querySelectorAll('[data-logout]').forEach(button => button.addEventListener('click', logout));
  $('#changePasswordButton').addEventListener('click', async () => {
    if (!user?.email) return;
    const { error } = await client.auth.resetPasswordForEmail(user.email, { redirectTo: location.origin + location.pathname });
    setStatus('#profileStatus', error ? errorText(error) : '비밀번호 변경 메일을 보냈습니다.');
  });
  $('#deleteAccountButton').addEventListener('click', async () => {
    if (!user || !window.confirm('회원정보와 작성한 글·댓글을 삭제하고 탈퇴할까요? 이 작업은 되돌릴 수 없습니다.')) return;
    const { error } = await client.rpc('delete_my_account');
    if (error) { setStatus('#profileStatus', errorText(error)); return; }
    await client.auth.signOut();
    close(profileDialog);
    await updateSession();
  });

  async function loadAdminMembers() {
    const [members, restrictions] = await Promise.all([
      client.from('profiles').select('user_id,nickname,full_name,building,unit,created_at').order('created_at', { ascending: false }).limit(100),
      client.from('restrictions').select('user_id,reason')
    ]);
    const area = $('#adminMembers');
    area.replaceChildren();
    if (members.error || restrictions.error) { area.append(emptyMessage('회원 관리 목록을 불러오지 못했습니다.')); return; }
    const limited = new Set((restrictions.data || []).map(item => item.user_id));
    (members.data || []).forEach(member => {
      const row = document.createElement('div');
      row.className = 'admin-member';
      const label = document.createElement('span');
      label.textContent = `${member.nickname} · ${member.full_name || '이름 미입력'} · ${member.building || '-'}동 ${member.unit || '-'}호`;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.textContent = limited.has(member.user_id) ? '이용 제한 해제' : '이용 제한';
      toggle.addEventListener('click', async () => {
        if (!window.confirm(`${member.nickname} 회원의 이용 제한을 ${limited.has(member.user_id) ? '해제' : '설정'}할까요?`)) return;
        const result = limited.has(member.user_id)
          ? await client.from('restrictions').delete().eq('user_id', member.user_id)
          : await client.from('restrictions').insert({ user_id: member.user_id, reason: '운영 규칙 위반' });
        if (result.error) window.alert(errorText(result.error));
        else await loadAdminMembers();
      });
      row.append(label, toggle);
      area.append(row);
    });
  }
})();
