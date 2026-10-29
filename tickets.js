// 티켓 기능 (대시보드에서 설정한 내용대로 실제로 동작해요)
// - 패널 메시지 전송/수정, 티켓 열기(양식 모달), 권한 설정, 닫기(대화 기록 저장), 담당하기
// - 설정은 store.js(data.json)에 저장되고, 웹 대시보드(web.js)에서 바꿔요.
 
const crypto = require('crypto');
const {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    ModalBuilder,
    PermissionFlagsBits,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const store = require('./store');
 
const DEFAULT_COLOR = '#7cc4ff';
const STYLES = { Primary: ButtonStyle.Primary, Secondary: ButtonStyle.Secondary, Success: ButtonStyle.Success, Danger: ButtonStyle.Danger };
 
let clientRef = null;
 
// ==================== 설정 기본값 / 검사 ====================
const randomId = () => crypto.randomBytes(5).toString('hex');
 
function defaultPanel() {
    return {
        id: randomId(),
        name: '새 패널',
        channelId: '',
        messageId: '',
        sentChannelId: '',
        embed: {
            title: '티켓 열기',
            description: '문의가 있으시면 아래 버튼을 눌러 티켓을 만들어 주세요.',
            color: DEFAULT_COLOR,
            image: '',
            thumbnail: '',
            footer: '',
        },
        button: { label: '티켓 열기', emoji: '🎫', style: 'Primary' },
        questions: [],
        ticket: {
            categoryId: '',
            nameFormat: 'ticket-{number}',
            maxOpen: 1,
            welcomeTitle: '티켓이 열렸어요',
            welcomeMessage: '{user} 님, 문의 내용을 남겨주세요.\n곧 담당자가 도와드릴게요.',
            mentionSupport: true,
            logChannelId: '',
        },
        perms: {
            supportRoleIds: [],
            viewRoleIds: [],
            ownerCanClose: true,
            ownerAttach: true,
            ownerEmbed: true,
            claimEnabled: true,
        },
    };
}
 
const str = (v, max) => String(v ?? '').slice(0, max);
const bool = (v) => !!v;
const hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : d);
const url = (v) => (/^https?:\/\/\S{3,500}$/.test(String(v || '')) ? String(v) : '');
 
