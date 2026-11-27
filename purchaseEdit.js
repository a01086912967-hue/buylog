// ==================== 구매로그 수정 ====================
// /구매로그수정 구매아이디:(ID)  → 그 구매로그 바로 수정
// /구매로그수정 유저:(@유저)      → 그 유저의 최근 구매 목록에서 골라서 수정
// 티켓 패널의 [구매로그 수정] 버튼으로도 열 수 있어요.
//
// 수정하면 구매 기록 + 유저 누적값(구매 로벅스/금액/거래횟수)이 같이 바뀌어서
// $정보 / $통계 / $랭킹 / 주간 랭킹 / 판매 정보 / 웹 대시보드에 바로 반영돼요.
// 구매로그 채널의 카드 이미지도 수정한 내용으로 다시 그려요.

const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const store = require('./store');

const FLAG_V2 = 1 << 15;
const FLAG_EPHEMERAL = 1 << 6;
const COLOR = 0xA9D8FF;
const DANGER = 0xF28B82;
const KIND_LABEL = { robux: '로벅스', ingame: '인게임', etc: '기타' };

let deps = null; // { canUse, rebuild(guild, p), deleteMsg(guild, p) }

const fmtNum = (n) => Number(n || 0).toLocaleString('ko-KR');
const kst = (ts) => new Date((ts || 0) + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
const priceOf = (p) => p.price || `${fmtNum(p.spent)}원`;
const summaryOf = (p) => (p.kind === 'robux' ? `${p.qty || fmtNum(p.robux)} 로벅스` : `${p.item || KIND_LABEL[p.kind] || '상품'}${p.qty ? ` ${p.qty}개` : ''}`);

function detectKind(v) {
    const s = String(v || '').toLowerCase();
    if (/로벅스|robux|rbx/.test(s)) return 'robux';
    if (/인게임|ingame|게임/.test(s)) return 'ingame';
    if (s.trim()) return 'etc';
    return null;
}

const NOTE = {
    edited: '수정했어요. 구매로그 카드도 바꿨어요.',
    nomsg: '수정했어요. (구매로그 채널에서 카드를 찾지 못해 카드는 그대로예요)',
    fail: '수정했어요. (카드를 다시 그리지 못했어요)'
};

// ---------- 화면 ----------
function viewPayload(p, note = '') {
    const body = [
        '### 구매로그 수정',
        `-# 구매 ID ${store.purchaseCode(p.id)} · ${kst(p.ts)}${p.editedTs ? ` · 마지막 수정 ${kst(p.editedTs)}` : ''}`,
        `**구매자** <@${p.buyerId}> · **판매자** ${p.sellerId ? `<@${p.sellerId}>` : '없음'}`,
        `**종류** ${KIND_LABEL[p.kind] || p.kind}`,
        `**상품** ${p.item || '없음'}`,
        `**수량** ${p.qty || '없음'}`,
        `**금액** ${priceOf(p)}`,
        `**로블록스 아이디** ${p.roblox || (p.robloxUserId ? '카드에 있던 계정 유지' : '없음 (디스코드 프로필)')}`
    ];
    if (note) body.push(`-# ${note}`);
    const sel = (cid, ph, id) => ({
        type: 1,
        components: [{
            type: 5, custom_id: `${cid}:${p.id}`, placeholder: ph, min_values: 1, max_values: 1,
            ...(id ? { default_values: [{ id, type: 'user' }] } : {})
        }]
    });
    return {
        components: [{
            type: 17,
            accent_color: COLOR,
            components: [
                { type: 10, content: body.join('\n') },
                { type: 14, divider: true, spacing: 1 },
                { type: 10, content: '**구매자**' },
                sel('pe_buyer', '구매자 변경', p.buyerId),
                { type: 10, content: '**판매자**' },
                sel('pe_seller', '판매자 변경', p.sellerId),
                { type: 14, divider: true, spacing: 1 },
                {
                    type: 1, components: [
                        { type: 2, style: 1, label: '상품 · 수량 · 금액 수정', custom_id: `pe_info:${p.id}` },
                        { type: 2, style: 4, label: '구매로그 삭제', custom_id: `pe_del:${p.id}` }
                    ]
                },
                { type: 10, content: '-# 수정하면 $정보 · $통계 · $랭킹 · 주간 랭킹에 바로 반영돼요.' }
            ]
        }],
        allowedMentions: { parse: [] }
    };
}

function confirmPayload(p) {
    return {
        components: [{
            type: 17,
            accent_color: DANGER,
            components: [
                { type: 10, content: `### 구매로그를 삭제할까요?\n<@${p.buyerId}> · ${summaryOf(p)} · ${priceOf(p)}\n-# 구매 ID ${store.purchaseCode(p.id)}\n-# 삭제하면 구매자의 구매 금액 · 로벅스 · 거래횟수에서도 빠지고, 구매로그 카드도 지워져요.` },
                { type: 14, divider: true, spacing: 1 },
                {
                    type: 1, components: [
                        { type: 2, style: 4, label: '삭제', custom_id: `pe_delok:${p.id}` },
                        { type: 2, style: 2, label: '취소', custom_id: `pe_back:${p.id}` }
                    ]
                }
            ]
        }],
        allowedMentions: { parse: [] }
    };
}

const textPayload = (content, color = COLOR) => ({
    components: [{ type: 17, accent_color: color, components: [{ type: 10, content }] }],
    allowedMentions: { parse: [] }
});

function listPayload(userId, list) {
    return {
        components: [{
            type: 17,
            accent_color: COLOR,
            components: [
                { type: 10, content: `### 구매로그 수정\n<@${userId}> 님의 최근 구매 ${list.length}건 중에서 수정할 구매를 골라주세요.` },
                {
                    type: 1, components: [{
                        type: 3, custom_id: 'pe_pick', placeholder: '수정할 구매 선택',
                        options: list.map((p) => ({
                            label: `${summaryOf(p)} · ${priceOf(p)}`.slice(0, 100),
                            description: `${kst(p.ts)} · 구매 ID ${store.purchaseCode(p.id)}`.slice(0, 100),
                            value: String(p.id)
                        }))
                    }]
                }
            ]
        }],
        allowedMentions: { parse: [] }
    };
}

// ---------- 열기 ----------
// 구매 ID 로 바로 열기 (슬래시 명령어 / 티켓 패널 버튼)
async function openById(interaction, code) {
    const p = store.findPurchaseByCode(code);
    if (!p) return interaction.reply({ content: `구매 ID \`${code}\` 를 찾을 수 없어요.`, ephemeral: true });
    return interaction.reply({ flags: FLAG_V2 | FLAG_EPHEMERAL, ...viewPayload(p) });
}

// 유저의 최근 구매 목록
async function openByUser(interaction, user) {
    const { list } = store.purchasesOf(user.id, 25);
    if (!list.length) return interaction.reply({ content: `${user} 님의 구매 기록이 없어요.`, ephemeral: true, allowedMentions: { parse: [] } });
    return interaction.reply({ flags: FLAG_V2 | FLAG_EPHEMERAL, ...listPayload(user.id, list) });
}

// 슬래시 명령어 /구매로그수정
async function handleCommand(interaction) {
    if (!deps.canUse(interaction.member)) {
        return interaction.reply({ content: '판매자 또는 관리자만 사용할 수 있어요.', ephemeral: true });
    }
    const code = interaction.options.getString('구매아이디');
    const user = interaction.options.getUser('유저');
    if (code) return openById(interaction, code.trim());
    if (user) return openByUser(interaction, user);
    return interaction.reply({ content: '구매아이디 또는 유저 중 하나를 입력해 주세요.', ephemeral: true });
}

// 수정 후 카드 다시 그리기
async function rebuild(guild, p) {
    try {
        return await deps.rebuild(guild, p);
    } catch (e) {
        console.error('[구매로그 수정] 카드 다시 그리기 실패:', e.message);
        return 'fail';
    }
}

// ---------- 버튼 / 선택 / 양식 ----------
async function handleInteraction(interaction) {
    const cid = interaction.customId || '';
    if (!cid.startsWith('pe_')) return false;
    const [action, ref] = cid.split(':');

    if (!deps.canUse(interaction.member)) {
        await interaction.reply({ content: '판매자 또는 관리자만 사용할 수 있어요.', ephemeral: true }).catch(() => {});
        return true;
    }

    const id = action === 'pe_pick' ? Number(interaction.values[0]) : Number(ref);
    const p = store.getPurchase(id);
    if (!p) {
        await interaction.update(textPayload('이 구매로그는 이미 삭제됐거나 찾을 수 없어요.')).catch(() => {});
        return true;
    }

    if (action === 'pe_pick' || action === 'pe_back') {
        await interaction.update(viewPayload(p));
        return true;
    }

    // 구매자 / 판매자 변경
    if (action === 'pe_buyer' || action === 'pe_seller') {
        const u = interaction.users.first();
        if (!u || u.bot) {
            await interaction.reply({ content: '봇은 선택할 수 없어요.', ephemeral: true });
            return true;
        }
        await interaction.deferUpdate();
        const np = store.editPurchase(p.id, action === 'pe_buyer' ? { buyerId: u.id } : { sellerId: u.id });
        const r = await rebuild(interaction.guild, np);
        await interaction.editReply(viewPayload(np, NOTE[r]));
        return true;
    }

    // 상품 · 수량 · 금액 · 로블록스 아이디 수정
    if (action === 'pe_info') {
        const input = (k, label, value, ph, required = true) => {
            const t = new TextInputBuilder().setCustomId(k).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(80).setPlaceholder(ph);
            if (value) t.setValue(String(value).slice(0, 80));
            return new ActionRowBuilder().addComponents(t);
        };
        await interaction.showModal(new ModalBuilder().setCustomId(`pe_modal:${p.id}`).setTitle('구매로그 수정').addComponents(
            input('kind', '종류 (로벅스 / 인게임 / 기타)', KIND_LABEL[p.kind] || '', '로벅스'),
            input('item', '상품', p.item, '로벅스는 "로벅스"'),
            input('qty', '수량 (로벅스는 로벅스 수량)', p.qty, '1000'),
            input('price', '금액', priceOf(p), '10000원'),
            input('roblox', '로블록스 아이디 (X = 디스코드 프로필)', p.roblox, '비우면 카드에 있던 계정 유지', false)
        ));
        return true;
    }
    if (action === 'pe_modal' && interaction.isModalSubmit()) {
        const v = (k) => interaction.fields.getTextInputValue(k).trim();
        await interaction.deferUpdate();
        const np = store.editPurchase(p.id, {
            kind: detectKind(v('kind')) || p.kind,
            item: v('item'),
            qty: /^[\d,]+$/.test(v('qty')) ? fmtNum(Number(v('qty').replace(/,/g, ''))) : v('qty'),
            price: v('price'),
            roblox: v('roblox') // 비우면 카드에 있던 로블록스 계정 유지 (없으면 디스코드 프로필)
        });
        const r = await rebuild(interaction.guild, np);
        const warn = np.spent === 0 || (np.kind === 'robux' && np.robux === 0) ? ' 금액/수량을 숫자로 읽지 못해 0으로 기록됐어요.' : '';
        await interaction.editReply(viewPayload(np, NOTE[r] + warn));
        return true;
    }

    // 삭제
    if (action === 'pe_del') {
        await interaction.update(confirmPayload(p));
        return true;
    }
    if (action === 'pe_delok') {
        await interaction.deferUpdate();
        const removed = store.deletePurchase(p.id);
        const msgDeleted = removed ? await deps.deleteMsg(interaction.guild, removed).catch(() => false) : false;
        await interaction.editReply(textPayload(
            `### 구매로그를 삭제했어요\n<@${removed.buyerId}> · ${summaryOf(removed)} · ${priceOf(removed)}\n-# 구매 ID ${store.purchaseCode(removed.id)} · ${msgDeleted ? '구매로그 카드도 지웠어요.' : '구매로그 카드를 찾지 못했어요. 남아 있다면 직접 지워주세요.'}`,
            DANGER
        ));
        return true;
    }

    return false;
}

function init(d) {
    deps = d;
}

module.exports = { init, handleCommand, handleInteraction, openById };
