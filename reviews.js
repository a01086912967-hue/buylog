// ==================== 후기 자동 수집 ====================
// 지급완료되면 바로 구매자에게 DM 으로 별점 버튼(1~5점)을 보내요.
// 별점을 누르면 한 줄 후기 입력창이 뜨고(선택), 제출하면 후기 채널에 카드로 자동으로 올라가요.
// 보낼 목록은 data.json 에 저장되므로 Railway 재배포 후에도 시간이 되면 그대로 보내요.

const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const store = require('./store');

// ---------- 설정 ----------
const REVIEW_CHANNEL_ID = '1457384179535712473'; // 후기 채널
const REVIEW_DELAY_MS = 0;                        // 지급완료되면 바로 DM (1시간 뒤로 하려면 60 * 60 * 1000)
const CHECK_EVERY_MS = 60 * 1000;                 // 1분마다 보낼 DM 확인
const SHOP_NAME = 'SODDU SHOP';
const COLOR = 0xA9D8FF;
const FLAG_V2 = 1 << 15;
const META_KEY = 'reviews';

const KIND_LABEL = { robux: '로벅스', ingame: '인게임', etc: '기타' };
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

function all() {
    const v = store.getMeta(META_KEY);
    return v && typeof v === 'object' ? v : {};
}
function save(map) {
    const cut = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30일 지난 기록 정리
    for (const [k, v] of Object.entries(map)) if (!v || (v.due || 0) < cut) delete map[k];
    store.setMeta(META_KEY, map);
}
function update(id, patch) {
    const map = all();
    if (!map[id]) return null;
    map[id] = { ...map[id], ...patch };
    save(map);
    return map[id];
}

// 지급완료 때 호출: 1시간 뒤 후기 요청 예약
function schedule({ guildId, buyerId, sellerId, kind, item, count, code }) {
    if (!buyerId) return;
    const map = all();
    const id = code || `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    map[id] = { guildId, buyerId, sellerId, kind, item, count, code, due: Date.now() + REVIEW_DELAY_MS, sent: false, done: false };
    save(map);
    // 바로 보내기 (1분 확인 주기를 기다리지 않음)
    if (!REVIEW_DELAY_MS && client) sendDue(client).catch((e) => console.error('[후기] 오류:', e.message));
}

const summary = (r) => r.kind === 'robux' ? `${r.count} 로벅스` : `${r.item || KIND_LABEL[r.kind] || '상품'}${r.count ? ` ${r.count}개` : ''}`;

// DM 내용
function askPayload(id, r) {
    return {
        flags: FLAG_V2,
        components: [{
            type: 17,
            accent_color: COLOR,
            components: [
                { type: 10, content: `### 구매는 만족스러우셨나요?\n${SHOP_NAME}에서 구매하신 **${summary(r)}** 어떠셨는지 별점을 남겨주세요.\n-# 별점을 누르면 한 줄 후기도 남길 수 있어요. (선택)` },
                { type: 14, divider: true, spacing: 1 },
                { type: 1, components: [1, 2, 3, 4, 5].map((n) => ({ type: 2, style: n === 5 ? 1 : 2, label: `${n}점`, custom_id: `rv_star:${id}:${n}` })) }
            ]
        }]
    };
}
const thanksPayload = (n) => ({
    components: [{ type: 17, accent_color: COLOR, components: [{ type: 10, content: `### 후기 감사합니다\n${stars(n)}\n-# 후기 채널에 올라갔어요.` }] }]
});

async function sendDue(client) {
    const map = all();
    const now = Date.now();
    for (const [id, r] of Object.entries(map)) {
        if (r.sent || r.due > now) continue;
        r.sent = true; // 실패해도 다시 보내지 않기 (DM 막힌 유저)
        try {
            const user = await client.users.fetch(r.buyerId);
            await user.send(askPayload(id, r));
            console.log(`[후기] ${user.username} 에게 후기 요청 DM 전송`);
        } catch (e) {
            r.failed = true;
            console.log(`[후기] ${r.buyerId} DM 전송 실패 (DM 막힘 등): ${e.message}`);
        }
    }
    save(map);
}

// 후기 채널에 올릴 카드
async function postReview(client, r, n, text) {
    const guild = client.guilds.cache.get(r.guildId);
    const ch = guild && (guild.channels.cache.get(REVIEW_CHANNEL_ID) || await guild.channels.fetch(REVIEW_CHANNEL_ID).catch(() => null));
    if (!ch) throw new Error('후기 채널을 찾을 수 없어요');
    const buyer = await client.users.fetch(r.buyerId).catch(() => null);
    const avatar = buyer ? buyer.displayAvatarURL({ extension: 'png', size: 256 }) : null;
    const body = [
        `### ${stars(n)}`,
        text ? `> ${text.replace(/\n+/g, ' ')}` : null,
        `구매자 <@${r.buyerId}>${r.sellerId ? ` · 판매자 <@${r.sellerId}>` : ''}`,
        `-# ${summary(r)}${r.code ? ` · 구매 ID ${r.code}` : ''}`
    ].filter(Boolean).join('\n');
    const textComp = { type: 10, content: body };
    await ch.send({
        flags: FLAG_V2,
        components: [{
            type: 17,
            accent_color: COLOR,
            components: [avatar ? { type: 9, components: [textComp], accessory: { type: 11, media: { url: avatar } } } : textComp]
        }],
        allowedMentions: { parse: [] }
    });
}

async function handleInteraction(interaction) {
    const cid = interaction.customId || '';
    if (!cid.startsWith('rv_')) return false;
    const [action, id, nStr] = cid.split(':');
    const n = Math.min(5, Math.max(1, parseInt(nStr, 10) || 5));
    const r = all()[id];

    if (!r || r.done) {
        await interaction.reply({ content: r ? '이미 후기를 남기셨어요. 감사합니다!' : '후기 요청 기간이 지났어요.', ephemeral: !!interaction.guild }).catch(() => {});
        return true;
    }
    if (interaction.user.id !== r.buyerId) {
        await interaction.reply({ content: '구매하신 분만 후기를 남길 수 있어요.', ephemeral: true }).catch(() => {});
        return true;
    }

    // 별점 클릭 → 한 줄 후기 입력창 (비워도 됨)
    if (action === 'rv_star') {
        const modal = new ModalBuilder().setCustomId(`rv_modal:${id}:${n}`).setTitle(`${stars(n)} 후기 남기기`).addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('text').setLabel('한 줄 후기 (선택)').setStyle(TextInputStyle.Paragraph)
                    .setRequired(false).setMaxLength(200).setPlaceholder('빠르고 친절했어요!')
            )
        );
        await interaction.showModal(modal);
        return true;
    }

    if (action === 'rv_modal' && interaction.isModalSubmit()) {
        const text = interaction.fields.getTextInputValue('text').trim();
        try {
            await postReview(interaction.client, r, n, text);
            update(id, { done: true, stars: n, text });
            if (interaction.message) await interaction.update(thanksPayload(n));
            else await interaction.reply({ ...thanksPayload(n), flags: FLAG_V2 });
        } catch (e) {
            console.error('[후기] 후기 올리기 실패:', e.message);
            await interaction.reply({ content: '후기를 올리지 못했어요. 잠시 후 다시 눌러주세요.' }).catch(() => {});
        }
        return true;
    }
    return false;
}

let client = null;
function init(c) {
    client = c;
    sendDue(client).catch(() => {});
    setInterval(() => sendDue(client).catch((e) => console.error('[후기] 오류:', e.message)), CHECK_EVERY_MS);
}

module.exports = { init, schedule, handleInteraction };
