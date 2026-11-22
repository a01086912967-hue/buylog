// ==================== 티켓툴(Ticket Tool) 구매로그 설정 패널 ====================
// 티켓툴이 티켓 채널을 만들면 그 아래에 작은 "구매로그 설정" 패널(컴포넌트 V2)을 띄워요.
// - 구매자가 티켓툴 양식에 적은 답변(로블록스 닉네임, 수량, 금액 등)을 자동으로 읽어와요.
// - 판매자는 티켓 이름/카테고리(예: "라프" 티켓 → 라프)로 자동 지정돼요.
// - [구매로그 확인] 으로 전체 정보를 보고 판매자/구매자 변경, [정보 수정] 으로 고친 뒤
//   [지급완료] 를 누르면 /지급완료 명령어와 똑같이 구매로그가 전송되고 통계에 기록돼요.
// - 같은 티켓에서 또 구매하면 완료된 패널의 [추가 구매] 로 새 구매로그를 적을 수 있어요.
// - 패널 정보는 data.json 에 저장되므로 Railway 재배포 후에도 버튼이 그대로 동작해요.

const {
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const store = require('./store');

// ---------- 설정 ----------
// 티켓툴 봇 ID (기존 Ticket Tool + 이름이 같은 새 Ticket Tool 봇. 프리미엄/커스텀 봇이면 여기에 추가)
const TICKET_TOOL_BOT_IDS = ['557628352828014614', '1506999581722804274'];
const PANEL_WINDOW_MS = 5 * 60 * 1000;               // 채널이 만들어진 지 5분 안의 티켓툴 메시지에만 패널 생성
const COLLECT_DELAY_MS = 4000;                       // 티켓툴이 양식 답변을 보낼 때까지 잠깐 기다리기
// 채널 이름 / 카테고리 이름에 이 단어가 있으면 패널을 만들지 않아요 (문의 티켓 등)
const SKIP_KEYWORDS = ['문의', '신고', '셀러', '지원', 'support', 'report'];
// 판매자 이름 → 디스코드 유저 ID (비워두면 "판매자" 역할을 가진 사람의 닉네임/아이디로 자동으로 찾아요)
// 티켓 이름이 판매자 닉네임과 다르면 여기에 직접 적어주세요. 예: { '라프': '123456789012345678' }
const SELLER_MAP = {};
const PANEL_COLOR = 0xA9D8FF;
const DONE_COLOR = 0x7BD88F;
const FLAG_V2 = 1 << 15;
const FLAG_EPHEMERAL = 1 << 6;
const META_KEY = 'ttPanels';

const KIND_LABEL = { robux: '로벅스', ingame: '인게임', etc: '기타' };

let deps = null; // { completePurchase, canUse, purchaseCode, sellerRoleId }
const handled = new Set();     // 패널을 이미 만든 채널
const busy = new Set();        // 지급완료 처리 중인 패널 (중복 클릭 방지)

// ---------- 패널 데이터 저장 (data.json) ----------
function allPanels() {
    const v = store.getMeta(META_KEY);
    return v && typeof v === 'object' ? v : {};
}
function getPanel(msgId) {
    return allPanels()[msgId] || null;
}
function savePanel(msgId, d) {
    const all = allPanels();
    all[msgId] = { ...d, ts: d.ts || Date.now() };
    // 30일 지난 패널 정보는 정리
    const cut = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const [k, v] of Object.entries(all)) if (!v || v.ts < cut) delete all[k];
    store.setMeta(META_KEY, all);
}
const isTicketToolChannel = (channelId) =>
    handled.has(channelId) || Object.values(allPanels()).some((p) => p.channelId === channelId);

// ---------- 티켓툴 메시지에서 글자 모으기 (임베드 + 컴포넌트 V2 둘 다) ----------
function textsOfComponent(c, out) {
    if (!c || typeof c !== 'object') return;
    if (typeof c.content === 'string') out.push(c.content);
    if (c.label && typeof c.label === 'string') out.push(c.label);
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

// [질문, 답변] 목록
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
            // 질문 (다음 줄) ```답변```
            const codeRe = /(?:^|\n)([^\n`]+?)\s*\n\s*```(?:[a-z]+\n)?([\s\S]*?)```/gi;
            while ((r = codeRe.exec(t))) push(r[1], r[2]);
            // **질문** (다음 줄) 답변
            const boldRe = /\*\*([^*\n]+)\*\*\s*\n\s*([^\n`*][^\n]*)/g;
            while ((r = boldRe.exec(t))) push(r[1], r[2]);
            // 질문: 답변
            const colonRe = /^[\s*_#>\-]*([^:\n：`]{1,40}?)[\s*_]*[:：]\s*([^\n]+)$/gm;
            while ((r = colonRe.exec(t))) if (!/^https?$/i.test(r[1].trim())) push(r[1], r[2]);
        }
    }
    return qa;
}

