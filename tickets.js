// 티켓 기능 (티켓툴 방식) - 대시보드에서 설정한 내용대로 실제로 동작해요.
//
// 흐름
//   패널(버튼 또는 선택기) -> (양식 창) -> 티켓 채널 생성 + 초록 "티켓 열림" 임베드 + 양식 답변 임베드 + 🔒 닫기 버튼
//   🔒 닫기 / !close  -> 정해둔 "닫힌 티켓 카테고리"로 이동 + 채널 이름이 closed-번호 로 바뀜
//                        (🔓 다시 열기 / 🗑 삭제 / 📄 기록 버튼이 나와요)
//   🔓 다시 열기 / !open -> 원래 카테고리로 돌아오고 이름이 ticket-번호 로 돌아옴 + 초록 임베드
//   🗑 삭제 / !delete  -> 빨간 임베드 "N초 후 삭제됩니다" 후 채널 삭제 (기록은 로그 채널에 남아요)
// 설정은 store.js(data.json)에 저장되고, 웹 대시보드(web.js)에서 바꿔요.
 
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
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const store = require('./store');
 
const DEFAULT_COLOR = '#7cc4ff';
const GREEN = 0x2ecc71;
const RED = 0xed4245;
const AMBER = 0xf0b232;
const STYLES = { Primary: ButtonStyle.Primary, Secondary: ButtonStyle.Secondary, Success: ButtonStyle.Success, Danger: ButtonStyle.Danger };
 
let clientRef = null;
 
// 티켓 소유자에게 줄 수 있는 채널 권한 (디스코드 채널 권한의 멤버 권한과 같아요)
// 값: 'allow' 허용 / 'deny' 거부 / 'default' 기본값(@everyone 설정을 따라요)
const OWNER_PERM_KEYS = [
    'ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads',
    'EmbedLinks', 'AttachFiles', 'AddReactions', 'UseExternalEmojis', 'UseExternalStickers',
    'MentionEveryone', 'ReadMessageHistory', 'SendTTSMessages', 'UseApplicationCommands', 'SendVoiceMessages', 'SendPolls',
];
const defaultOwnerPerms = () => {
    const o = {};
    for (const k of OWNER_PERM_KEYS) o[k] = 'default';
    for (const k of ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'EmbedLinks']) o[k] = 'allow';
    return o;
};
const cleanOwnerPerms = (input) => {
    const out = defaultOwnerPerms();
    for (const k of OWNER_PERM_KEYS) {
        const v = input && input[k];
        if (v === 'allow' || v === 'deny' || v === 'default') out[k] = v;
    }
    out.ViewChannel = 'allow'; // 소유자가 자기 티켓을 못 보면 안 되니까 항상 허용
    return out;
};
 
// ==================== 설정 기본값 / 검사 ====================
const randomId = () => crypto.randomBytes(5).toString('hex');
 
function defaultSettings() {
    return {
        supportRoleIds: [], // 모든 패널에 공통으로 적용되는 담당자(서포트 팀) 역할
        closedCategoryId: '', // 닫힌 티켓이 옮겨질 카테고리
        closedNameFormat: 'closed-{number}',
        padding: 4, // 티켓 번호 자릿수 (4 -> 0001)
        deleteDelay: 5, // 삭제 전 대기(초)
        twoStepClose: false, // 닫기 전에 한 번 더 확인
        autoPin: false, // 환영 메시지 고정
        commandsEnabled: true, // !close / !open / !delete
        prefix: '!',
        logChannelId: '',
        messages: {
            openedReply: '티켓을 열었어요: {channel}',
            openedDescription: '{user} 님이 티켓을 열었어요.',
            closeTitle: '티켓이 닫혔어요',
            closeDescription: '{closer} 님이 티켓을 닫았어요.\n{reason}아래 버튼으로 다시 열거나 삭제할 수 있어요.',
            reopenDescription: '{user} 님이 티켓을 다시 열었어요.',
            deleteDescription: '이 티켓은 {seconds}초 후 삭제됩니다.',
        },
    };
}
 
function defaultPanel() {
    return {
        id: randomId(),
        name: '새 패널',
        channelId: '',
        messageId: '',
        sentChannelId: '',
        mode: 'button', // 'button' | 'select'(선택기)
        embed: {
            title: '티켓 열기',
            description: '문의가 있으시면 아래 버튼을 눌러 티켓을 만들어 주세요.',
            color: DEFAULT_COLOR,
            image: '',
            thumbnail: '',
            footer: '',
        },
        button: { label: '티켓 열기', emoji: '🎫', style: 'Primary' },
        select: { placeholder: '문의 종류를 선택해 주세요' },
        options: [],
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
            ownerPerms: defaultOwnerPerms(),
        },
    };
}
 
