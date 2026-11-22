// ==================== 티켓 구매로그 설정 패널 + 자동 질문 ====================
// 1) 이름에 ticket / 티켓 이 들어간 채널이 열리면(티켓툴 포함) "구매로그 설정" 패널(컴포넌트 V2)을 띄워요.
// 2) 이어서 봇이 구매자를 멘션하며 질문을 하나씩 해요 (로블록스 아이디, 수량, 상품 이름 등).
//    구매자가 채팅으로 답하면 패널에 자동 저장돼요. 티켓툴 양식에 이미 적은 항목은 묻지 않아요.
// 3) 판매자가 티켓에서 $가격 / $로벅스 를 쓰면 수량·금액이 자동으로 채워져요.
// 4) [정보 수정] : 판매자/구매자는 선택 메뉴로 바로 변경, 상품·수량·금액은 버튼으로 수정
//    [지급완료]  : /지급완료 명령어와 똑같이 구매로그 전송 (빈 칸이 있으면 빈 칸만 묻는 창이 떠요)
//    [추가 구매] : 같은 티켓에서 또 구매할 때 새 패널 생성 (구매자·판매자·로블록스 아이디 유지)
// 패널 정보는 data.json 에 저장되므로 Railway 재배포 후에도 그대로 이어져요.

const {
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType
} = require('discord.js');
const store = require('./store');

// ---------- 설정 ----------
// 티켓툴 봇 ID (기존 Ticket Tool + 이름이 같은 새 Ticket Tool 봇. 프리미엄/커스텀 봇이면 여기에 추가)
const TICKET_TOOL_BOT_IDS = ['557628352828014614', '1506999581722804274'];
const TICKET_NAME_RE = /ticket|티켓/i;               // 이 이름이 들어간 채널이 열리면 패널 생성
const PANEL_WINDOW_MS = 5 * 60 * 1000;               // 채널이 만들어진 지 5분 안에만 패널 생성
const COLLECT_DELAY_MS = 4000;                       // 티켓툴이 환영 메시지·양식 답변을 보낼 때까지 기다리기
// 채널 이름 / 카테고리 이름에 이 단어가 있으면 패널을 만들지 않아요 (문의 티켓 등)
const SKIP_KEYWORDS = ['문의', '신고', '셀러', '지원', 'support', 'report', 'closed'];
// 판매자 이름 → 디스코드 유저 ID (비워두면 "판매자" 역할을 가진 사람의 닉네임/아이디로 자동으로 찾아요)
// 예: { '라프': '123456789012345678' }
const SELLER_MAP = {};
const PANEL_COLOR = 0xA9D8FF;
const DONE_COLOR = 0x7BD88F;
const FLAG_V2 = 1 << 15;
const FLAG_EPHEMERAL = 1 << 6;
const META_KEY = 'ttPanels';

const KIND_LABEL = { robux: '로벅스', ingame: '인게임', etc: '기타' };
const FIELD_NAME = { buyer: '구매자 (디스코드 유저 ID)', kind: '종류', item: '상품 이름', count: '수량', price: '금액', roblox: '로블록스 아이디' };

let deps = null; // { completePurchase, canUse, purchaseCode, sellerRoleId, lookupRoblox }
const handled = new Set();     // 패널을 이미 만든(만드는 중인) 채널
const busy = new Set();        // 지급완료 처리 중인 패널 (중복 클릭 방지)

// ---------- 패널 데이터 저장 (data.json) ----------
function allPanels() {
    const v = store.getMeta(META_KEY);
    return v && typeof v === 'object' ? v : {};
}
const getPanel = (msgId) => allPanels()[msgId] || null;
function savePanel(msgId, d) {
    const all = allPanels();
    all[msgId] = { ...d, ts: d.ts || Date.now() };
    const cut = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30일 지난 패널 정보는 정리
    for (const [k, v] of Object.entries(all)) if (!v || v.ts < cut) delete all[k];
    store.setMeta(META_KEY, all);
}
function activePanelOf(channelId) {
    const list = Object.entries(allPanels()).filter(([, p]) => p.channelId === channelId && !p.done);
    if (!list.length) return null;
    list.sort((a, b) => b[1].ts - a[1].ts);
    return { id: list[0][0], d: list[0][1] };
}
const isTicketToolChannel = (channelId) =>
    handled.has(channelId) || Object.values(allPanels()).some((p) => p.channelId === channelId);

