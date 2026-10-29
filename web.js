// 웹 대시보드 서버 (추가 패키지 없이 Node 기본 기능만 사용)
// - Railway 기본 도메인(xxxx.up.railway.app)으로 접속해요.
// - 로그인: 회원가입(아이디/비밀번호) 또는 디스코드 로그인
// - 서버 관리(티켓/환영/자동응답/통계 등)는 "디스코드 계정이 연결된" 계정이 서버 관리 권한을 가진 서버에서만 가능해요.
// - 관리자(봇 주인) 전용: 로그인 기록(IP 포함), 계정 목록, 사이트 링크 설정
//
// 환경변수 (Railway > Variables)
//   DISCORD_CLIENT_SECRET : 디스코드 로그인/계정 연결에 필요 (개발자 포털 > OAuth2 > Client Secret)
//   (선택) PUBLIC_URL     : 사이트 주소를 직접 지정 (예: https://xxxx.up.railway.app)
//   (선택) ADMIN_DISCORD_IDS : 관리자 디스코드 ID들 (쉼표로 구분). 없으면 봇 주인이 관리자예요.
//   (선택) SUPPORT_URL / CONTACT_URL / INVITE_URL : 첫 화면 링크 기본값 (대시보드 관리자 화면에서도 바꿀 수 있어요)
 
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const store = require('./store');
const tickets = require('./tickets');
const community = require('./community');
const { resolveGrade } = require('./roles');
 
const oauthStates = new Map(); // state -> { mode, accountId, exp }
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATIC = {
    '/icon.svg': ['icon.svg', 'image/svg+xml'],
    '/icon-192.png': ['icon-192.png', 'image/png'],
    '/icon-512.png': ['icon-512.png', 'image/png'],
    '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'],
    '/favicon.ico': ['favicon-64.png', 'image/png'],
    '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
};
 
let client = null;
let ownerIds = new Set();
 
// ---------- 도구 ----------
function parseCookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
        const i = part.indexOf('=');
        if (i > 0) {
            try {
                out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
            } catch (e) {
                /* 잘못된 쿠키는 무시 */
            }
        }
    }
    return out;
}
 
function baseUrl(req) {
    if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
    if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    return `${proto}://${req.headers.host}`;
}
 
// 접속자 IP (Railway 같은 프록시 뒤에서는 X-Forwarded-For 첫 번째 값)
function getIp(req) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const raw = xff || String(req.headers['x-real-ip'] || '').trim() || (req.socket && req.socket.remoteAddress) || '';
    return raw.replace(/^::ffff:/, '').slice(0, 64) || 'unknown';
}
 
function send(res, code, body, headers = {}) {
    const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
    const data = isObj ? JSON.stringify(body) : body;
    res.writeHead(code, {
        'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'same-origin',
        'Cache-Control': 'no-store',
        ...headers,
    });
    res.end(data);
}
 
function readJson(req, limit = 300 * 1024) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) {
                reject(new Error('too large'));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
            } catch (e) {
                reject(new Error('bad json'));
            }
        });
        req.on('error', reject);
    });
}
 
const cookieAttrs = (req, extra = '') =>
    `Path=/; HttpOnly; SameSite=Lax${baseUrl(req).startsWith('https') ? '; Secure' : ''}${extra}`;
 
const setSidCookie = (req, sid) => `sid=${sid}; ${cookieAttrs(req, `; Max-Age=${7 * 24 * 60 * 60}`)}`;
const clearSidCookie = (req) => `sid=; ${cookieAttrs(req, '; Max-Age=0')}`;
 
function sessionAccount(req) {
    return store.getSessionAccount(parseCookies(req).sid);
}
 
function logEvent(req, type, account, extra = {}) {
    store.addLog({
        type,
        accountId: account ? account.id : null,
        username: (account && account.username) || extra.username || null,
        name: (account && (account.discordName || account.name)) || null,
        discordId: (account && account.discordId) || null,
        ip: getIp(req),
        ua: String(req.headers['user-agent'] || '').slice(0, 160),
        detail: extra.detail ? String(extra.detail).slice(0, 300) : undefined,
    });
}
 
