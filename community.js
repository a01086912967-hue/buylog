// 환영 메시지 / 퇴장 메시지 / 자동 역할 / 자동응답 (대시보드에서 설정)
//
// 글에 쓸 수 있는 변수
//   {user} 멘션 · {username} 이름 · {server} 서버 이름 · {count} 현재 멤버 수 · {inviter} 초대한 사람 (환영 메시지만)
 
const { ChannelType, EmbedBuilder } = require('discord.js');
const store = require('./store');
 
const DEFAULT_COLOR = '#7cc4ff';
 
const str = (v, max) => String(v ?? '').slice(0, max);
const bool = (v) => !!v;
const hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : d);
const url = (v) => (/^https?:\/\/\S{3,500}$/.test(String(v || '')) ? String(v) : '');
 
function defaultMessage(kind) {
    const welcome = kind === 'welcome';
    return {
        enabled: false,
        channelId: '',
        content: welcome ? '{user}' : '',
        useEmbed: true,
        embed: {
            title: welcome ? '{username} 님, 환영해요!' : '{username} 님이 떠났어요',
            description: welcome
                ? '**{server}** 에 오신 걸 환영해요 .ᐟ.ᐟ\n현재 멤버는 **{count}명**이에요.'
                : '다음에 또 만나요. 현재 멤버는 **{count}명**이에요.',
            color: welcome ? '#7cc4ff' : '#9aa9bd',
            image: '',
            footer: '',
            showAvatar: true,
        },
        // 환영 메시지에서만 사용
        dmEnabled: false,
        dmMessage: '{server} 에 오신 걸 환영해요!',
        roleIds: [],
    };
}
 
function defaultCommunity() {
    return { welcome: defaultMessage('welcome'), leave: defaultMessage('leave'), responders: [] };
}
 
function defaultResponder() {
    return {
        id: Math.random().toString(36).slice(2, 10),
        enabled: true,
        trigger: '',
        match: 'exact', // exact | startsWith | contains
        response: '',
        embed: false,
        color: DEFAULT_COLOR,
        reply: true,
        deleteTrigger: false,
    };
}
 
function loadCommunity(guildId) {
    const saved = store.getCommunity(guildId);
    const d = defaultCommunity();
    return {
        welcome: { ...d.welcome, ...(saved.welcome || {}), embed: { ...d.welcome.embed, ...((saved.welcome && saved.welcome.embed) || {}) } },
        leave: { ...d.leave, ...(saved.leave || {}), embed: { ...d.leave.embed, ...((saved.leave && saved.leave.embed) || {}) } },
        responders: saved.responders || [],
    };
}
 
function sanitizeCommunity(input, guild) {
    const textChannel = (id) => {
        const c = guild.channels.cache.get(String(id || ''));
        return c && (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) ? c.id : '';
    };
    const roles = (arr) =>
        (Array.isArray(arr) ? arr : [])
            .map(String)
            .filter((id) => id !== guild.id && guild.roles.cache.has(id))
            .slice(0, 10);
    const msg = (kind, m) => {
        m = m || {};
        const e = m.embed || {};
        const d = defaultMessage(kind);
        return {
            enabled: bool(m.enabled),
            channelId: textChannel(m.channelId),
            content: str(m.content, 1500),
            useEmbed: bool(m.useEmbed),
            embed: {
                title: str(e.title, 256),
                description: str(e.description, 3000),
                color: hex(e.color, d.embed.color),
                image: url(e.image),
                footer: str(e.footer, 200),
                showAvatar: bool(e.showAvatar),
            },
            dmEnabled: kind === 'welcome' ? bool(m.dmEnabled) : false,
            dmMessage: str(m.dmMessage, 1500),
            roleIds: kind === 'welcome' ? roles(m.roleIds) : [],
        };
    };
 
    const seen = new Set();
    const responders = (Array.isArray(input && input.responders) ? input.responders : [])
        .slice(0, 50)
        .map((r) => {
            let id = /^[a-z0-9]{6,20}$/.test(String(r && r.id)) ? String(r.id) : defaultResponder().id;
            if (seen.has(id)) id = defaultResponder().id;
            seen.add(id);
            return {
                id,
                enabled: r && r.enabled === undefined ? true : bool(r && r.enabled),
                trigger: str(r && r.trigger, 100).trim(),
                match: ['exact', 'startsWith', 'contains'].includes(r && r.match) ? r.match : 'exact',
                response: str(r && r.response, 2000),
                embed: bool(r && r.embed),
                color: hex(r && r.color, DEFAULT_COLOR),
                reply: r && r.reply === undefined ? true : bool(r && r.reply),
                deleteTrigger: bool(r && r.deleteTrigger),
            };
        })
        .filter((r) => r.trigger && r.response.trim());
 
    return { welcome: msg('welcome', input && input.welcome), leave: msg('leave', input && input.leave), responders };
}
 
// ==================== 보내기 ====================
const fillVars = (text, vars) =>
    String(text || '').replace(/\{(user|username|server|count|inviter)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : ''));
 
function varsFor(user, guild, inviterId) {
    return {
        user: `<@${user.id}>`,
        username: user.username,
        server: guild.name,
        count: String(guild.memberCount),
        inviter: inviterId ? `<@${inviterId}>` : '알 수 없음',
    };
}
 