const str = (v, max) => String(v ?? '').slice(0, max);
const bool = (v) => !!v;
const hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : d);
const url = (v) => (/^https?:\/\/\S{3,500}$/.test(String(v || '')) ? String(v) : '');
const fmt = (v, d) => str(v, 40).replace(/[^a-zA-Z0-9가-힣{}\-_ ]/g, '').trim() || d;
 
function sanitizeQuestions(arr) {
    return (Array.isArray(arr) ? arr : [])
        .slice(0, 5)
        .map((q) => ({
            label: str(q && q.label, 45).trim(),
            placeholder: str(q && q.placeholder, 100),
            required: bool(q && q.required),
            long: bool(q && q.long),
        }))
        .filter((q) => q.label);
}
 
// 대시보드에서 받은 설정을 검사해서 안전한 형태로 만들어요.
// guild: discord.js Guild (채널/역할이 이 서버에 있는지 확인), existing: 저장된 설정
function sanitizeConfig(input, guild, existing) {
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
 
    const ds = defaultSettings();
    const inp = (input && input.settings) || {};
    const im = inp.messages || {};
    const settings = {
        supportRoleIds: roles(inp.supportRoleIds),
        closedCategoryId: category(inp.closedCategoryId),
        closedNameFormat: fmt(inp.closedNameFormat, ds.closedNameFormat),
        padding: Math.min(6, Math.max(0, Number.isFinite(parseInt(inp.padding, 10)) ? parseInt(inp.padding, 10) : 4)),
        deleteDelay: Math.min(60, Math.max(1, parseInt(inp.deleteDelay, 10) || 5)),
        twoStepClose: bool(inp.twoStepClose),
        autoPin: bool(inp.autoPin),
        commandsEnabled: inp.commandsEnabled === undefined ? true : bool(inp.commandsEnabled),
        prefix: str(inp.prefix, 3).trim().replace(/\s/g, '') || '!',
        logChannelId: textChannel(inp.logChannelId),
        messages: {},
    };
    for (const k of Object.keys(ds.messages)) {
        const v = str(im[k], 1500);
        settings.messages[k] = v.trim() ? v : ds.messages[k];
    }
 
    const out = { counter: existing.counter || 0, settings, panels: [] };
    const list = Array.isArray(input && input.panels) ? input.panels.slice(0, 10) : [];
    const seen = new Set();
    for (const p of list) {
        if (!p || typeof p !== 'object') continue;
        let id = /^[a-z0-9]{6,20}$/.test(String(p.id || '')) ? String(p.id) : randomId();
        if (seen.has(id)) id = randomId();
        seen.add(id);
        const old = (existing.panels || []).find((x) => x.id === id) || {};
        const d = defaultPanel();
        const e = p.embed || {};
        const b = p.button || {};
        const t = p.ticket || {};
        const pm = p.perms || {};
        const sel = p.select || {};
 
        const optSeen = new Set();
        const options = (Array.isArray(p.options) ? p.options : [])
            .slice(0, 25)
            .map((o) => {
                let oid = /^[a-z0-9]{6,20}$/.test(String(o && o.id)) ? String(o.id) : randomId();
                if (optSeen.has(oid)) oid = randomId();
                optSeen.add(oid);
                return {
                    id: oid,
                    label: str(o && o.label, 100).trim(),
                    description: str(o && o.description, 100).trim(),
                    emoji: str(o && o.emoji, 64).trim(),
                    categoryId: category(o && o.categoryId),
                    nameFormat: str(o && o.nameFormat, 40).trim() ? fmt(o.nameFormat, '') : '',
                    welcomeTitle: str(o && o.welcomeTitle, 200),
                    welcomeMessage: str(o && o.welcomeMessage, 2000),
                    supportRoleIds: roles(o && o.supportRoleIds),
                    questions: sanitizeQuestions(o && o.questions),
                };
            })
            .filter((o) => o.label);
 
        out.panels.push({
            id,
            name: str(p.name, 40).trim() || '패널',
            channelId: textChannel(p.channelId),
            // 메시지 ID는 서버가 보낸 값만 유지 (사용자가 바꿀 수 없음)
            messageId: old.messageId || '',
            sentChannelId: old.sentChannelId || '',
            mode: p.mode === 'select' ? 'select' : 'button',
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
            select: { placeholder: str(sel.placeholder, 150).trim() || d.select.placeholder },
            options,
            questions: sanitizeQuestions(p.questions),
            ticket: {
                categoryId: category(t.categoryId),
                nameFormat: fmt(t.nameFormat, d.ticket.nameFormat),
                maxOpen: Math.min(10, Math.max(1, parseInt(t.maxOpen, 10) || 1)),
                welcomeTitle: str(t.welcomeTitle, 200),
                welcomeMessage: str(t.welcomeMessage, 2000),
                mentionSupport: bool(t.mentionSupport),
                logChannelId: textChannel(t.logChannelId),
            },
            perms: {
                supportRoleIds: roles(pm.supportRoleIds),
                viewRoleIds: roles(pm.viewRoleIds),
                ownerCanClose: bool(pm.ownerCanClose),
                ownerPerms: cleanOwnerPerms(pm.ownerPerms),
            },
        });
    }
    return out;
}
 