// 대시보드에서 받은 설정을 검사해서 안전한 형태로 만들어요.
// guild: discord.js Guild (채널/역할이 이 서버에 있는지 확인), existing: 저장된 설정
function sanitizeConfig(input, guild, existing) {
    const out = { counter: existing.counter || 0, panels: [] };
    const textChannel = (id) => {
        const c = guild.channels.cache.get(String(id || ''));
        return c && (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) ? c.id : '';
    };
    const category = (id) => {
        const c = guild.channels.cache.get(String(id || ''));
        return c && c.type === ChannelType.GuildCategory ? c.id : '';
    };
    const roles = (arr) =>
        (Array.isArray(arr) ? arr : [])
            .map(String)
            .filter((id) => id !== guild.id && guild.roles.cache.has(id))
            .slice(0, 25);
 
    const list = Array.isArray(input && input.panels) ? input.panels.slice(0, 10) : [];
    const seen = new Set();
    for (const p of list) {
        if (!p || typeof p !== 'object') continue;
        let id = /^[a-z0-9]{6,20}$/.test(String(p.id || '')) ? String(p.id) : randomId();
        if (seen.has(id)) id = randomId();
        seen.add(id);
        const old = existing.panels.find((x) => x.id === id) || {};
        const d = defaultPanel();
        const e = p.embed || {};
        const b = p.button || {};
        const t = p.ticket || {};
        const pm = p.perms || {};
 
        const questions = (Array.isArray(p.questions) ? p.questions : [])
            .slice(0, 5)
            .map((q) => ({
                label: str(q && q.label, 45).trim(),
                placeholder: str(q && q.placeholder, 100),
                required: bool(q && q.required),
                long: bool(q && q.long),
            }))
            .filter((q) => q.label);
 
        const nameFormat = str(t.nameFormat, 40).replace(/[^a-zA-Z0-9가-힣{}\-_ ]/g, '').trim() || d.ticket.nameFormat;
        const maxOpen = Math.min(10, Math.max(1, parseInt(t.maxOpen, 10) || 1));
 
        out.panels.push({
            id,
            name: str(p.name, 40).trim() || '패널',
            channelId: textChannel(p.channelId),
            // 메시지 ID는 서버가 보낸 값만 유지 (사용자가 바꿀 수 없음)
            messageId: old.messageId || '',
            sentChannelId: old.sentChannelId || '',
            embed: {
                title: str(e.title, 256),
                description: str(e.description, 4000),
                color: hex(e.color, DEFAULT_COLOR),
                image: url(e.image),
                thumbnail: url(e.thumbnail),
                footer: str(e.footer, 200),
            },
            button: {
                label: str(b.label, 80).trim() || '티켓 열기',
                emoji: str(b.emoji, 64).trim(),
                style: STYLES[b.style] ? b.style : 'Primary',
            },
            questions,
            ticket: {
                categoryId: category(t.categoryId),
                nameFormat,
                maxOpen,
                welcomeTitle: str(t.welcomeTitle, 200),
                welcomeMessage: str(t.welcomeMessage, 2000),
                mentionSupport: bool(t.mentionSupport),
                logChannelId: textChannel(t.logChannelId),
            },
            perms: {
                supportRoleIds: roles(pm.supportRoleIds),
                viewRoleIds: roles(pm.viewRoleIds),
                ownerCanClose: bool(pm.ownerCanClose),
                ownerAttach: bool(pm.ownerAttach),
                ownerEmbed: bool(pm.ownerEmbed),
                claimEnabled: bool(pm.claimEnabled),
            },
        });
    }
    return out;
}
 
// ==================== 패널 메시지 ====================
function buildPanelMessage(panel) {
    const e = panel.embed;
    const embed = new EmbedBuilder().setColor(parseInt(hex(e.color, DEFAULT_COLOR).slice(1), 16));
    if (e.title) embed.setTitle(e.title);
    if (e.description) embed.setDescription(e.description);
    else if (!e.title) embed.setDescription('아래 버튼을 눌러 티켓을 만들어 주세요.');
    if (e.image) embed.setImage(e.image);
    if (e.thumbnail) embed.setThumbnail(e.thumbnail);
    if (e.footer) embed.setFooter({ text: e.footer });
 
    const btn = new ButtonBuilder()
        .setCustomId(`tk_open:${panel.id}`)
        .setLabel(panel.button.label || '티켓 열기')
        .setStyle(STYLES[panel.button.style] || ButtonStyle.Primary);
    if (panel.button.emoji) {
        try {
            btn.setEmoji(panel.button.emoji);
        } catch (err) {
            /* 이모지가 올바르지 않으면 생략 */
        }
    }
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] };
}
 
