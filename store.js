// 봇 데이터 저장소 (JSON 파일)
// - 저장 위치: DATA_DIR 환경변수 > Railway Volume(RAILWAY_VOLUME_MOUNT_PATH) > ./data
// - Railway는 재배포/재시작하면 파일이 지워져요. 데이터를 유지하려면 Volume을 만들어서 연결해야 해요.
//   (Railway 서비스 > Settings > Volumes > Mount Path: /data)
 
const fs = require('fs');
const path = require('path');
 
// 모든 통계의 시작 시점: 2026-10-28 00:00 (한국 시간)
const STATS_START_TS = Date.UTC(2026, 9, 27, 15, 0, 0);
 
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'data.json');
 
const onRailway = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
const persistent = !!(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH) || !onRailway;
 
let db = { users: {}, purchases: [], joins: [], guilds: {}, tickets: [], accounts: {}, loginLog: [], sessions: {}, site: {} };
 
function load() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {
        console.error('[데이터] 저장 폴더를 만들 수 없어요:', e.message);
    }
    if (fs.existsSync(FILE)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
            db = {
                users: parsed.users || {},
                purchases: Array.isArray(parsed.purchases) ? parsed.purchases : [],
                joins: Array.isArray(parsed.joins) ? parsed.joins : [],
                guilds: parsed.guilds && typeof parsed.guilds === 'object' ? parsed.guilds : {},
                tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
                accounts: parsed.accounts && typeof parsed.accounts === 'object' ? parsed.accounts : {},
                loginLog: Array.isArray(parsed.loginLog) ? parsed.loginLog : [],
                sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
                site: parsed.site && typeof parsed.site === 'object' ? parsed.site : {},
            };
            console.log(`[데이터] 불러오기 완료 (유저 ${Object.keys(db.users).length}명, 구매 ${db.purchases.length}건) - ${FILE}`);
        } catch (e) {
            const bak = `${FILE}.corrupt-${Date.now()}`;
            try {
                fs.copyFileSync(FILE, bak);
            } catch (_) {}
            console.error(`[데이터] 파일이 손상되어 새로 시작해요. 원본은 ${bak} 에 남겨뒀어요:`, e.message);
        }
    } else {
        console.log(`[데이터] 저장 파일이 없어 새로 시작해요 - ${FILE}`);
    }
    if (!persistent) {
        console.warn(
            '[데이터] ⚠️ Railway Volume이 연결되지 않은 것 같아요. 재배포/재시작하면 데이터가 사라져요!\n' +
            '         Railway 서비스 > Settings > Volumes 에서 Volume을 만들고 Mount Path를 /data 로 설정하세요.'
        );
    }
}
 