// ---------- 비밀번호 ----------
function scryptAsync(password, salt) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)));
    });
}
async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const key = await scryptAsync(password, salt);
    return { salt: salt.toString('hex'), hash: key.toString('hex') };
}
async function checkPassword(password, pw) {
    // 없는 계정이어도 같은 시간이 걸리도록 항상 계산해요
    const salt = pw ? Buffer.from(pw.salt, 'hex') : Buffer.alloc(16);
    const key = await scryptAsync(password, salt);
    if (!pw) return false;
    const stored = Buffer.from(pw.hash, 'hex');
    return stored.length === key.length && crypto.timingSafeEqual(stored, key);
}
 
// ---------- 관리자 / 서버 권한 ----------
async function loadOwners() {
    try {
        const app = await client.application.fetch();
        const o = app.owner;
        if (o) {
            if (o.members) {
                for (const id of o.members.keys()) ownerIds.add(String(id));
                if (o.ownerId) ownerIds.add(String(o.ownerId));
            } else if (o.id) {
                ownerIds.add(String(o.id));
            }
        }
    } catch (e) {
        console.error('[웹] 봇 주인을 확인하지 못했어요:', e.message);
    }
}
 
function isAdmin(account) {
    if (!account || !account.discordId) return false;
    const env = String(process.env.ADMIN_DISCORD_IDS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return ownerIds.has(account.discordId) || env.includes(account.discordId);
}
 
async function canManage(guild, userId) {
    if (guild.ownerId === userId) return true;
    const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
    return !!member && member.permissions.has(PermissionFlagsBits.ManageGuild);
}
 
async function manageableGuilds(userId) {
    const out = [];
    for (const g of client.guilds.cache.values()) {
        if (await canManage(g, userId)) {
            out.push({ id: g.id, name: g.name, icon: g.iconURL({ extension: 'png', size: 128 }) || null, members: g.memberCount });
        }
    }
    return out;
}
 
function guildPayload(guild) {
    const textChannels = [];
    const categories = [];
    for (const c of guild.channels.cache.values()) {
        if (c.type === 0 || c.type === 5) textChannels.push({ id: c.id, name: c.name, pos: c.rawPosition });
        else if (c.type === 4) categories.push({ id: c.id, name: c.name, pos: c.rawPosition });
    }
    textChannels.sort((a, b) => a.pos - b.pos);
    categories.sort((a, b) => a.pos - b.pos);
    const roles = [...guild.roles.cache.values()]
        .filter((r) => r.id !== guild.id && !r.managed)
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? '' : r.hexColor }));
    return {
        guild: { id: guild.id, name: guild.name, icon: guild.iconURL({ extension: 'png', size: 128 }) || null, members: guild.memberCount },
        channels: textChannels,
        categories,
        roles,
    };
}
 
// 유저 ID -> { id, name, avatar }
async function resolveUsers(guild, ids) {
    const uniq = [...new Set(ids.filter(Boolean))].slice(0, 100);
    const out = {};
    const missing = uniq.filter((id) => !guild.members.cache.has(id));
    if (missing.length) await guild.members.fetch({ user: missing }).catch(() => {});
    for (const id of uniq) {
        const m = guild.members.cache.get(id);
        const u = m ? m.user : client.users.cache.get(id);
        out[id] = u
            ? { id, name: (m && m.displayName) || u.globalName || u.username, avatar: (m || u).displayAvatarURL({ extension: 'png', size: 64 }) }
            : { id, name: `알 수 없음 (${id.slice(-4)})`, avatar: null };
    }
    return out;
}
 
function siteLinks() {
    const s = store.getSite();
    const perms = new PermissionsBitField([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.ManageGuild,
    ]).bitfield.toString();
    const invite =
        s.inviteUrl ||
        process.env.INVITE_URL ||
        (client && client.user
            ? `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=${perms}&scope=bot%20applications.commands`
            : '');
    return {
        supportUrl: s.supportUrl || process.env.SUPPORT_URL || '',
        contactUrl: s.contactUrl || process.env.CONTACT_URL || s.supportUrl || process.env.SUPPORT_URL || '',
        inviteUrl: invite,
    };
}
 