// 질문 내용으로 어떤 항목인지 판단
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

// ---------- 판매자 / 구매자 찾기 ----------
async function sellerMembers(guild) {
    const roleId = deps.sellerRoleId;
    try {
        await guild.members.fetch();
    } catch (e) {}
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
    // 티켓을 연 사람 = 채널 권한에 직접 추가된 유저 (티켓툴이 티켓 연 사람을 채널에 추가해요)
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
    if (d.sellerId === d.buyerId && mentioned[0] === d.buyerId) d.sellerId = null;

    // 판매자: 티켓 이름 → 카테고리 이름 → 티켓툴 메시지 내용 순서로 판매자 이름 찾기
    const parentName = (channel.parent && channel.parent.name) || '';
    const nameSeller = findSellerByName(channel.name, sellers) || findSellerByName(parentName, sellers) || findSellerByName(allText, sellers);
    if (nameSeller) d.sellerId = nameSeller;
    if (d.sellerId === d.buyerId) d.sellerId = null;

    // 종류: 양식 답변 → 티켓 이름 → 카테고리 이름 → 티켓툴 메시지 내용
    if (!d.kind) d.kind = detectKind(channel.name) || detectKind(parentName) || detectKind(allText);
    if (d.kind === 'robux' && !d.item) d.item = '로벅스';

    console.log(`[티켓툴] ${channel.name} 양식 읽기 → ${JSON.stringify(d)}`);
    if (!d.roblox || !d.count) {
        // 못 읽은 항목이 있으면 원문을 로그에 남겨요 (Railway 로그에서 확인 가능)
        console.log(`[티켓툴] 양식 원문 (${channel.name}):\n${allText.slice(0, 1500)}\n필드: ${JSON.stringify(msgs.flatMap((m) => m.embeds.flatMap((e) => e.fields || []))).slice(0, 800)}`);
    }
    return d;
}

// ---------- 구매자가 직접 적는 항목 (티켓 종류별) ----------
const FIELD_NAME = { kind: '종류', item: '상품 이름', count: '수량', roblox: '로블록스 닉네임', price: '금액' };
function buyerFields(kind) {
    if (kind === 'robux') return ['roblox', 'count'];
    if (kind === 'ingame') return ['item', 'count', 'roblox'];
    if (kind === 'etc') return ['item', 'count'];
    return ['kind', 'item', 'count'];
}
const missingBuyer = (d) => buyerFields(d.kind).filter((k) => !d[k]);

// ---------- 화면 (컴포넌트 V2) ----------
const show = (v) => (v ? String(v).slice(0, 200) : '미입력');
const mention = (id) => (id ? `<@${id}>` : '미지정');

async function avatarUrl(client, userId) {
    try {
        const u = await client.users.fetch(userId);
        return u.displayAvatarURL({ extension: 'png', size: 256 });
    } catch (e) {
        return null;
    }
}

