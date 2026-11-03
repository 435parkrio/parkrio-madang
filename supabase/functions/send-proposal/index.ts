import { withSupabase } from 'npm:@supabase/server@1.6.0'

const fieldNames = ['title', 'submitter', 'resolution', 'reason', 'details', 'cost', 'regulation', 'other'] as const
const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_TOTAL_SIZE = 8 * 1024 * 1024

function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status })
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

function asBase64(bytes: Uint8Array) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'POST') return fail('허용되지 않은 요청입니다.', 405)
    const webAppUrl = Deno.env.get('GOOGLE_MAIL_WEBAPP_URL')
    const token = Deno.env.get('GOOGLE_MAIL_TOKEN')
    if (!webAppUrl || !token) return fail('메일 발송 기능을 준비 중입니다.', 503)
    const form = await request.formData()
    const fields = Object.fromEntries(fieldNames.map(name => [name, String(form.get(name) || '').trim()])) as Record<typeof fieldNames[number], string>
    if (!fields.title || !fields.submitter || !fields.resolution || !fields.reason || !fields.details) {
      return fail('필수 항목을 입력해 주세요.')
    }
    if (fields.title.length > 120 || fields.submitter.length > 80 || Object.values(fields).join('').length > 30000) {
      return fail('입력한 내용이 너무 깁니다.')
    }
    const uploaded = form.getAll('attachment').filter((item): item is File => item instanceof File && item.size > 0)
    if (uploaded.length > 5 || uploaded.some(file => file.size > MAX_FILE_SIZE) || uploaded.reduce((size, file) => size + file.size, 0) > MAX_TOTAL_SIZE) {
      return fail('첨부파일은 최대 5개, 파일당 5MB, 합계 8MB까지 가능합니다.')
    }

    const writtenAt = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const sections = [
      ['제목', fields.title], ['제출자', fields.submitter], ['제출일', writtenAt],
      ['1. 의결주문', fields.resolution], ['2. 제안이유', fields.reason],
      ['3. 주요내용', fields.details], ['4. 비용추계서', fields.cost || '미기재'],
      ['5. 참고사항 — 가. 근거규정', fields.regulation || '미기재'],
      ['5. 참고사항 — 나. 기타', fields.other || '미기재']
    ]
    const body = ['파크리오마당 안건제안서 (별지 제7호서식 기반)', '', ...sections.flatMap(([label, value]) => [`${label}\n${value}`, '']),
      '의안번호·의결일·의결사항은 접수·심의 후 관리합니다.',
      '이 메일은 관리사무소 수신 주소로 보내는 제안입니다. 관리규약 제37조에 따른 공식 서면 제출과 입주자대표회의 상정을 대신하지 않습니다.'].join('\n')
    const html = '<!doctype html><html lang="ko"><meta charset="utf-8"><title>안건제안서</title>' +
      '<style>body{font-family:sans-serif;max-width:760px;margin:40px auto;line-height:1.65;color:#24362b}h1{border-bottom:2px solid #2e6048;padding-bottom:12px}section{border-bottom:1px solid #ddd;padding:10px 0;white-space:pre-wrap}b{display:block;color:#2e6048}</style>' +
      '<h1>안건제안서</h1><p>별지 제7호서식 기반 · 파크리오마당</p>' +
      sections.map(([label, value]) => `<section><b>${escapeHtml(label)}</b>${escapeHtml(value)}</section>`).join('') +
      '<p>의안번호·의결일·의결사항은 접수·심의 후 관리합니다.</p></html>'
    const encoder = new TextEncoder()
    const files = [{ name: '파크리오마당-안건제안서.html', mimeType: 'text/html', base64: asBase64(encoder.encode(html)) }]
    for (const file of uploaded) {
      files.push({ name: file.name, mimeType: file.type || 'application/octet-stream', base64: asBase64(new Uint8Array(await file.arrayBuffer())) })
    }
    const gatewayResponse = await fetch(webAppUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, userId: context.userClaims.sub, subject: `[파크리오마당 안건제안] ${fields.title}`, body, files })
    })
    const gatewayResult = await gatewayResponse.json().catch(() => null)
    if (!gatewayResponse.ok || !gatewayResult?.ok) return fail(gatewayResult?.error || '메일을 보내지 못했습니다.', 502)
    return Response.json({ ok: true })
  })
}