const httpsUrl = (v) => (/^https:\/\/\S{3,500}$/.test(String(v || '').trim()) ? String(v).trim() : '');
 
function accountView(a) {
    return {
        id: a.id,
        username: a.username,
        name: a.discordName || a.name,
        avatar: a.avatar || null,
        discordId: a.discordId || null,
        hasPassword: !!a.pw,
        isAdmin: isAdmin(a),
    };
}
 
// ---------- 디스코드 OAuth ----------
function startOAuth(req, res, mode, accountId) {
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, { mode, accountId: accountId || null, exp: Date.now() + 10 * 60 * 1000 });
    const q = new URLSearchParams({
        client_id: client.user.id,
        redirect_uri: `${baseUrl(req)}/callback`,
        response_type: 'code',
        scope: 'identify',
        state,
    });
    return send(res, 302, '', { Location: `https://discord.com/oauth2/authorize?${q}` });
}
 
const errorPage = (msg) =>
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;padding:40px;line-height:1.6">${msg}<p><a href="/">처음으로 돌아가기</a></p></body>`;
 
async function handleCallback(req, res, u) {
    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    const st = state && oauthStates.get(state);
    oauthStates.delete(state);
    if (!code || !st || st.exp < Date.now()) {
        return send(res, 400, errorPage('로그인 정보가 만료됐어요. <a href="/login">다시 로그인</a>'));
    }
    try {
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: client.user.id,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: `${baseUrl(req)}/callback`,
            }),
        });
        const token = await tokenRes.json();
        if (!token.access_token) throw new Error(`토큰 발급 실패: ${JSON.stringify(token).slice(0, 200)}`);
        const meRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
        const me = await meRes.json();
        if (!me.id) throw new Error('유저 정보를 가져오지 못했어요.');
        const discordName = me.global_name || me.username;
        const avatar = me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : null;
 
        if (st.mode === 'link') {
            const cur = sessionAccount(req);
            if (!cur || cur.id !== st.accountId) {
                return send(res, 400, errorPage('연결 중에 로그인이 풀렸어요. 다시 로그인한 뒤 시도해 주세요.'));
            }
            const other = store.findAccountByDiscord(me.id);
            if (other && other.id !== cur.id) {
                if (other.pw) {
                    return send(res, 400, errorPage('이 디스코드 계정은 이미 다른 사이트 계정에 연결돼 있어요.'));
                }
                store.deleteAccount(other.id); // 디스코드로만 만들어진 빈 계정은 합쳐요
            }
            const acc = store.updateAccount(cur.id, { discordId: me.id, discordName, avatar });
            logEvent(req, 'discord_link', acc);
            return send(res, 302, '', { Location: '/#/' });
        }
 
        let acc = store.findAccountByDiscord(me.id);
        if (!acc) acc = store.createAccount({ discordId: me.id, name: discordName, avatar });
        acc = store.updateAccount(acc.id, { discordName, avatar, lastLoginTs: Date.now(), lastIp: getIp(req) });
        const sid = store.createSession(acc.id);
        logEvent(req, 'discord_login', acc);
        return send(res, 302, '', { Location: '/#/', 'Set-Cookie': setSidCookie(req, sid) });
    } catch (e) {
        console.error('[웹] 로그인 오류:', e.message);
        return send(
            res,
            500,
            errorPage('디스코드 로그인에 실패했어요. Railway Variables의 DISCORD_CLIENT_SECRET과 개발자 포털의 Redirects 주소를 확인해 주세요.')
        );
    }
}
 