// 예전 버전(파일 첨부/링크 미리보기 스위치)에서 저장한 값을 새 권한 표로 옮겨요
function migratePerms(perms) {
    const op = cleanOwnerPerms(perms.ownerPerms);
    if (!perms.ownerPerms) {
        if (perms.ownerAttach === false) op.AttachFiles = 'deny';
        if (perms.ownerEmbed === false) op.EmbedLinks = 'deny';
    }
    return { ...perms, ownerPerms: op };
}
 
// 저장된 설정을 읽을 때 빠진 값을 기본값으로 채워요 (예전 버전에서 저장한 설정 호환)
function loadConfig(guildId) {
    const cfg = store.getTicketConfig(guildId);
    const ds = defaultSettings();
    cfg.settings = { ...ds, ...(cfg.settings || {}), messages: { ...ds.messages, ...((cfg.settings && cfg.settings.messages) || {}) } };
    cfg.panels = (cfg.panels || []).map((p) => {
        const d = defaultPanel();
        return {
            ...d,
            ...p,
            embed: { ...d.embed, ...(p.embed || {}) },
            button: { ...d.button, ...(p.button || {}) },
            select: { ...d.select, ...(p.select || {}) },
            options: (p.options || []).map((o) => ({ nameFormat: '', welcomeTitle: '', welcomeMessage: '', supportRoleIds: [], questions: [], ...o })),
            questions: p.questions || [],
            ticket: { ...d.ticket, ...(p.ticket || {}) },
            perms: migratePerms({ ...d.perms, ...(p.perms || {}) }),
        };
    });
    return cfg;
}
 
// ==================== 패널 메시지 ====================
function buildPanelMessage(panel) {
    const e = panel.embed;
    const embed = new EmbedBuilder().setColor(parseInt(hex(e.color, DEFAULT_COLOR).slice(1), 16));
    if (e.title) embed.setTitle(e.title);
    if (e.description) embed.setDescription(e.description);
    else if (!e.title) embed.setDescription('아래에서 티켓을 만들어 주세요.');
    if (e.image) embed.setImage(e.image);
    if (e.thumbnail) embed.setThumbnail(e.thumbnail);
    if (e.footer) embed.setFooter({ text: e.footer });
 
    if (panel.mode === 'select') {
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`tk_sel:${panel.id}`)
            .setPlaceholder(panel.select.placeholder || '문의 종류를 선택해 주세요')
            .setMinValues(1)
            .setMaxValues(1);
        for (const o of panel.options.slice(0, 25)) {
            const opt = new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.id);
            if (o.description) opt.setDescription(o.description);
            if (o.emoji) {
                try {
                    opt.setEmoji(o.emoji);
                } catch (err) {
                    /* 이모지가 올바르지 않으면 생략 */
                }
            }
            menu.addOptions(opt);
        }
        return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
    }
 
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
    const cfg = loadConfig(guild.id);
    const panel = cfg.panels.find((p) => p.id === panelId);
    if (!panel) throw new Error('패널을 찾을 수 없어요. 먼저 저장해 주세요.');
    if (!panel.channelId) throw new Error('패널을 보낼 채널을 선택해 주세요.');
    if (panel.mode === 'select' && !panel.options.length) throw new Error('선택기에 항목을 한 개 이상 추가해 주세요.');
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
    const target = (fresh.panels || []).find((p) => p.id === panelId);
    if (target) {
        target.messageId = msg.id;
        target.sentChannelId = channel.id;
        store.saveTicketConfig(guild.id, fresh);
    }
    return { messageId: msg.id, channelId: channel.id, created };
}
 
// ==================== 공통 도구 ====================
const getPanel = (cfg, panelId) => cfg.panels.find((p) => p.id === panelId) || null;
 
const fillVars = (text, vars) =>
    String(text || '').replace(/\{(user|username|number|count|server|type|closer|channel|seconds|reason)\}/g, (_, k) =>
        vars[k] !== undefined ? vars[k] : ''
    );
 
function channelNameOf(format, vars, fallback) {
    const raw = fillVars(format, vars)
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9가-힣\-_]/g, '')
        .replace(/-+/g, '-')
        .slice(0, 90);
    return raw || fallback;
}
 
const padNum = (n, padding) => (padding > 0 ? String(n).padStart(padding, '0') : String(n));
 
const isStaff = (member, panel, settings) =>
    !!member &&
    (member.permissions.has(PermissionFlagsBits.Administrator) ||
        member.permissions.has(PermissionFlagsBits.ManageChannels) ||
        [...((panel && panel.perms && panel.perms.supportRoleIds) || []), ...((settings && settings.supportRoleIds) || [])].some((id) =>
            member.roles.cache.has(id)
        ));
 