async function panelPayload(client, d) {
    const done = !!d.done;
    const lines = done
        ? [
            '### 구매로그 전송 완료',
            `구매자 ${mention(d.buyerId)}`,
            `판매자 ${mention(d.sellerId)}`,
            `-# ${d.code ? `구매 ID ${d.code} · ` : ''}처리 ${mention(d.by)}`
        ]
        : [
            '### 구매로그 설정',
            `구매자 ${mention(d.buyerId)}`,
            `판매자 ${mention(d.sellerId)}`,
            `-# ${d.kind ? `${KIND_LABEL[d.kind]} 티켓` : '종류 미정'}${missingBuyer(d).length ? ` · 입력 필요: ${missingBuyer(d).map((k) => FIELD_NAME[k]).join(', ')}` : ''}`
        ];
    const text = { type: 10, content: lines.join('\n') };
    const avatar = d.buyerId ? await avatarUrl(client, d.buyerId) : null;
    const head = avatar
        ? { type: 9, components: [text], accessory: { type: 11, media: { url: avatar } } }
        : text;

    const buttons = done
        ? [
            { type: 2, style: 2, label: '구매로그 확인', custom_id: 'ttlog_view' },
            { type: 2, style: 1, label: '추가 구매', custom_id: 'ttlog_more' }
        ]
        : [
            { type: 2, style: 1, label: '구매 정보 입력', custom_id: 'ttlog_input' },
            { type: 2, style: 2, label: '구매로그 확인', custom_id: 'ttlog_view' },
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

// [구매로그 확인] 눌렀을 때 나만 보이는 전체 정보
function viewPayload(panelId, d) {
    const body = [
        '### 구매로그 정보',
        `**구매자** ${mention(d.buyerId)}`,
        `**판매자** ${mention(d.sellerId)}${d.sellerId ? '' : ' (지급완료를 누른 사람으로 기록)'}`,
        `**종류** ${d.kind ? KIND_LABEL[d.kind] : '미정'}`,
        `**상품** ${show(d.item)}`,
        `**수량** ${show(d.count)}`,
        `**금액** ${show(d.price)}`,
        `**로블록스 아이디** ${show(d.roblox)}`,
        '-# 로블록스 아이디가 없거나 맞지 않으면 디스코드 프로필로 전송돼요.'
    ].join('\n');
    const comps = [{ type: 10, content: body }];
    if (!d.done) {
        const sel = (cid, ph, id) => ({
            type: 1,
            components: [{
                type: 5, custom_id: `${cid}:${panelId}`, placeholder: ph, min_values: 1, max_values: 1,
                ...(id ? { default_values: [{ id, type: 'user' }] } : {})
            }]
        });
        comps.push(
            { type: 14, divider: true, spacing: 1 },
            sel('ttlog_seller', '판매자 변경', d.sellerId),
            sel('ttlog_buyer', '구매자 변경', d.buyerId),
            { type: 1, components: [{ type: 2, style: 2, label: '정보 수정', custom_id: `ttlog_edit:${panelId}` }] }
        );
    }
    return { components: [{ type: 17, accent_color: d.done ? DONE_COLOR : PANEL_COLOR, components: comps }], allowedMentions: { parse: [] } };
}

function editModal(customId, title, d) {
    const input = (cid, label, value, placeholder, required = true) => {
        const t = new TextInputBuilder().setCustomId(cid).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(200);
        if (placeholder) t.setPlaceholder(placeholder);
        if (value) t.setValue(String(value).slice(0, 200));
        return new ActionRowBuilder().addComponents(t);
    };
    return new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(
        input('kind', '종류 (로벅스 / 인게임 / 기타)', d.kind ? KIND_LABEL[d.kind] : '', '로벅스'),
        input('item', '상품', d.item, '로벅스는 "로벅스"'),
        input('count', '수량 (로벅스는 로벅스 수량)', d.count, '1000'),
        input('price', '금액', d.price, '10000원'),
        input('roblox', '로블록스 아이디 (없으면 X)', d.roblox, 'X', false)
    );
}

// 구매자용 입력창 (금액은 판매자가 [정보 수정]에서 적어요)
function buyerModal(panelId, d) {
    const spec = {
        kind: ['종류 (로벅스 / 인게임 / 기타)', '로벅스', true],
        item: [d.kind === 'ingame' ? '게임 / 상품 이름' : '상품 이름', d.kind === 'ingame' ? '블록스 피스 - 레오파드' : '구매할 상품', true],
        count: [d.kind === 'robux' ? '로벅스 수량' : '수량', d.kind === 'robux' ? '1000' : '1', true],
        roblox: ['로블록스 닉네임', '로블록스 닉네임 (디스플레이 이름 X)', d.kind !== 'etc']
    };
    const keys = d.kind === 'etc' ? ['item', 'count', 'roblox'] : buyerFields(d.kind).concat(d.kind ? [] : ['roblox']);
    const modal = new ModalBuilder().setCustomId(`ttlog_inmodal:${panelId}`).setTitle('구매 정보 입력');
    for (const k of keys) {
        const [label, ph, req] = spec[k];
        const t = new TextInputBuilder().setCustomId(k).setLabel(label).setStyle(TextInputStyle.Short).setRequired(req).setMaxLength(100).setPlaceholder(ph);
        const cur = k === 'kind' ? (d.kind ? KIND_LABEL[d.kind] : '') : d[k];
        if (cur) t.setValue(String(cur).slice(0, 100));
        modal.addComponents(new ActionRowBuilder().addComponents(t));
    }
    return modal;
}

function applyModal(interaction, d) {
    const v = (k) => interaction.fields.getTextInputValue(k).trim();
    d.kind = parseKindInput(v('kind')) || d.kind;
    d.item = v('item');
    d.count = v('count');
    d.price = v('price');
    d.roblox = v('roblox');
    return d;
}

// ---------- 패널 생성 ----------
async function sendPanel(channel, d) {
    const msg = await channel.send({ flags: FLAG_V2, ...(await panelPayload(channel.client, d)) });
    savePanel(msg.id, d);
    return msg;
}

async function refreshPanel(channel, panelId, d) {
    savePanel(panelId, d);
    const msg = await channel.messages.fetch(panelId).catch(() => null);
    if (msg) await msg.edit(await panelPayload(channel.client, d)).catch((e) => console.error('[티켓툴] 패널 수정 실패:', e.message));
}

function shouldSkip(channel) {
    const text = `${channel.name || ''} ${(channel.parent && channel.parent.name) || ''}`.toLowerCase();
    return SKIP_KEYWORDS.some((k) => text.includes(k.toLowerCase()));
}

async function onTicketToolMessage(message) {
    const channel = message.channel;
    if (!message.guild || !channel || handled.has(channel.id)) return;
    if (!channel.createdTimestamp || Date.now() - channel.createdTimestamp > PANEL_WINDOW_MS) return;
    if (shouldSkip(channel)) return;
    handled.add(channel.id);

    await new Promise((r) => setTimeout(r, COLLECT_DELAY_MS));
    try {
        // 재시작 직후 등으로 이미 패널이 있으면 다시 만들지 않기
        if (Object.values(allPanels()).some((p) => p.channelId === channel.id)) return;
        const d = await gatherFromChannel(channel);
        await sendPanel(channel, d);
    } catch (e) {
        handled.delete(channel.id);
        console.error('[티켓툴] 구매로그 패널 생성 실패:', e.message);
    }
}

// ---------- 버튼 / 선택 / 양식 처리 ----------
const eph = (content) => ({ content, ephemeral: true });

async function handleInteraction(interaction) {
    const cid = interaction.customId || '';
    if (!cid.startsWith('ttlog_')) return false;
    const [action, ref] = cid.split(':');

    const panelId = ref || (interaction.message && interaction.message.id);
    const d = getPanel(panelId);
    if (!d) {
        await interaction.reply(eph('패널 정보를 찾을 수 없어요. 예전 버전 패널이면 /지급완료 명령어를 사용해 주세요.')).catch(() => {});
        return true;
    }
    const channel = interaction.channel;
    const staff = deps.canUse(interaction.member);
    const isBuyerAction = action === 'ttlog_input' || action === 'ttlog_inmodal';

    if (!staff && !(isBuyerAction && interaction.user.id === d.buyerId)) {
        await interaction.reply(eph(isBuyerAction ? '이 티켓의 구매자만 입력할 수 있어요.' : '판매자 또는 관리자만 사용할 수 있어요.')).catch(() => {});
        return true;
    }

    // 구매로그 확인
    if (action === 'ttlog_view') {
        await interaction.reply({ flags: FLAG_V2 | FLAG_EPHEMERAL, ...viewPayload(panelId, d) });
        return true;
    }

    // 추가 구매 (같은 티켓에서 또 구매) → 양식 입력 후 새 패널
    if (action === 'ttlog_more') {
        const base = { ...d, count: '', price: '', item: d.kind === 'robux' ? '로벅스' : '' };
        await interaction.showModal(editModal(`ttlog_addmodal:${panelId}`, '추가 구매 정보 입력', base));
        return true;
    }
    if (action === 'ttlog_addmodal' && interaction.isModalSubmit()) {
        const nd = applyModal(interaction, {
            channelId: channel.id, buyerId: d.buyerId, sellerId: d.sellerId, kind: d.kind,
            item: '', count: '', price: '', roblox: d.roblox
        });
        await interaction.deferUpdate();
        await sendPanel(channel, nd);
        return true;
    }

    if (d.done) {
        await interaction.reply(eph('이미 지급완료 처리된 패널이에요. 추가 구매는 [추가 구매] 를 눌러주세요.')).catch(() => {});
        return true;
    }

    // 구매 정보 입력 (구매자)
    if (action === 'ttlog_input') {
        await interaction.showModal(buyerModal(panelId, d));
        return true;
    }
    if (action === 'ttlog_inmodal' && interaction.isModalSubmit()) {
        const has = (k) => { try { return interaction.fields.getTextInputValue(k).trim(); } catch (e) { return null; } };
        const kind = has('kind');
        if (kind) d.kind = parseKindInput(kind);
        for (const k of ['item', 'count', 'roblox']) {
            const v = has(k);
            if (v !== null) d[k] = v;
        }
        if (d.kind === 'robux' && !d.item) d.item = '로벅스';
        await interaction.deferUpdate();
        await refreshPanel(channel, panelId, d);
        return true;
    }

    // 판매자 / 구매자 변경 (구매로그 확인 화면)
    if (interaction.isUserSelectMenu()) {
        const u = interaction.users.first();
        if (!u || u.bot) {
            await interaction.reply(eph('봇은 선택할 수 없어요.'));
            return true;
        }
        if (action === 'ttlog_seller') d.sellerId = u.id;
        if (action === 'ttlog_buyer') d.buyerId = u.id;
        await interaction.update(viewPayload(panelId, d));
        await refreshPanel(channel, panelId, d);
        return true;
    }

    // 정보 수정
    if (action === 'ttlog_edit') {
        await interaction.showModal(editModal(`ttlog_modal:${panelId}`, '구매로그 정보 수정', d));
        return true;
    }
    if (action === 'ttlog_modal' && interaction.isModalSubmit()) {
        applyModal(interaction, d);
        const fromView = interaction.message && interaction.message.id !== panelId;
        if (fromView) await interaction.update(viewPayload(panelId, d));
        else await interaction.deferUpdate();
        await refreshPanel(channel, panelId, d);
        return true;
    }

    // 지급완료
    if (action === 'ttlog_done') {
        const missing = [
            !d.buyerId && '구매자', !d.kind && '종류', !d.item && '상품', !d.count && '수량', !d.price && '금액'
        ].filter(Boolean);
        // 로블록스 닉네임이 비어 있으면 디스코드 프로필로 전송돼요 (지급완료는 막지 않음)
        if (missing.length) {
            await interaction.reply(eph(`아직 비어 있는 항목이 있어요: **${missing.join(', ')}**\n[정보 수정] 또는 [구매로그 확인]에서 채워주세요.`));
            return true;
        }
        if (busy.has(panelId)) {
            await interaction.reply(eph('지금 처리 중이에요. 잠시만 기다려 주세요.'));
            return true;
        }
        busy.add(panelId);
        await interaction.reply(eph('지급완료를 처리 중입니다.'));
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
                await interaction.editReply({ content: res.error });
                return true;
            }

            Object.assign(d, {
                done: true,
                sellerId: d.sellerId || seller.id,
                by: interaction.user.id,
                code: res.purchaseId ? deps.purchaseCode(res.purchaseId) : null
            });
            await refreshPanel(channel, panelId, d);
            for (const w of res.warns) interaction.followUp(eph(w)).catch(() => {});
            await interaction.editReply({ content: '지급완료 처리가 완료되었습니다.' }).catch(() => {});
        } catch (e) {
            console.error('[티켓툴] 지급완료 처리 실패:', e);
            await interaction.editReply({ content: '처리 중 오류가 났어요. 잠시 후 다시 시도하거나 /지급완료 명령어를 사용해 주세요.' }).catch(() => {});
        } finally {
            busy.delete(panelId);
        }
        return true;
    }

    return false;
}

function init(client, d) {
    deps = d;
    client.on('messageCreate', (message) => {
        if (message.author && TICKET_TOOL_BOT_IDS.includes(message.author.id)) {
            onTicketToolMessage(message).catch((e) => console.error('[티켓툴] 오류:', e.message));
        }
    });
    client.on('channelDelete', (ch) => handled.delete(ch.id));
}

module.exports = { init, handleInteraction, isTicketToolChannel };