// ---------- 회원가입 / 로그인 ----------
async function handleAuth(req, res, p) {
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    if (req.headers['x-requested-with'] !== 'dashboard') return send(res, 403, { error: 'forbidden' });
    let body;
    try {
        body = await readJson(req, 20 * 1024);
    } catch (e) {
        return send(res, 400, { error: '요청 형식이 올바르지 않아요.' });
    }
    const ip = getIp(req);
    const now = Date.now();
 
    if (p === '/api/auth/signup') {
        const username = String(body.username || '').trim().toLowerCase();
        const password = String(body.password || '');
        if (body.consent !== true) return send(res, 400, { error: '로그인 기록과 IP 수집에 동의해야 가입할 수 있어요.' });
        if (!/^[a-z0-9_]{3,20}$/.test(username)) return send(res, 400, { error: '아이디는 영문 소문자, 숫자, _ 로 3~20자예요.' });
        if (password.length < 8 || password.length > 100) return send(res, 400, { error: '비밀번호는 8자 이상이어야 해요.' });
        if (password.toLowerCase().includes(username)) return send(res, 400, { error: '비밀번호에 아이디를 포함할 수 없어요.' });
        if (store.recentCount('signup', ip, now - 60 * 60 * 1000) >= 5) {
            return send(res, 429, { error: '가입 시도가 너무 많아요. 잠시 후 다시 해주세요.' });
        }
        if (store.findAccountByUsername(username)) return send(res, 409, { error: '이미 사용 중인 아이디예요.' });
        const acc = store.createAccount({ username, pw: await hashPassword(password), name: username });
        store.updateAccount(acc.id, { lastLoginTs: now, lastIp: ip });
        const sid = store.createSession(acc.id);
        logEvent(req, 'signup', acc);
        return send(res, 200, { account: accountView(acc) }, { 'Set-Cookie': setSidCookie(req, sid) });
    }
 
    if (p === '/api/auth/login') {
        const username = String(body.username || '').trim().toLowerCase().slice(0, 40);
        const password = String(body.password || '').slice(0, 200);
        if (store.recentFails(ip, now - 15 * 60 * 1000) >= 10 || store.recentFails(username, now - 15 * 60 * 1000) >= 8) {
            return send(res, 429, { error: '로그인 시도가 너무 많아요. 15분 뒤에 다시 해주세요.' });
        }
        const acc = store.findAccountByUsername(username);
        const ok = await checkPassword(password, acc && acc.pw);
        if (!acc || !ok) {
            logEvent(req, 'fail', null, { username, detail: '아이디 또는 비밀번호가 올바르지 않아요' });
            return send(res, 401, { error: '아이디 또는 비밀번호가 올바르지 않아요.' });
        }
        store.updateAccount(acc.id, { lastLoginTs: now, lastIp: ip });
        const sid = store.createSession(acc.id);
        logEvent(req, 'login', acc);
        return send(res, 200, { account: accountView(acc) }, { 'Set-Cookie': setSidCookie(req, sid) });
    }
 
    if (p === '/api/auth/logout') {
        const sid = parseCookies(req).sid;
        const acc = sessionAccount(req);
        if (acc) logEvent(req, 'logout', acc);
        store.deleteSession(sid);
        return send(res, 200, { ok: true }, { 'Set-Cookie': clearSidCookie(req) });
    }
 
    if (p === '/api/auth/password') {
        const acc = sessionAccount(req);
        if (!acc) return send(res, 401, { error: 'login' });
        if (!acc.pw) return send(res, 400, { error: '디스코드로만 만든 계정이라 비밀번호가 없어요.' });
        const cur = String(body.current || '');
        const next = String(body.next || '');
        if (next.length < 8 || next.length > 100) return send(res, 400, { error: '새 비밀번호는 8자 이상이어야 해요.' });
        if (store.recentFails(`pw:${acc.id}`, now - 15 * 60 * 1000) >= 5) return send(res, 429, { error: '잠시 후 다시 시도해 주세요.' });
        if (!(await checkPassword(cur, acc.pw))) {
            logEvent(req, 'fail', null, { username: `pw:${acc.id}`, detail: '비밀번호 변경 실패' });
            return send(res, 400, { error: '현재 비밀번호가 맞지 않아요.' });
        }
        store.updateAccount(acc.id, { pw: await hashPassword(next) });
        logEvent(req, 'action', acc, { detail: '비밀번호 변경' });
        return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'not found' });
}
 
// ---------- 서버(길드) API ----------
const dayStartKst = (daysAgo) => {
    const DAY = 24 * 60 * 60 * 1000;
    const KST = 9 * 60 * 60 * 1000;
    return Math.floor((Date.now() + KST) / DAY) * DAY - KST - daysAgo * DAY;
};
 