// 패널 메시지를 채널에 보내거나(처음) 수정해요(이미 보낸 경우). 보낸 메시지 ID를 돌려줘요.
async function sendPanel(guild, panelId) {
    const cfg = store.getTicketConfig(guild.id);
    const panel = cfg.panels.find((p) => p.id === panelId);
    if (!panel) throw new Error('패널을 찾을 수 없어요. 먼저 저장해 주세요.');
    if (!panel.channelId) throw new Error('패널을 보낼 채널을 선택해 주세요.');
    const channel = guild.channels.cache.get(panel.channelId);
    if (!channel || !channel.isTextBased()) throw new Error('선택한 채널을 찾을 수 없어요.');
 
    const payload = buildPanelMessage(panel);
    let msg = null;
 
    if (panel.messageId && panel.sentChannelId === panel.channelId) {
        msg = await channel.messages.fetch(panel.messageId).catch(() => null);
        if (msg && clientRef && msg.author.id === clientRef.user.id) {
            await msg.edit(payload);
        } else {
            msg = null;
        }
    } else if (panel.messageId && panel.sentChannelId) {
        // 채널을 바꿔서 다시 보내는 경우 예전 메시지는 지워요
        const old = guild.channels.cache.get(panel.sentChannelId);
        if (old && old.isTextBased()) {
            const oldMsg = await old.messages.fetch(panel.messageId).catch(() => null);
            if (oldMsg && clientRef && oldMsg.author.id === clientRef.user.id) await oldMsg.delete().catch(() => {});
        }
    }
 
    let created = false;
    if (!msg) {
        msg = await channel.send(payload);
        created = true;
    }
 
    const fresh = store.getTicketConfig(guild.id);
    const target = fresh.panels.find((p) => p.id === panelId);
    if (target) {
        target.messageId = msg.id;
        target.sentChannelId = channel.id;
        store.saveTicketConfig(guild.id, fresh);
    }
    return { messageId: msg.id, channelId: channel.id, created };
}
 
// ==================== 티켓 열기 ====================
const getPanel = (guildId, panelId) => store.getTicketConfig(guildId).panels.find((p) => p.id === panelId) || null;
 
const fillVars = (text, vars) =>
    String(text || '').replace(/\{(user|username|number|server)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : ''));
 
function channelNameOf(format, vars) {
    const raw = fillVars(format, vars)
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9가-힣\-_]/g, '')
        .replace(/-+/g, '-')
        .slice(0, 90);
    return raw || `ticket-${vars.number}`;
}
 
const isStaff = (member, panel) =>
    !!member &&
    (member.permissions.has(PermissionFlagsBits.ManageChannels) ||
        panel.perms.supportRoleIds.some((id) => member.roles.cache.has(id)));
 