function save() {
    try {
        const tmp = `${FILE}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(db));
        fs.renameSync(tmp, FILE);
    } catch (e) {
        console.error('[데이터] 저장 실패:', e.message);
    }
}
 
// "10,000원" / "1만" / "700 로벅스" -> 숫자
function parseNumber(s) {
    const t = String(s ?? '').replace(/,/g, '');
    const man = t.match(/(\d+(?:\.\d+)?)\s*만\s*(\d+)?/);
    if (man) return Math.round(Number(man[1]) * 10000 + (man[2] ? Number(man[2]) : 0));
    const m = t.match(/\d+(?:\.\d+)?/);
    return m ? Math.round(Number(m[0])) : 0;
}
 
function emptyUser() {
    return { robux: 0, spent: 0, count: 0, invites: 0 };
}
 
function getUser(id) {
    return { ...emptyUser(), ...(db.users[id] || {}) };
}
 
function ensureUser(id) {
    if (!db.users[id]) db.users[id] = emptyUser();
    return db.users[id];
}
 
// 구매 1건 기록 (유저 누적 + 기간 통계용 기록)
function recordPurchase({ buyerId, kind, qty, price, sellerId, item, guildId }) {
    const robux = kind === 'robux' ? parseNumber(qty) : 0;
    const spent = parseNumber(price);
    db.purchases.push({
        ts: Date.now(),
        buyerId,
        kind,
        robux,
        spent,
        sellerId: sellerId || null,
        item: String(item || '').slice(0, 80),
        qty: String(qty ?? '').slice(0, 30),
        guildId: guildId || null,
    });
    const u = ensureUser(buyerId);
    u.count += 1;
    u.spent += spent;
    u.robux += robux;
    save();
    return { robux, spent };
}
 
// 관리자가 직접 설정 (값을 준 항목만 덮어씀)
function setUser(id, patch) {
    const u = ensureUser(id);
    for (const k of ['robux', 'spent', 'count', 'invites']) {
        if (typeof patch[k] === 'number' && Number.isFinite(patch[k]) && patch[k] >= 0) u[k] = Math.round(patch[k]);
    }
    save();
    return { ...u };
}
 
// 서버 가입 기록 (초대한 사람이 있으면 초대 수 +1)
function recordJoin(userId, inviterId) {
    db.joins.push({ ts: Date.now(), userId, inviterId: inviterId || null });
    if (inviterId) ensureUser(inviterId).invites += 1;
    save();
}
 
// 구매 금액 순 랭킹 [{ id, ...user }]
function ranking() {
    return Object.entries(db.users)
        .map(([id, u]) => ({ id, ...emptyUser(), ...u }))
        .filter((u) => u.spent > 0)
        .sort((a, b) => b.spent - a.spent || b.robux - a.robux || b.count - a.count);
}
 
// 유저 순위 (구매 기록이 없으면 null)
function rankOf(id) {
    const list = ranking();
    const i = list.findIndex((u) => u.id === id);
    return { rank: i === -1 ? null : i + 1, total: list.length };
}
 
// sinceTs 이후 서버 통계
function periodStats(sinceTs, guildId) {
    const from = Math.max(sinceTs, STATS_START_TS);
    let robux = 0;
    let spent = 0;
    let count = 0;
    const byBuyer = {};
    for (const p of db.purchases) {
        if (p.ts < from) continue;
        if (guildId && p.guildId && p.guildId !== guildId) continue;
        robux += p.robux || 0;
        spent += p.spent || 0;
        count += 1;
        byBuyer[p.buyerId] = (byBuyer[p.buyerId] || 0) + (p.spent || 0);
    }
    let topBuyer = null;
    for (const [id, amount] of Object.entries(byBuyer)) {
        if (!topBuyer || amount > topBuyer.spent) topBuyer = { id, spent: amount };
    }
 
    let joined = 0;
    const byInviter = {};
    for (const j of db.joins) {
        if (j.ts < from) continue;
        joined += 1;
        if (j.inviterId) byInviter[j.inviterId] = (byInviter[j.inviterId] || 0) + 1;
    }
    let topInviter = null;
    for (const [id, n] of Object.entries(byInviter)) {
        if (!topInviter || n > topInviter.count) topInviter = { id, count: n };
    }
 
    return { from, robux, spent, count, topBuyer, joined, topInviter };
}
 
// ==================== 티켓 (대시보드 설정 + 기록) ====================
const emptyTicketConfig = () => ({ counter: 0, panels: [] });
 
// 서버의 티켓 설정 (복사본을 돌려줘요)
function getTicketConfig(guildId) {
    const g = db.guilds[guildId];
    return JSON.parse(JSON.stringify(g && g.tickets ? g.tickets : emptyTicketConfig()));
}
 
function saveTicketConfig(guildId, cfg) {
    if (!db.guilds[guildId]) db.guilds[guildId] = {};
    db.guilds[guildId].tickets = cfg;
    save();
}
 
// 티켓 번호 +1 (서버별)
function nextTicketNumber(guildId) {
    if (!db.guilds[guildId]) db.guilds[guildId] = {};
    const g = db.guilds[guildId];
    if (!g.tickets) g.tickets = emptyTicketConfig();
    g.tickets.counter = (g.tickets.counter || 0) + 1;
    save();
    return g.tickets.counter;
}
 
function addTicket(t) {
    db.tickets.push({ ...t, closed: false, deleted: false, claimedBy: null, closedBy: null, closedTs: null });
    save();
}
 
function findTicket(channelId) {
    return db.tickets.find((t) => t.channelId === channelId) || null;
}
 
function closeTicket(channelId, closedBy) {
    const t = findTicket(channelId);
    if (!t || t.closed || t.deleted) return null;
    t.closed = true;
    t.closedBy = closedBy || null;
    t.closedTs = Date.now();
    save();
    return t;
}
 
function reopenTicket(channelId) {
    const t = findTicket(channelId);
    if (!t || t.deleted || !t.closed) return null;
    t.closed = false;
    t.closedBy = null;
    t.closedTs = null;
    save();
    return t;
}
 
function markTicketDeleted(channelId, by) {
    const t = findTicket(channelId);
    if (!t) return null;
    t.deleted = true;
    t.closed = true;
    t.closedBy = t.closedBy || by || null;
    t.closedTs = t.closedTs || Date.now();
    save();
    return t;
}
 
function getOpenTickets(guildId) {
    return db.tickets.filter((t) => t.guildId === guildId && !t.closed && !t.deleted);
}
 
function getRecentTickets(guildId, n = 20) {
    return db.tickets.filter((t) => t.guildId === guildId).slice(-n).reverse();
}
 
 
// ==================== 서버별 커뮤니티 설정 (환영/퇴장/자동응답) ====================
function getCommunity(guildId) {
    const g = db.guilds[guildId];
    return JSON.parse(JSON.stringify((g && g.community) || {}));
}
 
function saveCommunity(guildId, cfg) {
    if (!db.guilds[guildId]) db.guilds[guildId] = {};
    db.guilds[guildId].community = cfg;
    save();
}
 
// ==================== 구매 기록 조회 (대시보드) ====================
const inGuild = (p, guildId) => !guildId || !p.guildId || p.guildId === guildId;
 
function getPurchases(guildId, { limit = 100, buyerId = null } = {}) {
    const out = [];
    for (let i = db.purchases.length - 1; i >= 0 && out.length < limit; i--) {
        const p = db.purchases[i];
        if (!inGuild(p, guildId)) continue;
        if (buyerId && p.buyerId !== buyerId) continue;
        out.push(p);
    }
    return out;
}
 
// 최근 N일(한국 시간 기준 날짜) 일별 합계
function dailySeries(guildId, days = 14) {
    const DAY = 24 * 60 * 60 * 1000;
    const KST = 9 * 60 * 60 * 1000;
    const todayStart = Math.floor((Date.now() + KST) / DAY) * DAY - KST;
    const list = [];
    for (let i = days - 1; i >= 0; i--) list.push({ ts: todayStart - i * DAY, spent: 0, robux: 0, count: 0 });
    for (const p of db.purchases) {
        if (!inGuild(p, guildId)) continue;
        const idx = Math.floor((p.ts - (todayStart - (days - 1) * DAY)) / DAY);
        if (idx >= 0 && idx < days) {
            list[idx].spent += p.spent || 0;
            list[idx].robux += p.robux || 0;
            list[idx].count += 1;
        }
    }
    return list;
}
 
function allUsers() {
    return Object.entries(db.users).map(([id, u]) => ({ id, ...emptyUser(), ...u }));
}
 
function countJoinsSince(guildId, sinceTs) {
    return db.joins.filter((j) => j.ts >= sinceTs).length;
}
 
// ==================== 계정 / 로그인 기록 / 세션 ====================
const newId = () => require('crypto').randomBytes(8).toString('hex');
const sha = (s) => require('crypto').createHash('sha256').update(String(s)).digest('hex');
 
function getAccount(id) {
    return db.accounts[id] || null;
}
function findAccountByUsername(username) {
    const u = String(username || '').toLowerCase();
    return Object.values(db.accounts).find((a) => a.username && a.username === u) || null;
}
function findAccountByDiscord(discordId) {
    return Object.values(db.accounts).find((a) => a.discordId === discordId) || null;
}
function createAccount({ username = null, pw = null, discordId = null, name = '', avatar = null }) {
    const id = newId();
    db.accounts[id] = {
        id,
        username: username ? String(username).toLowerCase() : null,
        name: String(name || username || '').slice(0, 40),
        pw,
        discordId,
        avatar,
        createdTs: Date.now(),
        lastLoginTs: null,
        lastIp: null,
    };
    save();
    return db.accounts[id];
}
function updateAccount(id, patch) {
    const a = db.accounts[id];
    if (!a) return null;
    Object.assign(a, patch);
    save();
    return a;
}
function deleteAccount(id) {
    delete db.accounts[id];
    for (const [k, s] of Object.entries(db.sessions)) if (s.accountId === id) delete db.sessions[k];
    save();
}
function allAccounts() {
    return Object.values(db.accounts);
}
 
const LOG_MAX = 3000;
function addLog(entry) {
    db.loginLog.push({ ts: Date.now(), ...entry });
    if (db.loginLog.length > LOG_MAX) db.loginLog.splice(0, db.loginLog.length - LOG_MAX);
    save();
}
function getLogs({ limit = 200, type = null, q = '' } = {}) {
    const needle = String(q || '').toLowerCase();
    const out = [];
    for (let i = db.loginLog.length - 1; i >= 0 && out.length < limit; i--) {
        const l = db.loginLog[i];
        if (type && l.type !== type) continue;
        if (needle && !`${l.username || ''} ${l.name || ''} ${l.discordId || ''} ${l.ip || ''} ${l.detail || ''}`.toLowerCase().includes(needle)) continue;
        out.push(l);
    }
    return out;
}
// 최근 실패 횟수 (무차별 대입 방지용)
function recentFails(key, sinceTs) {
    let n = 0;
    for (let i = db.loginLog.length - 1; i >= 0; i--) {
        const l = db.loginLog[i];
        if (l.ts < sinceTs) break;
        if (l.type === 'fail' && (l.ip === key || l.username === key)) n++;
    }
    return n;
}
function recentCount(type, ip, sinceTs) {
    let n = 0;
    for (let i = db.loginLog.length - 1; i >= 0; i--) {
        const l = db.loginLog[i];
        if (l.ts < sinceTs) break;
        if (l.type === type && l.ip === ip) n++;
    }
    return n;
}
 
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
function createSession(accountId) {
    const sid = require('crypto').randomBytes(32).toString('hex');
    db.sessions[sha(sid)] = { accountId, exp: Date.now() + SESSION_MS };
    save();
    return sid;
}
function getSessionAccount(sid) {
    if (!sid) return null;
    const k = sha(sid);
    const s = db.sessions[k];
    if (!s) return null;
    if (s.exp < Date.now()) {
        delete db.sessions[k];
        return null;
    }
    return db.accounts[s.accountId] || null;
}
function deleteSession(sid) {
    if (!sid) return;
    const k = sha(sid);
    if (db.sessions[k]) {
        delete db.sessions[k];
        save();
    }
}
function cleanSessions() {
    const now = Date.now();
    let changed = false;
    for (const [k, s] of Object.entries(db.sessions)) {
        if (s.exp < now) {
            delete db.sessions[k];
            changed = true;
        }
    }
    if (changed) save();
}
 
const SITE_KEYS = ['supportUrl', 'contactUrl', 'inviteUrl'];
function getSite() {
    const out = {};
    for (const k of SITE_KEYS) out[k] = db.site[k] || '';
    return out;
}
function setSite(patch) {
    for (const k of SITE_KEYS) if (typeof patch[k] === 'string') db.site[k] = patch[k];
    save();
    return getSite();
}
 
load();
 
module.exports = {
    getCommunity,
    saveCommunity,
    getPurchases,
    dailySeries,
    allUsers,
    countJoinsSince,
    getAccount,
    findAccountByUsername,
    findAccountByDiscord,
    createAccount,
    updateAccount,
    deleteAccount,
    allAccounts,
    addLog,
    getLogs,
    recentFails,
    recentCount,
    createSession,
    getSessionAccount,
    deleteSession,
    cleanSessions,
    getSite,
    setSite,
    getTicketConfig,
    saveTicketConfig,
    nextTicketNumber,
    addTicket,
    findTicket,
    closeTicket,
    reopenTicket,
    markTicketDeleted,
    getOpenTickets,
    getRecentTickets,
    STATS_START_TS,
    DATA_DIR,
    FILE,
    persistent,
    parseNumber,
    getUser,
    recordPurchase,
    setUser,
    recordJoin,
    ranking,
    rankOf,
    periodStats,
};
 