async function handleGuildApi(req, res, guild, account, sub) {
    const uid = account.discordId;
 
    if (req.method === 'GET' && sub === '') {
        return send(res, 200, {
            ...guildPayload(guild),
            tickets: tickets.loadConfig(guild.id),
            defaultPanel: tickets.defaultPanel(),
            community: community.loadCommunity(guild.id),
            defaultResponder: community.defaultResponder(),
        });
    }
 
    // ----- 티켓 -----
    if (req.method === 'GET' && sub === 'tickets') {
        const list = store.getRecentTickets(guild.id, 40).map((t) => ({
            number: t.number,
            channelId: t.channelId,
            ownerName: t.ownerName,
            panelName: t.panelName,
            optionLabel: t.optionLabel || null,
            ts: t.ts,
            closed: !!t.closed,
            deleted: !!t.deleted,
            exists: guild.channels.cache.has(t.channelId),
        }));
        return send(res, 200, { tickets: list });
    }
    if (req.method === 'PUT' && sub === 'tickets') {
        let body;
        try {
            body = await readJson(req);
        } catch (e) {
            return send(res, 400, { error: '요청 형식이 올바르지 않아요.' });
        }
        const cfg = tickets.sanitizeConfig(body, guild, store.getTicketConfig(guild.id));
        store.saveTicketConfig(guild.id, cfg);
        logEvent(req, 'action', account, { detail: `${guild.name}: 티켓 설정 저장` });
        return send(res, 200, { tickets: tickets.loadConfig(guild.id) });
    }
    const sendM = sub.match(/^panels\/([a-z0-9]{6,20})\/send$/);
    if (req.method === 'POST' && sendM) {
        try {
            const r = await tickets.sendPanel(guild, sendM[1]);
            logEvent(req, 'action', account, { detail: `${guild.name}: 티켓 패널 전송` });
            return send(res, 200, { ...r, tickets: tickets.loadConfig(guild.id) });
        } catch (e) {
            return send(res, 400, { error: e.message || '패널을 보내지 못했어요. 봇 권한을 확인해 주세요.' });
        }
    }
 
    // ----- 환영 / 퇴장 / 자동응답 -----
    if (req.method === 'PUT' && sub === 'community') {
        let body;
        try {
            body = await readJson(req);
        } catch (e) {
            return send(res, 400, { error: '요청 형식이 올바르지 않아요.' });
        }
        const cfg = community.sanitizeCommunity(body, guild);
        store.saveCommunity(guild.id, cfg);
        logEvent(req, 'action', account, { detail: `${guild.name}: 환영/퇴장/자동응답 저장` });
        return send(res, 200, { community: community.loadCommunity(guild.id) });
    }
    if (req.method === 'POST' && sub === 'community/preview') {
        let body;
        try {
            body = await readJson(req);
        } catch (e) {
            return send(res, 400, { error: '요청 형식이 올바르지 않아요.' });
        }
        const kind = body.kind === 'leave' ? 'leave' : 'welcome';
        try {
            const user = client.users.cache.get(uid) || (await client.users.fetch(uid));
            await community.preview(guild, kind, user, body.draft);
            return send(res, 200, { ok: true });
        } catch (e) {
            return send(res, 400, { error: e.message || '테스트 메시지를 보내지 못했어요.' });
        }
    }
 
    // ----- 통계 -----
    if (req.method === 'GET' && sub === 'stats') {
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const week = store.periodStats(weekAgo, guild.id);
        const all = store.periodStats(0, guild.id);
        const ids = [week.topBuyer && week.topBuyer.id, all.topBuyer && all.topBuyer.id, week.topInviter && week.topInviter.id, all.topInviter && all.topInviter.id];
        const rank = store.ranking().slice(0, 5);
        const names = await resolveUsers(guild, [...ids, ...rank.map((r) => r.id)]);
        const withName = (x) => (x ? { ...x, ...names[x.id] } : null);
        const open = store.getOpenTickets(guild.id).length;
        return send(res, 200, {
            startTs: store.STATS_START_TS,
            members: guild.memberCount,
            openTickets: open,
            week: { ...week, topBuyer: withName(week.topBuyer), topInviter: withName(week.topInviter) },
            all: { ...all, topBuyer: withName(all.topBuyer), topInviter: withName(all.topInviter) },
            daily: store.dailySeries(guild.id, 14),
            top: rank.map((r) => ({ ...r, ...names[r.id] })),
        });
    }
 
    // ----- 구매 로그 -----
    if (req.method === 'GET' && sub === 'purchases') {
        const u = new URL(req.url, 'http://localhost');
        const buyer = /^\d{5,25}$/.test(u.searchParams.get('buyer') || '') ? u.searchParams.get('buyer') : null;
        const limit = Math.min(300, Math.max(10, parseInt(u.searchParams.get('limit'), 10) || 100));
        const list = store.getPurchases(guild.id, { limit, buyerId: buyer });
        const names = await resolveUsers(guild, list.flatMap((p) => [p.buyerId, p.sellerId]));
        return send(res, 200, {
            purchases: list.map((p) => ({
                ts: p.ts,
                kind: p.kind,
                item: p.item || '',
                qty: p.qty || '',
                robux: p.robux,
                spent: p.spent,
                buyer: names[p.buyerId],
                seller: p.sellerId ? names[p.sellerId] : null,
            })),
        });
    }
 
    // ----- 유저 정보 -----
    if (req.method === 'GET' && sub === 'users') {
        const u = new URL(req.url, 'http://localhost');
        const q = (u.searchParams.get('q') || '').trim().slice(0, 50);
        let members = [];
        if (!q) {
            const rank = store.ranking().slice(0, 20);
            const names = await resolveUsers(guild, rank.map((r) => r.id));
            return send(res, 200, { users: rank.map((r, i) => ({ ...names[r.id], rank: i + 1, spent: r.spent, count: r.count })), title: '구매 랭킹' });
        }
        if (/^\d{5,25}$/.test(q)) {
            const m = guild.members.cache.get(q) || (await guild.members.fetch(q).catch(() => null));
            if (m) members = [m];
        } else {
            const found = await guild.members.search({ query: q, limit: 10 }).catch(() => null);
            members = found ? [...found.values()] : [];
        }
        return send(res, 200, {
            users: members.map((m) => ({
                id: m.id,
                name: m.displayName,
                avatar: m.displayAvatarURL({ extension: 'png', size: 64 }),
                ...pickStore(m.id),
            })),
            title: '검색 결과',
        });
    }
    const userM = sub.match(/^users\/(\d{5,25})$/);
    if (userM) {
        const targetId = userM[1];
        if (req.method === 'GET') {
            const member = guild.members.cache.get(targetId) || (await guild.members.fetch(targetId).catch(() => null));
            if (!member) return send(res, 404, { error: '이 서버에서 유저를 찾을 수 없어요.' });
            const data = store.getUser(targetId);
            const { rank, total } = store.rankOf(targetId);
            const grade = resolveGrade(member);
            const recent = store.getPurchases(guild.id, { limit: 20, buyerId: targetId });
            return send(res, 200, {
                user: {
                    id: member.id,
                    name: member.displayName,
                    username: member.user.username,
                    avatar: member.displayAvatarURL({ extension: 'png', size: 128 }),
                    joinedTs: member.joinedTimestamp || null,
                    createdTs: member.user.createdTimestamp,
                    tier: grade.tier ? grade.tier.name : null,
                    serverRole: grade.serverRole ? grade.serverRole.name : null,
                    ...data,
                    rank,
                    rankTotal: total,
                },
                purchases: recent.map((p) => ({ ts: p.ts, kind: p.kind, item: p.item || '', qty: p.qty || '', robux: p.robux, spent: p.spent })),
            });
        }
        if (req.method === 'PUT') {
            let body;
            try {
                body = await readJson(req, 10 * 1024);
            } catch (e) {
                return send(res, 400, { error: '요청 형식이 올바르지 않아요.' });
            }
            const patch = {};
            for (const k of ['robux', 'spent', 'count', 'invites']) {
                if (body[k] !== undefined) {
                    const n = Number(body[k]);
                    if (!Number.isFinite(n) || n < 0 || n > 1e12) return send(res, 400, { error: '숫자는 0 이상으로 입력해 주세요.' });
                    patch[k] = Math.round(n);
                }
            }
            const updated = store.setUser(targetId, patch);
            logEvent(req, 'action', account, { detail: `${guild.name}: 유저 ${targetId} 정보 수정 ${JSON.stringify(patch)}` });
            return send(res, 200, { data: updated });
        }
    }
    return send(res, 404, { error: 'not found' });
}
 
