// ==================== 티켓툴(Ticket Tool) 구매로그 설정 패널 ====================
// 티켓툴이 티켓 채널을 만들고 첫 임베드를 보내면, 그 아래에 "구매로그 설정 패널"을 띄워요.
// - 구매자가 티켓툴 양식에 적은 답변(로블록스 아이디, 수량, 금액 등)을 자동으로 읽어와서 채워 넣어요.
// - 판매자는 [✏️ 정보 수정] 으로 고치고, 판매자/구매자를 선택한 뒤 [✅ 지급완료] 를 누르면
//   /지급완료 명령어와 똑같이 구매로그 카드가 전송되고 통계에 기록돼요.
// - 패널의 값은 패널 임베드 안에 저장되므로 Railway 재배포 후에도 버튼이 그대로 동작해요.

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    UserSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

// ---------- 설정 ----------
const TICKET_TOOL_BOT_IDS = ['557628352828014614']; // 티켓툴 봇 ID (프리미엄/커스텀 봇이면 여기에 추가)
const PANEL_WINDOW_MS = 5 * 60 * 1000;               // 채널이 만들어진 지 5분 안의 티켓툴 메시지에만 패널 생성
const COLLECT_DELAY_MS = 3000;                       // 티켓툴이 양식 답변을 보낼 때까지 잠깐 기다리기
// 채널 이름 / 카테고리 이름에 이 단어가 있으면 패널을 만들지 않아요 (문의 티켓 등)
const SKIP_KEYWORDS = ['문의', '신고', '셀러', '지원', 'support', 'report'];
const PANEL_COLOR = 0xA9D8FF;
const DONE_COLOR = 0x7BD88F;

const KIND_LABEL = { robux: '로벅스 구매', ingame: '인게임 상품 구매', etc: '기타 구매' };
const EMPTY = '—';

// 패널 임베드 필드 이름 (순서 고정 - 이 이름으로 값을 다시 읽어요)
const F = {
    buyer: '🛒 구매자',
    seller: '🧑‍💼 판매자',
    kind: '📦 종류',
    item: '🎁 상품',
    count: '🔢 수량',
    price: '💰 금액',
    roblox: '🎮 로블록스 아이디'
};

let deps = null; // { completePurchase, canUse }
const handled = new Set();     // 패널을 이미 만든 채널
const ttChannels = new Set();  // 티켓툴 티켓 채널 (대화 저장 판단용)
const busy = new Set();        // 지급완료 처리 중인 패널 (중복 클릭 방지)