const canCloseOrReopen = (member, ticket, panel, settings) =>
    isStaff(member, panel, settings) || (ticket.ownerId === member.id && (!panel || panel.perms.ownerCanClose));
 
const kst = (ts) => {
    const d = new Date(ts + 9 * 60 * 60 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};
 
// 느린 작업(채널 이름 변경은 디스코드에서 10분에 2번만 가능)이 길어져도 흐름이 멈추지 않게 해요.
async function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), ms);
    });
    try {
        const r = await Promise.race([promise.then((v) => ({ value: v })), timeout]);
        return r;
    } finally {
        clearTimeout(timer);
    }
}
 
async function buildTranscript(channel, ticket, padding) {
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
        `티켓 #${padNum(ticket.number, padding)} 대화 기록`,
        `소유자: ${ticket.ownerName} (${ticket.ownerId})`,
        `열린 시간: ${kst(ticket.ts)} (한국 시간)`,
        '------------------------------------------------------------',
    ];
    for (const m of all) {
        let line = `[${kst(m.createdTimestamp)}] ${m.author.username}: ${m.content || ''}`;
        for (const a of m.attachments.values()) line += ` [첨부: ${a.url}]`;
        if (m.embeds.length) {
            const t = m.embeds.map((e) => [e.title, e.description].filter(Boolean).join(' - ')).filter(Boolean).join(' | ');
            line += t ? ` [임베드: ${t.slice(0, 300)}]` : ' [임베드]';
        }
        lines.push(line);
    }
    return Buffer.from(lines.join('\n'), 'utf8');
}
 
async function sendLog(guild, panel, settings, ticket, title, color, extraFields, withTranscript, channel) {
    try {
        const logId = (panel && panel.ticket.logChannelId) || settings.logChannelId;
        const logCh = logId ? guild.channels.cache.get(logId) : null;
        if (!logCh || !logCh.isTextBased()) return;
        const numStr = padNum(ticket.number, settings.padding);
        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`티켓 #${numStr} ${title}`)
            .addFields(
                { name: '소유자', value: `<@${ticket.ownerId}>`, inline: true },
                { name: '패널', value: ticket.panelName || '-', inline: true },
                { name: '열린 시간', value: `<t:${Math.floor(ticket.ts / 1000)}:f>`, inline: true },
                ...extraFields
            );
        const payload = { embeds: [embed], allowedMentions: { parse: [] } };
        if (withTranscript && channel) {
            const buf = await buildTranscript(channel, ticket, settings.padding);
            payload.files = [new AttachmentBuilder(buf, { name: `ticket-${numStr}.txt` })];
        }
        await logCh.send(payload);
    } catch (err) {
        console.error('[티켓] 로그 기록 실패:', err);
    }
}
 
// ==================== 티켓 열기 ====================
const questionsFor = (panel, optId) => {
    const opt = panel.mode === 'select' ? panel.options.find((o) => o.id === optId) : null;
    return opt && opt.questions.length ? opt.questions : panel.questions;
};
 
