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
 
let db = { users: {}, purchases: [], joins: [], guilds: {}, tickets: [] };
 
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
function recordPurchase({ buyerId, kind, qty, price, sellerId }) {
    const robux = kind === 'robux' ? parseNumber(qty) : 0;
    const spent = parseNumber(price);
    db.purchases.push({ ts: Date.now(), buyerId, kind, robux, spent, sellerId: sellerId || null });
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
function periodStats(sinceTs) {
    const from = Math.max(sinceTs, STATS_START_TS);
    let robux = 0;
    let spent = 0;
    let count = 0;
    const byBuyer = {};
    for (const p of db.purchases) {
        if (p.ts < from) continue;
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
    db.tickets.push({ ...t, closed: false, claimedBy: null, closedBy: null, closedTs: null });
    save();
}
 
function findTicket(channelId) {
    return db.tickets.find((t) => t.channelId === channelId) || null;
}
 
function closeTicket(channelId, closedBy) {
    const t = findTicket(channelId);
    if (!t || t.closed) return null;
    t.closed = true;
    t.closedBy = closedBy || null;
    t.closedTs = Date.now();
    save();
    return t;
}
 
function claimTicket(channelId, userId) {
    const t = findTicket(channelId);
    if (!t) return null;
    t.claimedBy = userId;
    save();
    return t;
}
 
function getOpenTickets(guildId) {
    return db.tickets.filter((t) => t.guildId === guildId && !t.closed);
}
 
function getRecentTickets(guildId, n = 20) {
    return db.tickets.filter((t) => t.guildId === guildId).slice(-n).reverse();
}
 
load();
 
module.exports = {
    getTicketConfig,
    saveTicketConfig,
    nextTicketNumber,
    addTicket,
    findTicket,
    closeTicket,
    claimTicket,
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
 