// ---------- 양식 답변 읽기 ----------
const clean = (v) => String(v || '')
    .replace(/```(?:[a-z]+\n)?/gi, '')
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/^>\s?/gm, '')
    .trim();

// 티켓툴 임베드에서 [질문, 답변] 목록 뽑기 (필드 형식 + 설명란 "**질문**\n```답변```" 형식 둘 다 지원)
function extractQA(embeds) {
    const qa = [];
    for (const e of embeds) {
        for (const f of e.fields || []) {
            const q = clean(f.name), a = clean(f.value);
            if (q && a) qa.push([q, a]);
        }
        const desc = String(e.description || '');
        const re = /\*\*(.+?)\*\*\s*\n\s*```(?:[a-z]*\n)?([\s\S]*?)```/gi;
        let m;
        while ((m = re.exec(desc))) {
            const q = clean(m[1]), a = clean(m[2]);
            if (q && a) qa.push([q, a]);
        }
    }
    return qa;
}

// 질문 내용으로 어떤 항목인지 판단
function matchKey(q) {
    const s = q.toLowerCase().replace(/\s/g, '');
    if (/로블|roblox|닉네임|아이디|username/.test(s)) return 'roblox';
    if (/금액|가격|price|결제/.test(s)) return 'price';
    if (/수량|개수|몇개|갯수|amount|qty|로벅스양/.test(s)) return 'count';
    if (/상품|아이템|품목|게임|item|product/.test(s)) return 'item';
    if (/종류|유형|type/.test(s)) return 'kind';
    return null;
}

function detectKind(text) {
    const s = String(text || '').toLowerCase();
    if (/로벅스|robux|rbx/.test(s)) return 'robux';
    if (/인게임|ingame|in-game|게임\s?상품|게임\s?아이템/.test(s)) return 'ingame';
    if (/기타|etc/.test(s)) return 'etc';
    return null;
}

function parseKindInput(v) {
    return detectKind(v) || (String(v || '').trim() ? 'etc' : null);
}

// ---------- 패널 임베드 <-> 데이터 ----------
function buildPanelEmbed(d, done = null) {
    const show = (v) => (v ? String(v).slice(0, 1000) : EMPTY);
    const e = new EmbedBuilder()
        .setColor(done ? DONE_COLOR : PANEL_COLOR)
        .setTitle(done ? '✅ 구매로그 전송 완료' : '🧾 구매로그 설정 패널')
        .setDescription(done
            ? `구매로그가 전송되었어요. (처리: <@${done.by}>)`
            : '구매자가 양식에 적은 내용을 불러왔어요.\n판매자는 내용을 확인·수정한 뒤 **✅ 지급완료** 를 눌러주세요.\n-# 판매자를 선택하지 않으면 지급완료를 누른 사람이 판매자로 기록돼요.')
        .addFields(
            { name: F.buyer, value: d.buyerId ? `<@${d.buyerId}>` : EMPTY, inline: true },
            { name: F.seller, value: d.sellerId ? `<@${d.sellerId}>` : EMPTY, inline: true },
            { name: F.kind, value: d.kind ? KIND_LABEL[d.kind] : EMPTY, inline: true },
            { name: F.item, value: show(d.item), inline: true },
            { name: F.count, value: show(d.count), inline: true },
            { name: F.price, value: show(d.price), inline: true },
            { name: F.roblox, value: show(d.roblox), inline: false }
        );
    if (done && done.code) e.setFooter({ text: `구매 ID ${done.code}` });
    return e;
}

function readPanel(message) {
    const e = message.embeds[0];
    const get = (name) => {
        const f = e && e.fields.find((x) => x.name === name);
        const v = f ? f.value.trim() : '';
        return v === EMPTY ? '' : v;
    };
    const id = (v) => (v.match(/\d{15,25}/) || [])[0] || null;
    const kindText = get(F.kind);
    return {
        buyerId: id(get(F.buyer)),
        sellerId: id(get(F.seller)),
        kind: Object.keys(KIND_LABEL).find((k) => KIND_LABEL[k] === kindText) || null,
        item: get(F.item),
        count: get(F.count),
        price: get(F.price),
        roblox: get(F.roblox),
        done: !!(e && e.title && e.title.startsWith('✅'))
    };
}

function buildComponents(disabled = false) {
    return [
        new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('ttlog_seller').setPlaceholder('🧑‍💼 판매자 선택').setMinValues(1).setMaxValues(1).setDisabled(disabled)
        ),
        new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('ttlog_buyer').setPlaceholder('🛒 구매자 변경 (자동으로 못 찾았을 때)').setMinValues(1).setMaxValues(1).setDisabled(disabled)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ttlog_edit').setLabel('정보 수정').setEmoji('✏️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
            new ButtonBuilder().setCustomId('ttlog_reload').setLabel('양식 다시 불러오기').setEmoji('🔄').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
            new ButtonBuilder().setCustomId('ttlog_done').setLabel('지급완료').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(disabled)
        )
    ];
}

// ---------- 티켓 채널에서 정보 모으기 ----------
const isTicketToolMsg = (m) => m.author && TICKET_TOOL_BOT_IDS.includes(m.author.id);

async function gatherFromChannel(channel) {
    const msgs = [...(await channel.messages.fetch({ limit: 20 })).values()]
        .filter(isTicketToolMsg)
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const embeds = msgs.flatMap((m) => m.embeds);
    const d = { buyerId: null, sellerId: null, kind: null, item: '', count: '', price: '', roblox: '' };

    for (const [q, a] of extractQA(embeds)) {
        const key = matchKey(q);
        if (!key) continue;
        if (key === 'kind') d.kind = parseKindInput(a);
        else if (!d[key]) d[key] = a.slice(0, 200);
    }

    // 구매자: 티켓툴 첫 메시지에서 멘션된 유저 → 없으면 채널 권한에 추가된 유저
    for (const m of msgs) {
        const u = m.mentions.users.find((x) => !x.bot);
        if (u) { d.buyerId = u.id; break; }
    }
    if (!d.buyerId) {
        const ow = channel.permissionOverwrites.cache.find((o) => o.type === 1 && o.id !== channel.client.user.id && !TICKET_TOOL_BOT_IDS.includes(o.id));
        if (ow) d.buyerId = ow.id;
    }

    // 종류: 양식 답변 → 채널 이름 / 카테고리 이름 / 티켓툴 임베드 내용
    if (!d.kind) {
        const text = [channel.name, channel.parent && channel.parent.name, ...embeds.map((e) => `${e.title || ''} ${e.description || ''}`)].join(' ');
        d.kind = detectKind(text) || 'robux';
    }
    if (d.kind === 'robux' && !d.item) d.item = '로벅스';
    return d;
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
    ttChannels.add(channel.id);

    await new Promise((r) => setTimeout(r, COLLECT_DELAY_MS));
    try {
        // 재시작 직후 등으로 이미 패널이 있으면 다시 만들지 않기
        const recent = await channel.messages.fetch({ limit: 20 });
        if (recent.some((m) => m.author.id === message.client.user.id && m.components.some((r) => r.components.some((c) => c.customId === 'ttlog_done')))) return;

        const d = await gatherFromChannel(channel);
        await channel.send({ embeds: [buildPanelEmbed(d)], components: buildComponents(), allowedMentions: { parse: [] } });
        console.log(`[티켓툴] ${channel.name} 구매로그 패널 생성 (구매자 ${d.buyerId || '없음'})`);
    } catch (e) {
        handled.delete(channel.id);
        console.error('[티켓툴] 구매로그 패널 생성 실패:', e.message);
    }
}

// ---------- 버튼 / 선택 / 양식 처리 ----------
const ephemeral = (content) => ({ content, ephemeral: true });

async function handleInteraction(interaction) {
    const id = interaction.customId || '';
    if (!id.startsWith('ttlog_')) return false;

    if (!deps.canUse(interaction.member)) {
        await interaction.reply(ephemeral('판매자 또는 관리자만 사용할 수 있어요.')).catch(() => {});
        return true;
    }

    const msg = interaction.message;
    const d = readPanel(msg);
    if (d.done) {
        await interaction.reply(ephemeral('이미 지급완료 처리된 패널이에요.')).catch(() => {});
        return true;
    }

    // 판매자 / 구매자 선택
    if (interaction.isUserSelectMenu()) {
        const u = interaction.users.first();
        if (u && u.bot) return interaction.reply(ephemeral('봇은 선택할 수 없어요.')).then(() => true);
        if (id === 'ttlog_seller') d.sellerId = u.id;
        if (id === 'ttlog_buyer') d.buyerId = u.id;
        await interaction.update({ embeds: [buildPanelEmbed(d)], components: buildComponents(), allowedMentions: { parse: [] } });
        return true;
    }

    // 양식 다시 불러오기
    if (id === 'ttlog_reload') {
        await interaction.deferUpdate();
        const fresh = await gatherFromChannel(interaction.channel);
        fresh.sellerId = d.sellerId;
        await msg.edit({ embeds: [buildPanelEmbed(fresh)], components: buildComponents(), allowedMentions: { parse: [] } });
        return true;
    }

    // 정보 수정 (양식)
    if (id === 'ttlog_edit') {
        const input = (cid, label, value, placeholder, required = true) => {
            const t = new TextInputBuilder().setCustomId(cid).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(200);
            if (placeholder) t.setPlaceholder(placeholder);
            if (value) t.setValue(String(value).slice(0, 200));
            return new ActionRowBuilder().addComponents(t);
        };
        const kindWord = { robux: '로벅스', ingame: '인게임', etc: '기타' }[d.kind] || '';
        const modal = new ModalBuilder().setCustomId('ttlog_modal').setTitle('구매로그 정보 수정').addComponents(
            input('kind', '종류 (로벅스 / 인게임 / 기타)', kindWord, '로벅스'),
            input('item', '상품', d.item, '로벅스는 "로벅스"'),
            input('count', '수량 (로벅스는 로벅스 수량)', d.count, '1000'),
            input('price', '금액', d.price, '10000원'),
            input('roblox', '로블록스 아이디 (없으면 X)', d.roblox, 'X')
        );
        await interaction.showModal(modal);
        return true;
    }

    if (id === 'ttlog_modal' && interaction.isModalSubmit()) {
        const v = (k) => interaction.fields.getTextInputValue(k).trim();
        d.kind = parseKindInput(v('kind')) || d.kind;
        d.item = v('item');
        d.count = v('count');
        d.price = v('price');
        d.roblox = v('roblox');
        await interaction.update({ embeds: [buildPanelEmbed(d)], components: buildComponents(), allowedMentions: { parse: [] } });
        return true;
    }

    // 지급완료
    if (id === 'ttlog_done') {
        const missing = [
            !d.buyerId && '구매자', !d.kind && '종류', !d.item && '상품',
            !d.count && '수량', !d.price && '금액', !d.roblox && '로블록스 아이디(없으면 X)'
        ].filter(Boolean);
        if (missing.length) {
            await interaction.reply(ephemeral(`❌ 아직 비어 있는 항목이 있어요: **${missing.join(', ')}**\n✏️ 정보 수정 / 구매자 변경으로 채워주세요.`));
            return true;
        }
        if (busy.has(msg.id)) {
            await interaction.reply(ephemeral('지금 처리 중이에요. 잠시만 기다려 주세요.'));
            return true;
        }
        busy.add(msg.id);
        await interaction.reply(ephemeral('지급완료를 처리 중입니다.'));
        try {
            const client = interaction.client;
            const buyer = await client.users.fetch(d.buyerId);
            const seller = d.sellerId ? await client.users.fetch(d.sellerId) : interaction.user;

            const res = await deps.completePurchase({
                guild: interaction.guild,
                channel: interaction.channel,
                buyer,
                kind: d.kind,
                item: d.item,
                count: d.count,
                price: d.price,
                robloxInput: d.roblox,
                seller
            });
            if (!res.ok) {
                await interaction.editReply({ content: res.error });
                return true;
            }

            if (!d.sellerId) d.sellerId = seller.id;
            const code = res.purchaseId ? deps.purchaseCode(res.purchaseId) : null;
            await msg.edit({ embeds: [buildPanelEmbed(d, { by: interaction.user.id, code })], components: buildComponents(true), allowedMentions: { parse: [] } });
            for (const w of res.warns) interaction.followUp(ephemeral(w)).catch(() => {});
            await interaction.editReply({ content: '✅ 지급완료 처리가 완료되었습니다.' }).catch(() => {});
        } catch (e) {
            console.error('[티켓툴] 지급완료 처리 실패:', e);
            await interaction.editReply({ content: '❌ 처리 중 오류가 났어요. 잠시 후 다시 시도하거나 /지급완료 명령어를 사용해 주세요.' }).catch(() => {});
        } finally {
            busy.delete(msg.id);
        }
        return true;
    }

    return false;
}

function init(client, d) {
    deps = d;
    client.on('messageCreate', (message) => {
        if (isTicketToolMsg(message)) onTicketToolMessage(message).catch((e) => console.error('[티켓툴] 오류:', e.message));
    });
    client.on('channelDelete', (ch) => { handled.delete(ch.id); ttChannels.delete(ch.id); });
}

const isTicketToolChannel = (channelId) => ttChannels.has(channelId);

module.exports = { init, handleInteraction, isTicketToolChannel };