async function createTicket(interaction, cfg, panel, opt, answers) {
    const guild = interaction.guild;
    const owner = interaction.user;
    const settings = cfg.settings;
 
    const open = store.getOpenTickets(guild.id).filter((t) => t.ownerId === owner.id && t.panelId === panel.id);
    if (open.length >= panel.ticket.maxOpen) {
        return interaction.editReply({ content: `이미 열려 있는 티켓이 있어요: <#${open[0].channelId}>` });
    }
 
    const number = store.nextTicketNumber(guild.id);
    const numStr = padNum(number, settings.padding);
    const typeName = opt ? opt.label : panel.name;
    const vars = { user: `<@${owner.id}>`, username: owner.username, number: numStr, count: numStr, server: guild.name, type: typeName };
    const name = channelNameOf((opt && opt.nameFormat) || panel.ticket.nameFormat, vars, `ticket-${numStr}`);
 
    const P = PermissionFlagsBits;
    const ownerAllow = [];
    const ownerDeny = [];
    for (const [k, v] of Object.entries(panel.perms.ownerPerms)) {
        if (P[k] === undefined) continue;
        if (v === 'allow') ownerAllow.push(P[k]);
        else if (v === 'deny') ownerDeny.push(P[k]);
    }
 
    const supportIds = [...new Set([...panel.perms.supportRoleIds, ...settings.supportRoleIds, ...((opt && opt.supportRoleIds) || [])])].filter((id) => guild.roles.cache.has(id));
    const overwrites = [
        { id: guild.id, deny: [P.ViewChannel] },
        { id: owner.id, allow: ownerAllow, deny: ownerDeny },
        {
            id: clientRef.user.id,
            allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels, P.ManageMessages, P.EmbedLinks, P.AttachFiles],
        },
    ];
    for (const id of supportIds) {
        overwrites.push({ id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks] });
    }
    for (const id of panel.perms.viewRoleIds) {
        if (guild.roles.cache.has(id) && !supportIds.includes(id)) {
            overwrites.push({ id, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages] });
        }
    }
 
    const catId = (opt && opt.categoryId) || panel.ticket.categoryId;
    const parent = catId && guild.channels.cache.has(catId) ? catId : undefined;
 
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
        optionId: opt ? opt.id : null,
        optionLabel: opt ? opt.label : null,
        number,
        ts: Date.now(),
        answers,
    });
 
    // 1) 초록 "티켓 열림" 임베드
    const opened = new EmbedBuilder()
        .setColor(GREEN)
        .setDescription(fillVars(settings.messages.openedDescription, vars) || `<@${owner.id}> 님이 티켓을 열었어요.`)
        .setFooter({ text: `티켓 #${numStr}${opt ? ` · ${opt.label}` : ''}` });
 
    // 2) 환영 임베드 + 양식 답변
    const welcome = new EmbedBuilder()
        .setColor(parseInt(hex(panel.embed.color, DEFAULT_COLOR).slice(1), 16))
        .setTitle(fillVars((opt && opt.welcomeTitle) || panel.ticket.welcomeTitle, vars) || `티켓 #${numStr}`)
        .setDescription(fillVars((opt && opt.welcomeMessage) || panel.ticket.welcomeMessage, vars) || `<@${owner.id}>`);
    for (const a of answers.slice(0, 5)) {
        welcome.addFields({ name: str(a.label, 256), value: str(a.value, 1024) || '-' });
    }
 
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tk_close').setLabel('닫기').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
    );
 
    const mentionRoles = panel.ticket.mentionSupport ? supportIds : [];
    const sent = await channel
        .send({
            content: `<@${owner.id}>${mentionRoles.map((id) => ` <@&${id}>`).join('')}`,
            embeds: [opened, welcome],
            components: [row],
            allowedMentions: { users: [owner.id], roles: mentionRoles },
        })
        .catch((e) => {
            console.error('[티켓] 환영 메시지 전송 실패:', e);
            return null;
        });
    if (sent && settings.autoPin) sent.pin().catch(() => {});
 
    const reply = new EmbedBuilder()
        .setColor(GREEN)
        .setDescription(fillVars(settings.messages.openedReply, { ...vars, channel: `<#${channel.id}>` }) || `<#${channel.id}>`);
    return interaction.editReply({ content: '', embeds: [reply] });
}
 
// ==================== 닫기 / 다시 열기 / 삭제 ====================
const closedButtons = () =>
    new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tk_reopen').setLabel('다시 열기').setEmoji('🔓').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('tk_transcript').setLabel('기록').setEmoji('📄').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tk_delete').setLabel('삭제').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
    );
 
async function doClose({ guild, channel, ticket, panel, cfg, closer, reason }) {
    const settings = cfg.settings;
    store.closeTicket(channel.id, closer.id);
    const numStr = padNum(ticket.number, settings.padding);
    const vars = {
        user: `<@${ticket.ownerId}>`,
        username: ticket.ownerName,
        number: numStr,
        count: numStr,
        server: guild.name,
        type: ticket.optionLabel || ticket.panelName || '',
    };
 
    // 채널 이동 + 이름 변경 (한 번에)
    const edit = { name: channelNameOf(settings.closedNameFormat, vars, `closed-${numStr}`), lockPermissions: false };
    if (settings.closedCategoryId && guild.channels.cache.has(settings.closedCategoryId)) edit.parent = settings.closedCategoryId;
    const r = await withTimeout(channel.edit(edit).catch((e) => console.error('[티켓] 채널 이동/이름 변경 실패:', e.message)), 10000);
 
    // 소유자는 볼 수만 있고 글은 못 쓰게
    await channel.permissionOverwrites.edit(ticket.ownerId, { SendMessages: false }).catch(() => {});
 
    const why = reason ? `사유: ${str(reason, 300)}\n` : '';
    const embed = new EmbedBuilder()
        .setColor(AMBER)
        .setTitle(fillVars(settings.messages.closeTitle, vars) || '티켓이 닫혔어요')
        .setDescription(fillVars(settings.messages.closeDescription, { ...vars, closer: `<@${closer.id}>`, reason: why }))
        .setFooter({ text: `티켓 #${numStr}` });
    if (r.timedOut) embed.addFields({ name: '알림', value: '채널 이름 변경은 디스코드 제한 때문에 조금 늦게 적용될 수 있어요.' });
    await channel.send({ embeds: [embed], components: [closedButtons()], allowedMentions: { parse: [] } }).catch(() => {});
 
    await sendLog(
        guild,
        panel,
        settings,
        ticket,
        '닫힘',
        AMBER,
        [{ name: '닫은 사람', value: `<@${closer.id}>`, inline: true }, ...(reason ? [{ name: '사유', value: str(reason, 300) }] : [])],
        true,
        channel
    );
}
 