async function createTicket(interaction, panel, answers) {
    const guild = interaction.guild;
    const owner = interaction.user;
 
    const open = store.getOpenTickets(guild.id).filter((t) => t.ownerId === owner.id && t.panelId === panel.id);
    if (open.length >= panel.ticket.maxOpen) {
        return interaction.editReply({ content: `이미 열려 있는 티켓이 있어요: <#${open[0].channelId}>` });
    }
 
    const number = store.nextTicketNumber(guild.id);
    const numStr = String(number).padStart(4, '0');
    const vars = { user: `<@${owner.id}>`, username: owner.username, number: numStr, server: guild.name };
    const name = channelNameOf(panel.ticket.nameFormat, { ...vars, username: owner.username });
 
    const P = PermissionFlagsBits;
    const ownerAllow = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory];
    const ownerDeny = [];
    (panel.perms.ownerAttach ? ownerAllow : ownerDeny).push(P.AttachFiles);
    (panel.perms.ownerEmbed ? ownerAllow : ownerDeny).push(P.EmbedLinks);
 
    const overwrites = [
        { id: guild.id, deny: [P.ViewChannel] },
        { id: owner.id, allow: ownerAllow, deny: ownerDeny },
        {
            id: clientRef.user.id,
            allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels, P.EmbedLinks, P.AttachFiles],
        },
    ];
    for (const id of panel.perms.supportRoleIds) {
        if (guild.roles.cache.has(id)) {
            overwrites.push({
                id,
                allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks],
            });
        }
    }
    for (const id of panel.perms.viewRoleIds) {
        if (guild.roles.cache.has(id) && !panel.perms.supportRoleIds.includes(id)) {
            overwrites.push({ id, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages] });
        }
    }
 
    const parent = panel.ticket.categoryId && guild.channels.cache.has(panel.ticket.categoryId) ? panel.ticket.categoryId : undefined;
 
    let channel;
    try {
        channel = await guild.channels.create({
            name,
            type: ChannelType.GuildText,
            parent,
            topic: `티켓 #${numStr} · 소유자: ${owner.username} (${owner.id})`,
            permissionOverwrites: overwrites,
        });
    } catch (err) {
        console.error('[티켓] 채널 생성 실패:', err);
        return interaction.editReply({ content: '❌ 티켓 채널을 만들지 못했어요. 봇에 "채널 관리" 권한이 있는지 확인해 주세요.' });
    }
 
    store.addTicket({
        guildId: guild.id,
        channelId: channel.id,
        ownerId: owner.id,
        ownerName: owner.username,
        panelId: panel.id,
        panelName: panel.name,
        number,
        ts: Date.now(),
        answers,
    });
 
    const welcome = new EmbedBuilder()
        .setColor(parseInt(hex(panel.embed.color, DEFAULT_COLOR).slice(1), 16))
        .setTitle(fillVars(panel.ticket.welcomeTitle, vars) || `티켓 #${numStr}`)
        .setDescription(fillVars(panel.ticket.welcomeMessage, vars) || `${owner}`)
        .setFooter({ text: `티켓 #${numStr}` });
    for (const a of answers.slice(0, 5)) {
        welcome.addFields({ name: str(a.label, 256), value: str(a.value, 1024) || '-' });
    }
 
    const buttons = [new ButtonBuilder().setCustomId('tk_close').setLabel('티켓 닫기').setStyle(ButtonStyle.Danger)];
    if (panel.perms.claimEnabled) {
        buttons.push(new ButtonBuilder().setCustomId('tk_claim').setLabel('담당하기').setStyle(ButtonStyle.Success));
    }
 
    const mentionRoles = panel.ticket.mentionSupport ? panel.perms.supportRoleIds.filter((id) => guild.roles.cache.has(id)) : [];
    await channel
        .send({
            content: `<@${owner.id}>${mentionRoles.map((id) => ` <@&${id}>`).join('')}`,
            embeds: [welcome],
            components: [new ActionRowBuilder().addComponents(buttons)],
            allowedMentions: { users: [owner.id], roles: mentionRoles },
        })
        .catch((e) => console.error('[티켓] 환영 메시지 전송 실패:', e));
 
    return interaction.editReply({ content: `✅ 티켓이 열렸어요: ${channel}` });
}
 