function buildPayload(cfg, user, vars) {
    const payload = { allowedMentions: { users: [user.id], roles: [], parse: [] } };
    const content = fillVars(cfg.content, vars).trim();
    if (content) payload.content = content.slice(0, 2000);
    if (cfg.useEmbed) {
        const e = cfg.embed;
        const embed = new EmbedBuilder().setColor(parseInt(hex(e.color, DEFAULT_COLOR).slice(1), 16));
        const title = fillVars(e.title, vars).trim();
        const desc = fillVars(e.description, vars).trim();
        if (title) embed.setTitle(title.slice(0, 256));
        if (desc) embed.setDescription(desc.slice(0, 4000));
        if (!title && !desc) embed.setDescription('-');
        if (e.image) embed.setImage(e.image);
        if (e.showAvatar) embed.setThumbnail(user.displayAvatarURL({ extension: 'png', size: 256 }));
        if (e.footer) embed.setFooter({ text: fillVars(e.footer, vars).slice(0, 200) });
        payload.embeds = [embed];
    }
    if (!payload.content && !payload.embeds) payload.content = '-';
    return payload;
}
 
async function sendMessage(guild, kind, user, inviterId) {
    const cfg = loadCommunity(guild.id)[kind];
    if (!cfg.enabled || !cfg.channelId) return false;
    const ch = guild.channels.cache.get(cfg.channelId);
    if (!ch || !ch.isTextBased()) return false;
    await ch.send(buildPayload(cfg, user, varsFor(user, guild, inviterId)));
    return true;
}
 
// 대시보드의 "테스트 보내기" 버튼용 - 설정이 꺼져 있어도 채널로 한 번 보내봐요.
async function preview(guild, kind, user, draft) {
    const cfg = draft ? sanitizeCommunity({ [kind]: draft }, guild)[kind] : loadCommunity(guild.id)[kind];
    if (!cfg.channelId) throw new Error('먼저 메시지를 보낼 채널을 선택하고 저장해 주세요.');
    const ch = guild.channels.cache.get(cfg.channelId);
    if (!ch || !ch.isTextBased()) throw new Error('선택한 채널을 찾을 수 없어요.');
    const payload = buildPayload(cfg, user, varsFor(user, guild, kind === 'welcome' ? user.id : null));
    payload.content = `[테스트] ${payload.content && payload.content !== '-' ? payload.content : ''}`.trim();
    await ch.send(payload);
}
 
// ==================== 이벤트 연결 ====================
// 새 멤버가 들어왔을 때 (index.js의 초대 추적 뒤에서 호출해요)
async function onJoin(member, inviterId) {
    if (member.user.bot) return;
    const guild = member.guild;
    const cfg = loadCommunity(guild.id).welcome;
 
    if (cfg.roleIds.length) {
        const ids = cfg.roleIds.filter((id) => guild.roles.cache.has(id));
        if (ids.length) await member.roles.add(ids, '자동 역할').catch((e) => console.error('[환영] 자동 역할 실패:', e.message));
    }
    try {
        await sendMessage(guild, 'welcome', member.user, inviterId);
    } catch (e) {
        console.error('[환영] 메시지 전송 실패:', e.message);
    }
    if (cfg.dmEnabled && cfg.dmMessage.trim()) {
        await member.user
            .send(fillVars(cfg.dmMessage, varsFor(member.user, guild, inviterId)).slice(0, 2000))
            .catch(() => {});
    }
}
 
async function onLeave(member) {
    if (!member.user || member.user.bot) return;
    try {
        await sendMessage(member.guild, 'leave', member.user, null);
    } catch (e) {
        console.error('[퇴장] 메시지 전송 실패:', e.message);
    }
}
 
// ==================== 자동응답 ====================
const lastUsed = new Map(); // responderId:channelId -> ts
 
function matches(r, text) {
    const t = text.toLowerCase();
    const trig = r.trigger.toLowerCase();
    if (r.match === 'contains') return t.includes(trig);
    if (r.match === 'startsWith') return t === trig || t.startsWith(`${trig} `);
    return t === trig;
}
 
// true를 돌려주면 자동응답을 보낸 거예요.
async function handleMessage(message) {
    if (!message.guild || message.author.bot || !message.content) return false;
    const saved = store.getCommunity(message.guild.id);
    const list = saved.responders;
    if (!list || !list.length) return false;
    const text = message.content.trim();
    if (!text) return false;
 
    for (const r of list) {
        if (!r.enabled || !r.trigger || !matches(r, text)) continue;
        const key = `${r.id}:${message.channelId}`;
        const now = Date.now();
        if (now - (lastUsed.get(key) || 0) < 3000) return true;
        lastUsed.set(key, now);
 
        const vars = varsFor(message.author, message.guild, null);
        const body = fillVars(r.response, vars).slice(0, 4000);
        const payload = { allowedMentions: { users: [message.author.id], roles: [], parse: [], repliedUser: false } };
        if (r.embed) {
            payload.embeds = [
                new EmbedBuilder().setColor(parseInt(hex(r.color, DEFAULT_COLOR).slice(1), 16)).setDescription(body.slice(0, 4000)),
            ];
        } else {
            payload.content = body.slice(0, 2000);
        }
        try {
            if (r.reply && !r.deleteTrigger) await message.reply(payload);
            else await message.channel.send(payload);
            if (r.deleteTrigger) message.delete().catch(() => {});
        } catch (e) {
            console.error('[자동응답] 전송 실패:', e.message);
        }
        return true;
    }
    return false;
}
 
function init(client) {
    client.on('guildMemberRemove', (member) => {
        onLeave(member).catch(() => {});
    });
    setInterval(() => {
        const cut = Date.now() - 60000;
        for (const [k, v] of lastUsed) if (v < cut) lastUsed.delete(k);
    }, 5 * 60 * 1000).unref();
}
 
module.exports = { init, onJoin, handleMessage, preview, loadCommunity, sanitizeCommunity, defaultCommunity, defaultResponder };
 