async function doReopen({ guild, channel, ticket, panel, cfg, user }) {
    const settings = cfg.settings;
    store.reopenTicket(channel.id);
    const numStr = padNum(ticket.number, settings.padding);
    const typeName = ticket.optionLabel || ticket.panelName || '';
    const vars = { user: `<@${ticket.ownerId}>`, username: ticket.ownerName, number: numStr, count: numStr, server: guild.name, type: typeName };
 
    const opt0 = panel && ticket.optionId ? panel.options.find((o) => o.id === ticket.optionId) : null;
    const edit = {
        name: channelNameOf((opt0 && opt0.nameFormat) || (panel ? panel.ticket.nameFormat : 'ticket-{number}'), vars, `ticket-${numStr}`),
        lockPermissions: false,
    };
    const opt = panel && ticket.optionId ? panel.options.find((o) => o.id === ticket.optionId) : null;
    const catId = (opt && opt.categoryId) || (panel && panel.ticket.categoryId);
    if (catId && guild.channels.cache.has(catId)) edit.parent = catId;
    const r = await withTimeout(channel.edit(edit).catch((e) => console.error('[티켓] 채널 이동/이름 변경 실패:', e.message)), 10000);
    const sendAllowed = !(panel && panel.perms.ownerPerms.SendMessages === 'deny');
    await channel.permissionOverwrites.edit(ticket.ownerId, { SendMessages: sendAllowed }).catch(() => {});
 
    const embed = new EmbedBuilder()
        .setColor(GREEN)
        .setDescription(fillVars(settings.messages.reopenDescription, vars) || `<@${ticket.ownerId}> 님이 티켓을 다시 열었어요.`)
        .setFooter({ text: `티켓 #${numStr}` });
    if (r.timedOut) embed.addFields({ name: '알림', value: '채널 이름 변경은 디스코드 제한 때문에 조금 늦게 적용될 수 있어요.' });
    await channel
        .send({
            content: `<@${ticket.ownerId}>`,
            embeds: [embed],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('tk_close').setLabel('닫기').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
                ),
            ],
            allowedMentions: { users: [ticket.ownerId] },
        })
        .catch(() => {});
 
    await sendLog(guild, panel, settings, ticket, '다시 열림', GREEN, [{ name: '연 사람', value: `<@${user.id}>`, inline: true }], false, null);
}
 
async function doDelete({ guild, channel, ticket, panel, cfg, user }) {
    const settings = cfg.settings;
    store.markTicketDeleted(channel.id, user.id);
    const secs = settings.deleteDelay;
    const embed = new EmbedBuilder()
        .setColor(RED)
        .setDescription(fillVars(settings.messages.deleteDescription, { seconds: String(secs), user: `<@${ticket.ownerId}>`, closer: `<@${user.id}>` }));
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
 
    await sendLog(guild, panel, settings, ticket, '삭제됨', RED, [{ name: '삭제한 사람', value: `<@${user.id}>`, inline: true }], true, channel);
    setTimeout(() => channel.delete('티켓 삭제').catch((e) => console.error('[티켓] 채널 삭제 실패:', e.message)), secs * 1000);
}
 
// ==================== !close / !open / !delete ====================
const CMD_CLOSE = new Set(['close', '닫기']);
const CMD_OPEN = new Set(['open', 'reopen', '열기']);
const CMD_DELETE = new Set(['delete', 'del', '삭제']);
 