function pickStore(id) {
    const d = store.getUser(id);
    return { spent: d.spent, count: d.count, robux: d.robux, rank: store.rankOf(id).rank };
}
 
// ---------- 관리자 API ----------
async function handleAdminApi(req, res, account, sub) {
    if (req.method === 'GET' && sub === 'logs') {
        const u = new URL(req.url, 'http://localhost');
        const type = ['signup', 'login', 'fail', 'discord_login', 'discord_link', 'logout', 'action'].includes(u.searchParams.get('type'))
            ? u.searchParams.get('type')
            : null;
        const limit = Math.min(500, Math.max(10, parseInt(u.searchParams.get('limit'), 10) || 200));
        return send(res, 200, { logs: store.getLogs({ limit, type, q: u.searchParams.get('q') || '' }) });
    }
    if (req.method === 'GET' && sub === 'accounts') {
        const list = store
            .allAccounts()
            .sort((a, b) => (b.lastLoginTs || 0) - (a.lastLoginTs || 0))
            .map((a) => ({
                id: a.id,
                username: a.username,
                name: a.discordName || a.name,
                discordId: a.discordId,
                hasPassword: !!a.pw,
                createdTs: a.createdTs,
                lastLoginTs: a.lastLoginTs,
                lastIp: a.lastIp,
                isAdmin: isAdmin(a),
            }));
        return send(res, 200, { accounts: list });
    }
    const delM = sub.match(/^accounts\/([a-f0-9]{16})$/);
    if (req.method === 'DELETE' && delM) {
        if (delM[1] === account.id) return send(res, 400, { error: '내 계정은 지울 수 없어요.' });
        const target = store.getAccount(delM[1]);
        if (!target) return send(res, 404, { error: '계정을 찾을 수 없어요.' });
        store.deleteAccount(target.id);
        logEvent(req, 'action', account, { detail: `계정 삭제: ${target.username || target.discordId}` });
        return send(res, 200, { ok: true });
    }
    if (sub === 'site') {
        if (req.method === 'GET') return send(res, 200, { site: store.getSite(), effective: siteLinks() });
        if (req.method === 'PUT') {
            let body;
            try {
                body = await readJson(req, 10 * 1024);
            } catch (e) {
                return send(res, 400, { error: '요청 형식이 올바르지 않아요.' });
            }
            const site = store.setSite({
                supportUrl: httpsUrl(body.supportUrl),
                contactUrl: httpsUrl(body.contactUrl),
                inviteUrl: httpsUrl(body.inviteUrl),
            });
            logEvent(req, 'action', account, { detail: '첫 화면 링크 수정' });
            return send(res, 200, { site, effective: siteLinks() });
        }
    }
    return send(res, 404, { error: 'not found' });
}
 
