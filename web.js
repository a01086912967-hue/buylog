// 웹 대시보드 서버 (추가 패키지 없이 Node 기본 기능만 사용)
// - Railway 기본 도메인(xxxx.up.railway.app)으로 접속해요.
// - 디스코드로 로그인 -> 내가 "서버 관리" 권한을 가진 서버만 보이고, 티켓 설정을 바꿀 수 있어요.
//
// 필요한 환경변수 (Railway > Variables)
//   DISCORD_CLIENT_SECRET : 디스코드 개발자 포털 > OAuth2 > Client Secret
//   (선택) PUBLIC_URL : 사이트 주소를 직접 지정하고 싶을 때. 예) https://xxxx.up.railway.app
//   (선택) SESSION_SECRET : 로그인 세션용 비밀 문자열 (없으면 봇 토큰으로 대신해요)
 
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');
const store = require('./store');
const tickets = require('./tickets');
 
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map(); // sid -> { user, exp }
const oauthStates = new Map(); // state -> exp
 
let client = null;
 
// ---------- 도구 ----------
function parseCookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
        const i = part.indexOf('=');
        if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}
 
function baseUrl(req) {
    if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
    if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    return `${proto}://${req.headers.host}`;
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
 
function getSession(req) {
    const sid = parseCookies(req).sid;
    const s = sid && sessions.get(sid);
    if (!s) return null;
    if (s.exp < Date.now()) {
        sessions.delete(sid);
        return null;
    }
    return s;
}
 
const cookieAttrs = (req, extra = '') =>
    `Path=/; HttpOnly; SameSite=Lax${baseUrl(req).startsWith('https') ? '; Secure' : ''}${extra}`;
 
// ---------- 서버 권한 ----------
async function canManage(guild, userId) {
    if (guild.ownerId === userId) return true;
    const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
    return !!member && member.permissions.has(PermissionFlagsBits.ManageGuild);
}
 
async function manageableGuilds(userId) {
    const out = [];
    for (const g of client.guilds.cache.values()) {
        if (await canManage(g, userId)) {
            out.push({ id: g.id, name: g.name, icon: g.iconURL({ extension: 'png', size: 128 }) || null });
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
        guild: { id: guild.id, name: guild.name, icon: guild.iconURL({ extension: 'png', size: 128 }) || null },
        channels: textChannels,
        categories,
        roles,
    };
}
 
// ---------- 라우터 ----------
async function handle(req, res) {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;
 
    if (p === '/health') return send(res, 200, 'ok');
 
    // 화면
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        const html = fs.readFileSync(path.join(__dirname, 'dashboard.html'));
        return send(res, 200, html, {
            'Content-Security-Policy':
                "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
        });
    }
 
    // 디스코드 로그인
    if (p === '/login') {
        const state = crypto.randomBytes(16).toString('hex');
        oauthStates.set(state, Date.now() + 10 * 60 * 1000);
        const redirect = `${baseUrl(req)}/callback`;
        const q = new URLSearchParams({
            client_id: client.user.id,
            redirect_uri: redirect,
            response_type: 'code',
            scope: 'identify',
            state,
        });
        return send(res, 302, '', { Location: `https://discord.com/oauth2/authorize?${q}` });
    }
 
    if (p === '/callback') {
        const code = u.searchParams.get('code');
        const state = u.searchParams.get('state');
        const exp = state && oauthStates.get(state);
        oauthStates.delete(state);
        if (!code || !exp || exp < Date.now()) {
            return send(res, 400, '<meta charset="utf-8">로그인 정보가 만료됐어요. <a href="/login">다시 로그인</a>');
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
            const meRes = await fetch('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${token.access_token}` },
            });
            const me = await meRes.json();
            if (!me.id) throw new Error('유저 정보를 가져오지 못했어요.');
            const sid = crypto.randomBytes(32).toString('hex');
            sessions.set(sid, {
                user: {
                    id: me.id,
                    name: me.global_name || me.username,
                    avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : null,
                },
                exp: Date.now() + SESSION_MS,
            });
            return send(res, 302, '', { Location: '/', 'Set-Cookie': `sid=${sid}; ${cookieAttrs(req, `; Max-Age=${SESSION_MS / 1000}`)}` });
        } catch (e) {
            console.error('[웹] 로그인 오류:', e.message);
            return send(
                res,
                500,
                '<meta charset="utf-8">로그인에 실패했어요. Railway Variables의 DISCORD_CLIENT_SECRET과 개발자 포털의 Redirects 주소를 확인해 주세요. <a href="/">돌아가기</a>'
            );
        }
    }
 
    if (p === '/logout') {
        const sid = parseCookies(req).sid;
        if (sid) sessions.delete(sid);
        return send(res, 302, '', { Location: '/', 'Set-Cookie': `sid=; ${cookieAttrs(req, '; Max-Age=0')}` });
    }
 
    // ----- API -----
    if (p.startsWith('/api/')) {
        const session = getSession(req);
        if (!session) return send(res, 401, { error: 'login' });
        if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'dashboard') {
            return send(res, 403, { error: 'forbidden' });
        }
        const uid = session.user.id;
 
        if (p === '/api/me') {
            return send(res, 200, { user: session.user, guilds: await manageableGuilds(uid) });
        }
 
        const m = p.match(/^\/api\/guild\/(\d{5,25})(?:\/(.*))?$/);
        if (m) {
            const guild = client.guilds.cache.get(m[1]);
            if (!guild || !(await canManage(guild, uid))) return send(res, 403, { error: '이 서버를 관리할 권한이 없어요.' });
            const sub = m[2] || '';
 
            if (req.method === 'GET' && sub === '') {
                return send(res, 200, {
                    ...guildPayload(guild),
                    config: store.getTicketConfig(guild.id),
                    defaultPanel: tickets.defaultPanel(),
                });
            }
 
            if (req.method === 'GET' && sub === 'tickets') {
                const list = store.getRecentTickets(guild.id, 30).map((t) => ({
                    number: t.number,
                    channelId: t.channelId,
                    ownerName: t.ownerName,
                    panelName: t.panelName,
                    ts: t.ts,
                    closed: t.closed,
                    claimedBy: t.claimedBy,
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
                return send(res, 200, { config: cfg });
            }
 
            const send_m = sub.match(/^panels\/([a-z0-9]{6,20})\/send$/);
            if (req.method === 'POST' && send_m) {
                try {
                    const r = await tickets.sendPanel(guild, send_m[1]);
                    return send(res, 200, { ...r, config: store.getTicketConfig(guild.id) });
                } catch (e) {
                    return send(res, 400, { error: e.message || '패널을 보내지 못했어요. 봇 권한을 확인해 주세요.' });
                }
            }
        }
        return send(res, 404, { error: 'not found' });
    }
 
    return send(res, 404, '<meta charset="utf-8">페이지를 찾을 수 없어요.');
}
 
function start(discordClient) {
    client = discordClient;
    if (!process.env.DISCORD_CLIENT_SECRET) {
        console.warn('[웹] DISCORD_CLIENT_SECRET 이 없어서 웹 대시보드는 켜지 않았어요. (Railway Variables에 추가하면 켜져요)');
        return null;
    }
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
    });
    setInterval(() => {
        const now = Date.now();
        for (const [k, v] of sessions) if (v.exp < now) sessions.delete(k);
        for (const [k, v] of oauthStates) if (v < now) oauthStates.delete(k);
    }, 10 * 60 * 1000).unref();
    return server;
}
 
module.exports = { start, __test: { sessions, handle } };
 