// true를 돌려주면 티켓 명령어로 처리한 거예요.
async function handleMessage(message) {
    if (!message.guild || message.author.bot || !message.content) return false;
    const ticket = store.findTicket(message.channelId);
    if (!ticket || ticket.deleted) return false;
 
    const cfg = loadConfig(message.guild.id);
    const settings = cfg.settings;
    if (!settings.commandsEnabled) return false;
    const text = message.content.trim();
    if (!text.startsWith(settings.prefix)) return false;
    const [head, ...rest] = text.slice(settings.prefix.length).split(/\s+/);
    const cmd = String(head || '').toLowerCase();
    const isClose = CMD_CLOSE.has(cmd);
    const isOpen = CMD_OPEN.has(cmd);
    const isDelete = CMD_DELETE.has(cmd);
    if (!isClose && !isOpen && !isDelete) return false;
 
    const panel = getPanel(cfg, ticket.panelId);
    const member = message.member || (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (!member) return true;
    const ctx = { guild: message.guild, channel: message.channel, ticket, panel, cfg };
 
    try {
        if (isDelete) {
            if (!isStaff(member, panel, settings)) {
                await message.reply({ content: '티켓 삭제는 담당자만 할 수 있어요.', allowedMentions: { repliedUser: false } });
                return true;
            }
            await doDelete({ ...ctx, user: message.author });
        } else if (isClose) {
            if (ticket.closed) {
                await message.reply({ content: '이미 닫힌 티켓이에요.', allowedMentions: { repliedUser: false } });
                return true;
            }
            if (!canCloseOrReopen(member, ticket, panel, settings)) {
                await message.reply({ content: '티켓을 닫을 권한이 없어요.', allowedMentions: { repliedUser: false } });
                return true;
            }
            await doClose({ ...ctx, closer: message.author, reason: rest.join(' ').trim() });
        } else {
            if (!ticket.closed) {
                await message.reply({ content: '이미 열려 있는 티켓이에요.', allowedMentions: { repliedUser: false } });
                return true;
            }
            if (!canCloseOrReopen(member, ticket, panel, settings)) {
                await message.reply({ content: '티켓을 다시 열 권한이 없어요.', allowedMentions: { repliedUser: false } });
                return true;
            }
            await doReopen({ ...ctx, user: message.author });
        }
    } catch (err) {
        console.error('[티켓] 명령어 처리 오류:', err);
        message.reply({ content: '❌ 처리 중 오류가 났어요. 봇의 채널 관리 권한을 확인해 주세요.', allowedMentions: { repliedUser: false } }).catch(() => {});
    }
    return true;
}
 
// ==================== 상호작용 처리 ====================
function buildModal(panel, optId, questions) {
    const opt = panel.mode === 'select' ? panel.options.find((o) => o.id === optId) : null;
    const modal = new ModalBuilder()
        .setCustomId(`tk_modal:${panel.id}:${optId || 'x'}`)
        .setTitle(str(opt ? opt.label : panel.name, 45) || '티켓 열기');
    questions.forEach((q, i) => {
        const input = new TextInputBuilder()
            .setCustomId(`q${i}`)
            .setLabel(q.label)
            .setStyle(q.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
            .setRequired(q.required)
            .setMaxLength(q.long ? 1000 : 300);
        if (q.placeholder) input.setPlaceholder(q.placeholder);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
    });
    return modal;
}
 
const ephemeral = (content) => ({ content, ephemeral: true });
 
// 이 함수가 true를 돌려주면 티켓 관련 상호작용이라 처리가 끝난 거예요.
async function handleInteraction(interaction) {
    try {
        const isTicketUi =
            (interaction.isButton() && /^tk_/.test(interaction.customId)) ||
            (interaction.isStringSelectMenu() && /^tk_sel:/.test(interaction.customId)) ||
            (interaction.isModalSubmit() && /^tk_modal:/.test(interaction.customId));
        if (!isTicketUi) return false;
        if (!interaction.guild) {
            await interaction.reply(ephemeral('서버 안에서만 쓸 수 있어요.'));
            return true;
        }
 
        const cfg = loadConfig(interaction.guildId);
        const settings = cfg.settings;
 
        // ----- 패널: 버튼 / 선택기 -----
        if ((interaction.isButton() && interaction.customId.startsWith('tk_open:')) || interaction.isStringSelectMenu()) {
            const isSel = interaction.isStringSelectMenu();
            const panel = getPanel(cfg, interaction.customId.split(':')[1]);
            if (!panel) {
                await interaction.reply(ephemeral('이 패널은 더 이상 사용할 수 없어요.'));
                return true;
            }
            const optId = isSel ? interaction.values[0] : null;
            const opt = isSel ? panel.options.find((o) => o.id === optId) : null;
            if (isSel && !opt) {
                await interaction.reply(ephemeral('이 항목은 더 이상 사용할 수 없어요. 관리자가 패널을 바꿨을 수 있어요.'));
                return true;
            }
            // 선택기는 고른 항목이 계속 표시되니, 원래 상태로 되돌려요
            const resetMenu = () => interaction.message.edit(buildPanelMessage(panel)).catch(() => {});
 
            const open = store.getOpenTickets(interaction.guildId).filter((t) => t.ownerId === interaction.user.id && t.panelId === panel.id);
            if (open.length >= panel.ticket.maxOpen) {
                await interaction.reply(ephemeral(`이미 열려 있는 티켓이 있어요: <#${open[0].channelId}>`));
                if (isSel) resetMenu();
                return true;
            }
            const questions = questionsFor(panel, optId);
            if (questions.length) {
                await interaction.showModal(buildModal(panel, optId, questions));
                if (isSel) resetMenu();
            } else {
                await interaction.deferReply({ ephemeral: true });
                if (isSel) resetMenu();
                await createTicket(interaction, cfg, panel, opt, []);
            }
            return true;
        }
 
        // ----- 양식 제출 -----
        if (interaction.isModalSubmit()) {
            const [, panelId, optId] = interaction.customId.split(':');
            const panel = getPanel(cfg, panelId);
            if (!panel) {
                await interaction.reply(ephemeral('이 패널은 더 이상 사용할 수 없어요.'));
                return true;
            }
            const opt = panel.mode === 'select' ? panel.options.find((o) => o.id === optId) : null;
            const questions = questionsFor(panel, optId);
            await interaction.deferReply({ ephemeral: true });
            const answers = questions.map((q, i) => ({
                label: q.label,
                value: interaction.fields.getTextInputValue(`q${i}`) || '',
            }));
            await createTicket(interaction, cfg, panel, opt, answers);
            return true;
        }
 
        // ----- 티켓 채널 안의 버튼 -----
        const id = interaction.customId;
        const ticket = store.findTicket(interaction.channelId);
        if (!ticket || ticket.deleted) {
            await interaction.reply(ephemeral('이 채널은 티켓이 아니에요.'));
            return true;
        }
        const panel = getPanel(cfg, ticket.panelId);
        const member = interaction.member;
        const ctx = { guild: interaction.guild, channel: interaction.channel, ticket, panel, cfg };
 
        if (id === 'tk_close') {
            if (ticket.closed) {
                await interaction.reply(ephemeral('이미 닫힌 티켓이에요.'));
                return true;
            }
            if (!canCloseOrReopen(member, ticket, panel, settings)) {
                await interaction.reply(ephemeral('티켓을 닫을 권한이 없어요.'));
                return true;
            }
            if (settings.twoStepClose) {
                await interaction.reply({
                    content: '정말 이 티켓을 닫을까요?',
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
            await interaction.deferUpdate();
            await doClose({ ...ctx, closer: interaction.user, reason: '' });
            return true;
        }
 
        if (id === 'tk_close_no') {
            await interaction.update({ content: '취소했어요.', components: [] });
            return true;
        }
 
        if (id === 'tk_close_yes') {
            if (ticket.closed) {
                await interaction.update({ content: '이미 닫힌 티켓이에요.', components: [] });
                return true;
            }
            if (!canCloseOrReopen(member, ticket, panel, settings)) {
                await interaction.update({ content: '티켓을 닫을 권한이 없어요.', components: [] });
                return true;
            }
            await interaction.update({ content: '티켓을 닫는 중이에요...', components: [] });
            await doClose({ ...ctx, closer: interaction.user, reason: '' });
            return true;
        }
 
        if (id === 'tk_reopen') {
            if (!ticket.closed) {
                await interaction.reply(ephemeral('이미 열려 있는 티켓이에요.'));
                return true;
            }
            if (!canCloseOrReopen(member, ticket, panel, settings)) {
                await interaction.reply(ephemeral('티켓을 다시 열 권한이 없어요.'));
                return true;
            }
            // 닫힘 안내 메시지의 버튼은 없애요
            await interaction.update({ components: [] });
            await doReopen({ ...ctx, user: interaction.user });
            return true;
        }
 
        if (id === 'tk_delete') {
            if (!isStaff(member, panel, settings)) {
                await interaction.reply(ephemeral('티켓 삭제는 담당자만 할 수 있어요.'));
                return true;
            }
            await interaction.update({ components: [] });
            await doDelete({ ...ctx, user: interaction.user });
            return true;
        }
 
        if (id === 'tk_transcript') {
            if (!isStaff(member, panel, settings)) {
                await interaction.reply(ephemeral('기록은 담당자만 받을 수 있어요.'));
                return true;
            }
            await interaction.deferReply({ ephemeral: true });
            const buf = await buildTranscript(interaction.channel, ticket, settings.padding);
            await interaction.editReply({ files: [new AttachmentBuilder(buf, { name: `ticket-${padNum(ticket.number, settings.padding)}.txt` })] });
            return true;
        }
 
        // 예전 버전의 "담당하기" 버튼 등
        await interaction.reply(ephemeral('이 버튼은 더 이상 사용하지 않아요.'));
        return true;
    } catch (err) {
        console.error('[티켓] 처리 중 오류:', err);
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: '❌ 처리 중 오류가 났어요. 잠시 후 다시 시도해 주세요.' });
            } else {
                await interaction.reply(ephemeral('❌ 처리 중 오류가 났어요. 잠시 후 다시 시도해 주세요.'));
            }
        } catch (_) {}
        return true;
    }
}
 
function init(client) {
    clientRef = client;
    // 티켓 채널을 직접 지우면 기록도 삭제된 것으로 처리
    client.on('channelDelete', (channel) => {
        const t = store.findTicket(channel.id);
        if (t && !t.deleted) store.markTicketDeleted(channel.id, null);
    });
}
 
module.exports = {
    OWNER_PERM_KEYS,
    init,
    handleInteraction,
    handleMessage,
    sendPanel,
    sanitizeConfig,
    loadConfig,
    defaultPanel,
    defaultSettings,
    buildPanelMessage,
};
 