// ---------- 티켓툴 메시지에서 글자 모으기 (임베드 + 컴포넌트 V2 둘 다) ----------
function textsOfComponent(c, out) {
    if (!c || typeof c !== 'object') return;
    if (typeof c.content === 'string') out.push(c.content);
    for (const k of ['components', 'accessory']) {
        const v = c[k];
        if (Array.isArray(v)) v.forEach((x) => textsOfComponent(x, out));
        else if (v) textsOfComponent(v, out);
    }
}
function messageTexts(m) {
    const out = [];
    if (m.content) out.push(m.content);
    for (const e of m.embeds) {
        out.push([e.author && e.author.name, e.title, e.description, e.footer && e.footer.text].filter(Boolean).join('\n'));
    }
    for (const c of m.components || []) textsOfComponent(typeof c.toJSON === 'function' ? c.toJSON() : c, out);
    return out.filter(Boolean);
}

const clean = (v) => String(v || '')
    .replace(/```(?:[a-z]+\n)?/gi, '')
    .replace(/`/g, '')
    .replace(/\*\*|__|~~/g, '')
    .replace(/^\s*(?:#{1,3}\s|>\s?|-#\s|[-•]\s)/gm, '')
    .replace(/[:：]\s*$/, '')
    .trim();

// 티켓툴 양식의 [질문, 답변] 목록
function extractQA(msgs) {
    const qa = [];
    const push = (q, a) => {
        q = clean(q); a = clean(a);
        if (q && a && q.length <= 80) qa.push([q, a]);
    };
    for (const m of msgs) {
        for (const e of m.embeds) for (const f of e.fields || []) push(f.name, f.value);
        for (const t of messageTexts(m)) {
            let r;
            const codeRe = /(?:^|\n)([^\n`]+?)\s*\n\s*```(?:[a-z]+\n)?([\s\S]*?)```/gi;
            while ((r = codeRe.exec(t))) push(r[1], r[2]);
            const boldRe = /\*\*([^*\n]+)\*\*\s*\n\s*([^\n`*][^\n]*)/g;
            while ((r = boldRe.exec(t))) push(r[1], r[2]);
            const colonRe = /^[\s*_#>\-]*([^:\n：`]{1,40}?)[\s*_]*[:：]\s*([^\n]+)$/gm;
            while ((r = colonRe.exec(t))) if (!/^https?$/i.test(r[1].trim())) push(r[1], r[2]);
        }
    }
    return qa;
}

function matchKey(q) {
    const s = q.toLowerCase().replace(/\s/g, '');
    if (/로블|roblox|닉네임|닉|아이디|username|아바타/.test(s)) return 'roblox';
    if (/금액|가격|price|결제|얼마/.test(s)) return 'price';
    if (/수량|개수|갯수|몇|amount|qty|로벅스/.test(s)) return 'count';
    if (/상품|아이템|품목|게임|item|product|무엇|뭐/.test(s)) return 'item';
    if (/종류|유형|type/.test(s)) return 'kind';
    return null;
}

function detectKind(text) {
    const s = String(text || '').toLowerCase();
    if (/로벅스|robux|rbx/.test(s)) return 'robux';
    if (/인게임|ingame|in-game|게임상품|게임아이템/.test(s)) return 'ingame';
    if (/기타|etc/.test(s)) return 'etc';
    return null;
}
const parseKindInput = (v) => detectKind(v) || (String(v || '').trim() ? 'etc' : null);
const norm = (s) => String(s || '').toLowerCase().replace(/[\s\-_.·|]/g, '');
const num = (v) => parseFloat(String(v).replace(/,/g, ''));
const fmt = (n) => Math.round(n).toLocaleString('ko-KR');

// ---------- 판매자 / 구매자 찾기 ----------
async function sellerMembers(guild) {
    try { await guild.members.fetch(); } catch (e) {}
    const roleId = deps.sellerRoleId;
    return guild.members.cache.filter((m) => !m.user.bot && roleId && m.roles.cache.has(roleId));
}

function findSellerByName(text, sellers) {
    const t = norm(text);
    for (const [name, id] of Object.entries(SELLER_MAP)) if (t.includes(norm(name))) return id;
    let best = null, bestLen = 0;
    for (const m of sellers.values()) {
        for (const n of [m.nickname, m.user.globalName, m.user.username, m.displayName]) {
            const k = norm(n);
            if (k.length >= 2 && k.length > bestLen && t.includes(k)) { best = m.id; bestLen = k.length; }
        }
    }
    return best;
}

async function gatherFromChannel(channel) {
    const msgs = [...(await channel.messages.fetch({ limit: 25 })).values()]
        .filter((m) => m.author && TICKET_TOOL_BOT_IDS.includes(m.author.id))
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const d = { channelId: channel.id, buyerId: null, sellerId: null, kind: null, item: '', count: '', price: '', roblox: '' };

    for (const [q, a] of extractQA(msgs)) {
        const key = matchKey(q);
        if (!key) continue;
        if (key === 'kind') { if (!d.kind) d.kind = parseKindInput(a); }
        else if (!d[key]) d[key] = a.slice(0, 200);
    }

    const sellers = await sellerMembers(channel.guild);
    const allText = msgs.flatMap(messageTexts).join('\n');

    // 멘션된 유저: 판매자 역할 → 판매자, 아니면 → 구매자
    const mentioned = [];
    for (const m of msgs) for (const u of m.mentions.users.values()) if (!u.bot) mentioned.push(u.id);
    for (const r of allText.matchAll(/<@!?(\d{15,25})>/g)) mentioned.push(r[1]);
    for (const id of mentioned) {
        if (sellers.has(id)) { if (!d.sellerId) d.sellerId = id; }
        else if (!d.buyerId) d.buyerId = id;
    }
    // 티켓을 연 사람 = 채널 권한에 직접 추가된 유저
    const memberOws = [...channel.permissionOverwrites.cache.values()].filter((o) =>
        o.type === 1 && o.id !== channel.client.user.id && !TICKET_TOOL_BOT_IDS.includes(o.id));
    if (!d.buyerId) {
        const ow = memberOws.find((o) => !sellers.has(o.id));
        if (ow) d.buyerId = ow.id;
    }
    // 판매자 역할이 있는 사람이 직접 연 티켓(테스트 등)이어도 구매자로 잡기
    if (!d.buyerId && mentioned.length) d.buyerId = mentioned[0];
    if (!d.buyerId && memberOws.length) d.buyerId = memberOws[0].id;
    if (!d.buyerId && channel.topic) d.buyerId = (channel.topic.match(/(\d{17,20})/) || [])[1] || null;

    // 판매자: 티켓 이름 → 카테고리 이름 → 티켓툴 메시지 내용 (예: "라프" 티켓 → 라프)
    const parentName = (channel.parent && channel.parent.name) || '';
    const nameSeller = findSellerByName(channel.name, sellers) || findSellerByName(parentName, sellers) || findSellerByName(allText, sellers);
    if (nameSeller) d.sellerId = nameSeller;
    if (d.sellerId === d.buyerId) d.sellerId = null;

    // 종류: 양식 답변 → 티켓 이름 → 카테고리 이름 → 티켓툴 메시지 내용
    if (!d.kind) d.kind = detectKind(channel.name) || detectKind(parentName) || detectKind(allText);
    if (d.kind === 'robux' && !d.item) d.item = '로벅스';

    console.log(`[티켓] ${channel.name} 정보 읽기 → ${JSON.stringify(d)}`);
    return d;
}

// ---------- 자동 질문 ----------
// 티켓 종류별로 구매자에게 물어볼 항목 (순서대로)
function questionKeys(d) {
    if (!d.kind) return ['kind'];
    if (d.kind === 'robux') return ['roblox', 'count'];
    if (d.kind === 'ingame') return ['item', 'count', 'roblox'];
    return ['item', 'count', 'roblox'];
}
const nextQuestion = (d) => questionKeys(d).find((k) => !d[k]) || null;

function questionText(d, key, retry) {
    if (retry) {
        if (key === 'roblox') return '찾을 수 없는 로블록스 아이디예요. 다시 입력해 주세요. (없으면 X)';
        if (key === 'count') return '숫자로 입력해 주세요. (예: 1000)';
        if (key === 'kind') return '로벅스 / 인게임 / 기타 중 하나로 입력해 주세요.';
    }
    if (key === 'kind') return '구매하실 종류를 입력해 주세요. (로벅스 / 인게임 / 기타)';
    if (key === 'roblox') return d.kind === 'etc'
        ? '로블록스 아이디를 입력해 주세요. (없으면 X)'
        : '로블록스 아이디를 입력해 주세요. (디스플레이 이름 말고 아이디)';
    if (key === 'count') return d.kind === 'robux' ? '구매하실 로벅스 수량을 입력해 주세요. (예: 1000)' : '구매하실 수량을 입력해 주세요.';
    if (key === 'item') return d.kind === 'ingame'
        ? '구매하실 게임과 상품 이름을 입력해 주세요. (예: 블록스 피스 - 레오파드)'
        : '구매하실 상품 이름을 입력해 주세요.';
    return '';
}

const v2Text = (content, color = PANEL_COLOR) => ({
    flags: FLAG_V2,
    components: [{ type: 17, accent_color: color, components: [{ type: 10, content }] }]
});

async function sendQuestion(channel, d, key, retry = false) {
    d.asking = key;
    await channel.send({
        ...v2Text(`<@${d.buyerId}> ${questionText(d, key, retry)}`),
        allowedMentions: { users: [d.buyerId] }
    });
}

// 다음 질문 보내기. 다 끝났으면 완료 안내. (d 를 바꾸므로 호출한 쪽에서 저장)
async function askNext(channel, d) {
    const key = nextQuestion(d);
    if (key) return sendQuestion(channel, d, key);
    d.asking = null;
    d.asked = true;
    await channel.send({
        ...v2Text(`<@${d.buyerId}> 입력이 완료되었어요. 판매자가 확인 후 진행해 드릴게요.`, DONE_COLOR),
        allowedMentions: { users: [d.buyerId] }
    });
}

async function startQuestions(channel, panelId, d) {
    d.asked = false;
    if (!nextQuestion(d)) {
        d.asked = true;
        return savePanel(panelId, d);
    }
    await channel.send({
        ...v2Text(`### 구매하기 전 몇 가지만 여쭤볼게요\n<@${d.buyerId}> 질문에 채팅으로 답해 주세요.`),
        allowedMentions: { users: [d.buyerId] }
    });
    await askNext(channel, d);
    savePanel(panelId, d);
}

// 구매자의 답변 처리. 처리했으면 true
async function handleAnswer(message, panelId, d) {
    const key = d.asking;
    const t = message.content.trim().slice(0, 200);
    if (!key || !t) return false;

    if (key === 'kind') {
        const k = detectKind(t);
        if (!k) { await sendQuestion(message.channel, d, key, true); savePanel(panelId, d); return true; }
        d.kind = k;
        if (k === 'robux' && !d.item) d.item = '로벅스';
    } else if (key === 'count') {
        const m = t.match(/\d[\d,.]*/);
        if (!m) { await sendQuestion(message.channel, d, key, true); savePanel(panelId, d); return true; }
        d.count = /^[\d,.]+$/.test(t) || d.kind === 'robux' ? fmt(num(m[0])) : t;
    } else if (key === 'roblox') {
        const cand = t.split(/\s+/)[0].replace(/^@/, '');
        if (cand.toLowerCase() === 'x') {
            d.roblox = 'X';
        } else {
            const r = deps.lookupRoblox ? await deps.lookupRoblox(cand).catch(() => null) : null;
            if (r && r.status === 'ok') d.roblox = r.name || cand;
            else if (r && r.status === 'notfound' && !d.robloxRetry) {
                d.robloxRetry = true;
                await sendQuestion(message.channel, d, key, true);
                savePanel(panelId, d);
                return true;
            } else d.roblox = cand; // 두 번째도 못 찾으면 그대로 저장 → 지급완료 때 디스코드 프로필로 전송
        }
    } else if (key === 'item') {
        d.item = t;
    }

    await askNext(message.channel, d);
    await refreshPanel(message.channel, panelId, d);
    return true;
}

// ---------- 티켓 대화에서 자동으로 채우기 ($가격 / $로벅스 / 금액) ----------
function scanStaffMessage(d, t) {
    let m, changed = false;
    const set = (k, v) => { if (v && d[k] !== v) { d[k] = v; changed = true; } };
    if ((m = t.match(/^\$가격\s+([\d.,]+)\s+([\d.,]+)/))) {
        const rate = num(m[1]), robux = num(m[2]);
        if (rate > 0 && robux > 0) {
            set('count', fmt(robux));
            set('price', `${fmt(Math.ceil((robux / rate) * 10000 / 100) * 100)}원`);
        }
    } else if ((m = t.match(/^\$로벅스\s+([\d.,]+)\s+([\d.,]+)/))) {
        const rate = num(m[1]), money = num(m[2]);
        if (rate > 0 && money > 0) {
            set('count', fmt(Math.floor((money / 10000) * rate)));
            set('price', `${fmt(money)}원`);
        }
    }
    return changed;
}

function scanPrice(d, t) {
    if (d.price || t.startsWith('$')) return false;
    let m;
    if ((m = t.match(/([\d.]+)\s*만\s*원/))) d.price = `${fmt(num(m[1]) * 10000)}원`;
    else if ((m = t.match(/(\d[\d,]{2,})\s*원/))) d.price = `${fmt(num(m[1]))}원`;
    else return false;
    return true;
}

async function onChatMessage(message) {
    if (!message.guild || message.author.bot) return;
    const p = activePanelOf(message.channel.id);
    if (!p) return;
    const { id, d } = p;
    const t = String(message.content || '').trim();
    const staff = message.member ? deps.canUse(message.member) : false;

    // 구매자를 못 찾았던 티켓: 처음 말한 (판매자가 아닌) 사람을 구매자로 잡고 질문 시작
    if (!d.buyerId && !staff) {
        d.buyerId = message.author.id;
        await refreshPanel(message.channel, id, d);
        await startQuestions(message.channel, id, d);
        return;
    }

    if (message.author.id === d.buyerId && d.asking) {
        await handleAnswer(message, id, d);
        return;
    }
    if (staff && scanStaffMessage(d, t)) return refreshPanel(message.channel, id, d);
    if ((staff || message.author.id === d.buyerId) && scanPrice(d, t)) return refreshPanel(message.channel, id, d);
}

// ---------- 화면 (컴포넌트 V2) ----------
const mention = (id) => (id ? `<@${id}>` : '미지정');

async function avatarUrl(client, userId) {
    try {
        const u = await client.users.fetch(userId);
        return u.displayAvatarURL({ extension: 'png', size: 256 });
    } catch (e) {
        return null;
    }
}

function summaryLine(d) {
    const parts = [
        d.kind ? KIND_LABEL[d.kind] : '종류 미정',
        d.kind === 'robux' ? null : (d.item || '상품 미입력'),
        d.count ? (d.kind === 'robux' ? `${d.count} 로벅스` : `${d.count}개`) : '수량 미입력',
        d.price || '금액 미입력',
        d.roblox && d.roblox.toLowerCase() !== 'x' ? d.roblox : (d.roblox ? '로블록스 없음' : '로블록스 미입력')
    ].filter(Boolean);
    return `-# ${parts.join(' · ')}`;
}

async function panelPayload(client, d) {
    const done = !!d.done;
    const lines = done
        ? ['### 구매로그 전송 완료', `구매자 ${mention(d.buyerId)} · 판매자 ${mention(d.sellerId)}`, summaryLine(d),
            `-# ${d.code ? `구매 ID ${d.code} · ` : ''}처리 ${mention(d.by)}`]
        : ['### 구매로그 설정', `구매자 ${mention(d.buyerId)} · 판매자 ${mention(d.sellerId)}`, summaryLine(d)];
    const text = { type: 10, content: lines.join('\n') };
    const avatar = d.buyerId ? await avatarUrl(client, d.buyerId) : null;
    const head = avatar ? { type: 9, components: [text], accessory: { type: 11, media: { url: avatar } } } : text;

    const buttons = done
        ? [{ type: 2, style: 1, label: '추가 구매', custom_id: 'ttlog_more' }]
        : [
            { type: 2, style: 2, label: '정보 수정', custom_id: 'ttlog_edit' },
            { type: 2, style: 3, label: '지급완료', custom_id: 'ttlog_done' }
        ];

    return {
        components: [{
            type: 17,
            accent_color: done ? DONE_COLOR : PANEL_COLOR,
            components: [head, { type: 14, divider: true, spacing: 1 }, { type: 1, components: buttons }]
        }],
        allowedMentions: { parse: [] }
    };
}

// [정보 수정] 눌렀을 때 나만 보이는 화면: 판매자/구매자는 선택 메뉴로 바로, 나머지는 버튼으로
function editPayload(panelId, d) {
    const body = [
        '### 구매로그 정보 수정',
        `**종류** ${d.kind ? KIND_LABEL[d.kind] : '미정'}`,
        `**상품** ${d.item || '미입력'}`,
        `**수량** ${d.count || '미입력'}`,
        `**금액** ${d.price || '미입력'}`,
        `**로블록스 아이디** ${d.roblox || '미입력'}`,
        '-# 판매자 / 구매자는 아래 메뉴에서 이름을 검색해 고르면 바로 적용돼요.'
    ].join('\n');
    const sel = (cid, ph, id) => ({
        type: 1,
        components: [{
            type: 5, custom_id: `${cid}:${panelId}`, placeholder: ph, min_values: 1, max_values: 1,
            ...(id ? { default_values: [{ id, type: 'user' }] } : {})
        }]
    });
    return {
        components: [{
            type: 17,
            accent_color: PANEL_COLOR,
            components: [
                { type: 10, content: body },
                { type: 14, divider: true, spacing: 1 },
                { type: 10, content: '**판매자**' },
                sel('ttlog_seller', '판매자 선택', d.sellerId),
                { type: 10, content: '**구매자**' },
                sel('ttlog_buyer', '구매자 선택', d.buyerId),
                { type: 14, divider: true, spacing: 1 },
                { type: 1, components: [{ type: 2, style: 1, label: '상품 · 수량 · 금액 수정', custom_id: `ttlog_info:${panelId}` }] }
            ]
        }],
        allowedMentions: { parse: [] }
    };
}

function infoModal(panelId, d) {
    const input = (cid, label, value, placeholder, required = true) => {
        const t = new TextInputBuilder().setCustomId(cid).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(200);
        if (placeholder) t.setPlaceholder(placeholder);
        if (value) t.setValue(String(value).slice(0, 200));
        return new ActionRowBuilder().addComponents(t);
    };
    return new ModalBuilder().setCustomId(`ttlog_modal:${panelId}`).setTitle('구매로그 정보 수정').addComponents(
        input('kind', '종류 (로벅스 / 인게임 / 기타)', d.kind ? KIND_LABEL[d.kind] : '', '로벅스'),
        input('item', '상품', d.item, '로벅스는 "로벅스"'),
        input('count', '수량 (로벅스는 로벅스 수량)', d.count, '1000'),
        input('price', '금액', d.price, '10000원'),
        input('roblox', '로블록스 아이디 (없으면 X)', d.roblox, 'X', false)
    );
}

// 지급완료 때 빈 칸만 묻는 창
function missingForDone(d) {
    return ['buyer', 'kind', 'item', 'count', 'price'].filter((k) => (k === 'buyer' ? !d.buyerId : !d[k]));
}
function doneModal(panelId, d, miss) {
    const keys = [...miss];
    if (!d.roblox && keys.length < 5) keys.push('roblox');
    const ph = { buyer: '123456789012345678', kind: '로벅스 / 인게임 / 기타', item: '상품 이름', count: d.kind === 'robux' ? '로벅스 수량' : '수량', price: '10000원', roblox: '없으면 비워두기 (디스코드 프로필로 전송)' };
    const modal = new ModalBuilder().setCustomId(`ttlog_donemodal:${panelId}`).setTitle('빈 칸만 채워주세요');
    for (const k of keys.slice(0, 5)) {
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId(k).setLabel(FIELD_NAME[k]).setStyle(TextInputStyle.Short)
                .setRequired(k !== 'roblox').setMaxLength(100).setPlaceholder(ph[k])
        ));
    }
    return modal;
}

// ---------- 패널 생성 / 갱신 ----------
async function sendPanel(channel, d) {
    const msg = await channel.send({ flags: FLAG_V2, ...(await panelPayload(channel.client, d)) });
    savePanel(msg.id, d);
    return msg;
}

async function refreshPanel(channel, panelId, d) {
    savePanel(panelId, d);
    const msg = await channel.messages.fetch(panelId).catch(() => null);
    if (msg) await msg.edit(await panelPayload(channel.client, d)).catch((e) => console.error('[티켓] 패널 수정 실패:', e.message));
}

function shouldSkip(channel) {
    const text = `${channel.name || ''} ${(channel.parent && channel.parent.name) || ''}`.toLowerCase();
    return SKIP_KEYWORDS.some((k) => text.includes(k.toLowerCase()));
}

async function setupTicket(channel) {
    if (!channel || !channel.guild || handled.has(channel.id)) return;
    if (!channel.createdTimestamp || Date.now() - channel.createdTimestamp > PANEL_WINDOW_MS) return;
    if (shouldSkip(channel)) return;
    handled.add(channel.id);

    await new Promise((r) => setTimeout(r, COLLECT_DELAY_MS));
    try {
        // 재시작 직후 등으로 이미 패널이 있으면 다시 만들지 않기
        if (Object.values(allPanels()).some((p) => p.channelId === channel.id)) return;
        const d = await gatherFromChannel(channel);
        const msg = await sendPanel(channel, d);
        if (d.buyerId) await startQuestions(channel, msg.id, d);
        // 구매자를 못 찾았으면 처음 채팅한 사람을 구매자로 잡고 그때 질문을 시작해요
    } catch (e) {
        handled.delete(channel.id);
        console.error('[티켓] 구매로그 패널 생성 실패:', e.message);
    }
}

// ---------- 지급완료 ----------
async function finishPurchase(interaction, channel, panelId, d) {
    busy.add(panelId);
    try {
        const client = interaction.client;
        const buyer = await client.users.fetch(d.buyerId);
        const seller = d.sellerId ? await client.users.fetch(d.sellerId) : interaction.user;

        const res = await deps.completePurchase({
            guild: interaction.guild,
            channel,
            buyer,
            kind: d.kind,
            item: d.item,
            count: d.count,
            price: d.price,
            robloxInput: d.roblox || 'X',
            seller,
            fallbackDiscord: true // 로블록스 아이디가 맞지 않으면 디스코드 프로필로
        });
        if (!res.ok) {
            savePanel(panelId, d);
            await interaction.editReply({ content: res.error });
            return;
        }

        Object.assign(d, {
            done: true,
            asking: null,
            sellerId: d.sellerId || seller.id,
            by: interaction.user.id,
            code: res.purchaseId ? deps.purchaseCode(res.purchaseId) : null
        });
        await refreshPanel(channel, panelId, d);
        for (const w of res.warns) interaction.followUp(eph(w)).catch(() => {});
        await interaction.editReply({ content: '지급완료 처리가 완료되었습니다.' }).catch(() => {});
    } catch (e) {
        console.error('[티켓] 지급완료 처리 실패:', e);
        await interaction.editReply({ content: '처리 중 오류가 났어요. 잠시 후 다시 시도하거나 /지급완료 명령어를 사용해 주세요.' }).catch(() => {});
    } finally {
        busy.delete(panelId);
    }
}

// ---------- 버튼 / 선택 / 양식 처리 ----------
const eph = (content) => ({ content, ephemeral: true });

async function handleInteraction(interaction) {
    const cid = interaction.customId || '';
    if (!cid.startsWith('ttlog_')) return false;
    const [action, ref] = cid.split(':');

    if (!deps.canUse(interaction.member)) {
        await interaction.reply(eph('판매자 또는 관리자만 사용할 수 있어요.')).catch(() => {});
        return true;
    }

    const panelId = ref || (interaction.message && interaction.message.id);
    const d = getPanel(panelId);
    if (!d) {
        await interaction.reply(eph('패널 정보를 찾을 수 없어요. 예전 버전 패널이면 /지급완료 명령어를 사용해 주세요.')).catch(() => {});
        return true;
    }
    const channel = interaction.channel;

    // 추가 구매 (같은 티켓에서 또 구매) → 바로 새 패널 (수량·금액은 $가격 이나 지급완료 때 입력)
    if (action === 'ttlog_more') {
        await interaction.deferUpdate();
        await sendPanel(channel, {
            channelId: channel.id, buyerId: d.buyerId, sellerId: d.sellerId, kind: d.kind,
            item: d.kind === 'robux' ? '로벅스' : '', count: '', price: '', roblox: d.roblox, asked: true
        });
        return true;
    }

    if (d.done) {
        await interaction.reply(eph('이미 지급완료 처리된 패널이에요. 추가 구매는 [추가 구매] 를 눌러주세요.')).catch(() => {});
        return true;
    }

    // 정보 수정 → 나만 보이는 수정 화면
    if (action === 'ttlog_edit') {
        await interaction.reply({ flags: FLAG_V2 | FLAG_EPHEMERAL, ...editPayload(panelId, d) });
        return true;
    }

    // 판매자 / 구매자 선택 → 바로 적용
    if (interaction.isUserSelectMenu()) {
        const u = interaction.users.first();
        if (!u || u.bot) {
            await interaction.reply(eph('봇은 선택할 수 없어요.'));
            return true;
        }
        const buyerChanged = action === 'ttlog_buyer' && d.buyerId !== u.id;
        if (action === 'ttlog_seller') d.sellerId = u.id;
        if (action === 'ttlog_buyer') d.buyerId = u.id;
        await interaction.update(editPayload(panelId, d));
        await refreshPanel(channel, panelId, d);
        // 구매자가 바뀌었고 아직 질문이 안 끝났으면 새 구매자에게 질문
        if (buyerChanged && !d.asked) await startQuestions(channel, panelId, d);
        return true;
    }

    // 상품 · 수량 · 금액 수정
    if (action === 'ttlog_info') {
        await interaction.showModal(infoModal(panelId, d));
        return true;
    }
    if (action === 'ttlog_modal' && interaction.isModalSubmit()) {
        const v = (k) => interaction.fields.getTextInputValue(k).trim();
        d.kind = parseKindInput(v('kind')) || d.kind;
        d.item = v('item');
        d.count = v('count');
        d.price = v('price');
        d.roblox = v('roblox');
        if (interaction.message) await interaction.update(editPayload(panelId, d));
        else await interaction.deferUpdate();
        await refreshPanel(channel, panelId, d);
        return true;
    }

    // 지급완료 → 빈 칸이 있으면 빈 칸만 묻는 창
    if (action === 'ttlog_done') {
        if (busy.has(panelId)) {
            await interaction.reply(eph('지금 처리 중이에요. 잠시만 기다려 주세요.'));
            return true;
        }
        const miss = missingForDone(d);
        if (miss.length) {
            await interaction.showModal(doneModal(panelId, d, miss));
            return true;
        }
        await interaction.reply(eph('지급완료를 처리 중입니다.'));
        await finishPurchase(interaction, channel, panelId, d);
        return true;
    }
    if (action === 'ttlog_donemodal' && interaction.isModalSubmit()) {
        for (const k of ['buyer', 'kind', 'item', 'count', 'price', 'roblox']) {
            let v = null;
            try { v = interaction.fields.getTextInputValue(k).trim(); } catch (e) {}
            if (!v) continue;
            if (k === 'kind') d.kind = parseKindInput(v);
            else if (k === 'buyer') d.buyerId = (v.match(/\d{15,25}/) || [])[0] || d.buyerId;
            else d[k] = v;
        }
        if (d.kind === 'robux' && !d.item) d.item = '로벅스';
        const miss = missingForDone(d);
        if (miss.length) {
            savePanel(panelId, d);
            await interaction.reply(eph(`아직 비어 있어요: **${miss.map((k) => FIELD_NAME[k]).join(', ')}**`));
            return true;
        }
        if (busy.has(panelId)) {
            await interaction.reply(eph('지금 처리 중이에요. 잠시만 기다려 주세요.'));
            return true;
        }
        await interaction.reply(eph('지급완료를 처리 중입니다.'));
        await finishPurchase(interaction, channel, panelId, d);
        return true;
    }

    // 예전 버전 패널의 버튼 (구매로그 확인 / 구매 정보 입력 등)
    await interaction.reply(eph('예전 버전 버튼이에요. [정보 수정] 을 사용해 주세요.')).catch(() => {});
    return true;
}

function init(client, d) {
    deps = d;
    // 이름에 ticket / 티켓 이 들어간 채널이 만들어지면 패널 생성
    client.on('channelCreate', (channel) => {
        if (channel.type === ChannelType.GuildText && TICKET_NAME_RE.test(channel.name)) {
            setupTicket(channel).catch((e) => console.error('[티켓] 오류:', e.message));
        }
    });
    client.on('messageCreate', (message) => {
        // 티켓 이름이 ticket 이 아니어도(예: "라프-0012") 티켓툴이 연 티켓이면 패널 생성
        if (message.author && TICKET_TOOL_BOT_IDS.includes(message.author.id)) {
            setupTicket(message.channel).catch((e) => console.error('[티켓] 오류:', e.message));
        } else {
            onChatMessage(message).catch((e) => console.error('[티켓] 대화 읽기 오류:', e.message));
        }
    });
    client.on('channelDelete', (ch) => handled.delete(ch.id));
}

module.exports = { init, handleInteraction, isTicketToolChannel };