// ==================== 닫기 / 대화 기록 ====================
const kst = (ts) => {
    const d = new Date(ts + 9 * 60 * 60 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};
 
async function buildTranscript(channel, ticket) {
    const all = [];
    let before;
    for (let i = 0; i < 10; i++) {
        const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
        if (!batch || !batch.size) break;
        all.push(...batch.values());
        before = batch.last().id;
    }
    all.reverse();
    const lines = [
        `티켓 #${String(ticket.number).padStart(4, '0')} 대화 기록`,
        `소유자: ${ticket.ownerName} (${ticket.ownerId})`,
        `열린 시간: ${kst(ticket.ts)} (한국 시간)`,
        '------------------------------------------------------------',
    ];
    for (const m of all) {
        let line = `[${kst(m.createdTimestamp)}] ${m.author.username}: ${m.content || ''}`;
        for (const a of m.attachments.values()) line += ` [첨부: ${a.url}]`;
        if (m.embeds.length && !m.content) line += ' [임베드]';
        lines.push(line);
    }
    return Buffer.from(lines.join('\n'), 'utf8');
}
 
async function closeTicketNow(interaction, ticket, panel) {
    const channel = interaction.channel;
    const closer = interaction.user;
    store.closeTicket(channel.id, closer.id);
 
    await channel.send({ content: '🔒 5초 뒤에 이 티켓 채널이 삭제돼요.' }).catch(() => {});
 
    try {
        const logId = panel && panel.ticket.logChannelId;
        const logCh = logId ? interaction.guild.channels.cache.get(logId) : null;
        if (logCh && logCh.isTextBased()) {
            const buf = await buildTranscript(channel, ticket);
            const numStr = String(ticket.number).padStart(4, '0');
            const embed = new EmbedBuilder()
                .setColor(0x7cc4ff)
                .setTitle(`티켓 #${numStr} 닫힘`)
                .addFields(
                    { name: '소유자', value: `<@${ticket.ownerId}>`, inline: true },
                    { name: '닫은 사람', value: `<@${closer.id}>`, inline: true },
                    { name: '패널', value: ticket.panelName || '-', inline: true },
                    { name: '열린 시간', value: `<t:${Math.floor(ticket.ts / 1000)}:f>`, inline: true },
                    { name: '담당자', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '-', inline: true }
                );
            await logCh.send({
                embeds: [embed],
                files: [new AttachmentBuilder(buf, { name: `ticket-${numStr}.txt` })],
                allowedMentions: { parse: [] },
            });
        }
    } catch (err) {
        console.error('[티켓] 로그 기록 실패:', err);
    }
 
    setTimeout(() => channel.delete('티켓 닫힘').catch((e) => console.error('[티켓] 채널 삭제 실패:', e.message)), 5000);
}
 
// ==================== 상호작용 처리 ====================
// 이 함수가 true를 돌려주면 티켓 관련 상호작용이라 처리가 끝난 거예요.
async function handleInteraction(interaction) {
    try {
        if (interaction.isButton()) {
            const id = interaction.customId;
 
            if (id.startsWith('tk_open:')) {
                const panel = getPanel(interaction.guildId, id.slice('tk_open:'.length));
                if (!panel) {
                    await interaction.reply({ content: '이 패널은 더 이상 사용할 수 없어요.', ephemeral: true });
                    return true;
                }
                const open = store.getOpenTickets(interaction.guildId).filter((t) => t.ownerId === interaction.user.id && t.panelId === panel.id);
                if (open.length >= panel.ticket.maxOpen) {
                    await interaction.reply({ content: `이미 열려 있는 티켓이 있어요: <#${open[0].channelId}>`, ephemeral: true });
                    return true;
                }
                if (panel.questions.length) {
                    const modal = new ModalBuilder().setCustomId(`tk_modal:${panel.id}`).setTitle(str(panel.name, 45) || '티켓 열기');
                    panel.questions.forEach((q, i) => {
                        const input = new TextInputBuilder()
                            .setCustomId(`q${i}`)
                            .setLabel(q.label)
                            .setStyle(q.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
                            .setRequired(q.required)
                            .setMaxLength(q.long ? 1000 : 300);
                        if (q.placeholder) input.setPlaceholder(q.placeholder);
                        modal.addComponents(new ActionRowBuilder().addComponents(input));
                    });
                    await interaction.showModal(modal);
                } else {
                    await interaction.deferReply({ ephemeral: true });
                    await createTicket(interaction, panel, []);
                }
                return true;
            }
 
            if (id === 'tk_close') {
                const ticket = store.findTicket(interaction.channelId);
                if (!ticket || ticket.closed) {
                    await interaction.reply({ content: '이 채널은 열린 티켓이 아니에요.', ephemeral: true });
                    return true;
                }
                const panel = getPanel(interaction.guildId, ticket.panelId);
                const owner = ticket.ownerId === interaction.user.id;
                const staff = isStaff(interaction.member, panel || { perms: { supportRoleIds: [] } });
                if (!(staff || (owner && (!panel || panel.perms.ownerCanClose)))) {
                    await interaction.reply({ content: '티켓을 닫을 권한이 없어요.', ephemeral: true });
                    return true;
                }
                await interaction.reply({
                    content: '정말 이 티켓을 닫을까요? 닫으면 채널이 삭제돼요.',
                    ephemeral: true,
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('tk_close_yes').setLabel('닫기').setStyle(ButtonStyle.Danger),
                            new ButtonBuilder().setCustomId('tk_close_no').setLabel('취소').setStyle(ButtonStyle.Secondary)
                        ),
                    ],
                });
                return true;
            }
 
            if (id === 'tk_close_no') {
                await interaction.update({ content: '취소했어요.', components: [] });
                return true;
            }
 
            if (id === 'tk_close_yes') {
                const ticket = store.findTicket(interaction.channelId);
                if (!ticket || ticket.closed) {
                    await interaction.update({ content: '이미 닫힌 티켓이에요.', components: [] });
                    return true;
                }
                const panel = getPanel(interaction.guildId, ticket.panelId);
                const owner = ticket.ownerId === interaction.user.id;
                const staff = isStaff(interaction.member, panel || { perms: { supportRoleIds: [] } });
                if (!(staff || (owner && (!panel || panel.perms.ownerCanClose)))) {
                    await interaction.update({ content: '티켓을 닫을 권한이 없어요.', components: [] });
                    return true;
                }
                await interaction.update({ content: '티켓을 닫는 중이에요...', components: [] });
                await closeTicketNow(interaction, ticket, panel);
                return true;
            }
 
            if (id === 'tk_claim') {
                const ticket = store.findTicket(interaction.channelId);
                const panel = ticket && getPanel(interaction.guildId, ticket.panelId);
                if (!ticket || ticket.closed || !panel) {
                    await interaction.reply({ content: '이 채널은 열린 티켓이 아니에요.', ephemeral: true });
                    return true;
                }
                if (!isStaff(interaction.member, panel)) {
                    await interaction.reply({ content: '담당자만 누를 수 있어요.', ephemeral: true });
                    return true;
                }
                if (ticket.claimedBy) {
                    await interaction.reply({ content: `이미 <@${ticket.claimedBy}> 님이 담당하고 있어요.`, ephemeral: true, allowedMentions: { parse: [] } });
                    return true;
                }
                store.claimTicket(interaction.channelId, interaction.user.id);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('tk_close').setLabel('티켓 닫기').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('tk_claim').setLabel('담당 완료').setStyle(ButtonStyle.Success).setDisabled(true)
                );
                await interaction.update({ components: [row] });
                await interaction.channel
                    .send({ content: `✅ ${interaction.user} 님이 이 티켓을 담당해요.`, allowedMentions: { parse: [] } })
                    .catch(() => {});
                return true;
            }
        }
 
        if (interaction.isModalSubmit() && interaction.customId.startsWith('tk_modal:')) {
            const panel = getPanel(interaction.guildId, interaction.customId.slice('tk_modal:'.length));
            if (!panel) {
                await interaction.reply({ content: '이 패널은 더 이상 사용할 수 없어요.', ephemeral: true });
                return true;
            }
            await interaction.deferReply({ ephemeral: true });
            const answers = panel.questions.map((q, i) => ({
                label: q.label,
                value: interaction.fields.getTextInputValue(`q${i}`) || '',
            }));
            await createTicket(interaction, panel, answers);
            return true;
        }
    } catch (err) {
        console.error('[티켓] 처리 중 오류:', err);
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: '❌ 처리 중 오류가 났어요. 잠시 후 다시 시도해 주세요.' });
            } else {
                await interaction.reply({ content: '❌ 처리 중 오류가 났어요. 잠시 후 다시 시도해 주세요.', ephemeral: true });
            }
        } catch (_) {}
        return true;
    }
    return false;
}
 
function init(client) {
    clientRef = client;
    // 티켓 채널을 직접 지우면 기록도 닫힌 것으로 처리
    client.on('channelDelete', (channel) => {
        const t = store.findTicket(channel.id);
        if (t && !t.closed) store.closeTicket(channel.id, null);
    });
}
 
module.exports = { init, handleInteraction, sendPanel, sanitizeConfig, defaultPanel, buildPanelMessage };
 