// ---------- 라우터 ----------
async function handle(req, res) {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;
 
    if (p === '/health') return send(res, 200, 'ok');
 
    // 화면 / 아이콘
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        const html = fs.readFileSync(path.join(__dirname, 'dashboard.html'));
        return send(res, 200, html, {
            'Content-Security-Policy':
                "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        });
    }
    if (req.method === 'GET' && STATIC[p]) {
        const [file, type] = STATIC[p];
        try {
            const data = fs.readFileSync(path.join(PUBLIC_DIR, file));
            return send(res, 200, data, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' });
        } catch (e) {
            return send(res, 404, 'not found');
        }
    }
 
    // 디스코드 로그인 / 계정 연결
    if (p === '/login') {
        if (!process.env.DISCORD_CLIENT_SECRET) return send(res, 503, errorPage('디스코드 로그인은 아직 설정되지 않았어요. (DISCORD_CLIENT_SECRET 필요)'));
        return startOAuth(req, res, 'login');
    }
    if (p === '/link/discord') {
        const acc = sessionAccount(req);
        if (!acc) return send(res, 302, '', { Location: '/#/' });
        if (!process.env.DISCORD_CLIENT_SECRET) return send(res, 503, errorPage('디스코드 연결은 아직 설정되지 않았어요. (DISCORD_CLIENT_SECRET 필요)'));
        return startOAuth(req, res, 'link', acc.id);
    }
    if (p === '/callback') return handleCallback(req, res, u);
    if (p === '/logout') {
        const acc = sessionAccount(req);
        if (acc) logEvent(req, 'logout', acc);
        store.deleteSession(parseCookies(req).sid);
        return send(res, 302, '', { Location: '/', 'Set-Cookie': clearSidCookie(req) });
    }
 
    // ----- API -----
    if (p === '/api/public' && req.method === 'GET') {
        const links = siteLinks();
        return send(res, 200, {
            botName: client && client.user ? client.user.username : '릴리웨이',
            botAvatar: client && client.user ? client.user.displayAvatarURL({ extension: 'png', size: 128 }) : null,
            servers: client ? client.guilds.cache.size : 0,
            discordLogin: !!process.env.DISCORD_CLIENT_SECRET,
            links,
        });
    }
    if (p.startsWith('/api/auth/')) return handleAuth(req, res, p);
 
    if (p.startsWith('/api/')) {
        const account = sessionAccount(req);
        if (!account) return send(res, 401, { error: 'login' });
        if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'dashboard') {
            return send(res, 403, { error: 'forbidden' });
        }
 
        if (p === '/api/me') {
            const guilds = account.discordId ? await manageableGuilds(account.discordId) : [];
            return send(res, 200, { account: accountView(account), guilds, discordLogin: !!process.env.DISCORD_CLIENT_SECRET });
        }
 
        const am = p.match(/^\/api\/admin\/(.*)$/);
        if (am) {
            if (!isAdmin(account)) return send(res, 403, { error: '관리자만 볼 수 있어요.' });
            return handleAdminApi(req, res, account, am[1]);
        }
 
        const m = p.match(/^\/api\/guild\/(\d{5,25})(?:\/(.*))?$/);
        if (m) {
            if (!account.discordId) return send(res, 403, { error: '디스코드 계정을 먼저 연결해 주세요.' });
            const guild = client.guilds.cache.get(m[1]);
            if (!guild || !(await canManage(guild, account.discordId))) return send(res, 403, { error: '이 서버를 관리할 권한이 없어요.' });
            return handleGuildApi(req, res, guild, account, m[2] || '');
        }
        return send(res, 404, { error: 'not found' });
    }
 
    return send(res, 404, errorPage('페이지를 찾을 수 없어요.'));
}
 
function start(discordClient) {
    client = discordClient;
    loadOwners();
    const server = http.createServer((req, res) => {
        handle(req, res).catch((e) => {
            console.error('[웹] 오류:', e);
            if (!res.headersSent) send(res, 500, { error: 'server error' });
        });
    });
    const port = parseInt(process.env.PORT, 10) || 3000;
    server.listen(port, '0.0.0.0', () => {
        console.log(`[웹] 대시보드 실행 중 (포트 ${port})`);
        const shown = process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);
        if (shown) console.log(`[웹] 개발자 포털 OAuth2 Redirects에 등록할 주소: ${shown}/callback`);
        if (!process.env.DISCORD_CLIENT_SECRET) {
            console.warn('[웹] DISCORD_CLIENT_SECRET 이 없어요. 아이디/비밀번호 가입은 되지만 디스코드 연결(서버 관리)은 안 돼요.');
        }
    });
    setInterval(() => {
        const now = Date.now();
        store.cleanSessions();
        for (const [k, v] of oauthStates) if (v.exp < now) oauthStates.delete(k);
    }, 10 * 60 * 1000).unref();
    return server;
}
 
module.exports = { start, __test: { handle, setOwners: (ids) => (ownerIds = new Set(ids)) } };
 
