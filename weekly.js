// 주간 / 전체 TOP 3 역할 자동 지급
//  - 주간 TOP 3: 이번 주(한국 시간 월요일 00:00 ~ 지금) 구매 금액 1·2·3등  →  $통계와 같은 기준
//    월요일 00:00(KST)이 되면 새 주로 바뀌어서 다시 집계해요.
//  - 전체 TOP 3: 서버 랭킹($랭킹) 1·2·3등
//  - 5분마다 확인해서 순위가 바뀐 사람만 역할을 바꿔요. (역할 없으면 자동 생성)
//  - 역할 위치: 구매 등급 '크리스탈' 역할 바로 위
//  - 색: 그라데이션 (1위는 홀로그램). 서버 부스트 2레벨 미만이면 그라데이션이 안 돼서 단색으로 들어가요.
//  - 봇에게 "역할 관리" 권한이 있어야 하고, 봇 역할이 이 역할들보다 위에 있어야 해요.
const store = require('./store');
const { TIER_ROLES } = require('./roles');

const DAY = 24 * 60 * 60 * 1000;
const KST = 9 * 60 * 60 * 1000;
const CRYSTAL_ROLE_ID = (TIER_ROLES.find((r) => r.name === '크리스탈') || TIER_ROLES[0]).id;

// 디스코드 홀로그램 스타일 (이 세 값 그대로여야 홀로그램으로 인정돼요)
const HOLO = { primaryColor: 11127295, secondaryColor: 16759788, tertiaryColor: 16761760 };

// 위에서부터 순서대로 배치 (전체 1위가 가장 위, 주간 3위가 크리스탈 바로 위)
const ROLE_DEFS = [
    { key: 'all1', type: 'all', rank: 1, name: '【전체 1위_𝗧𝗢𝗣】', colors: HOLO },
    { key: 'all2', type: 'all', rank: 2, name: '【전체 2위_𝗧𝗢𝗣】', colors: { primaryColor: 0x7f5bff, secondaryColor: 0x00e5ff } },
    { key: 'all3', type: 'all', rank: 3, name: '【전체 3위_𝗧𝗢𝗣】', colors: { primaryColor: 0xff4fa3, secondaryColor: 0xffc94f } },
    { key: 'week1', type: 'week', rank: 1, name: '【주간 1위_𝗧𝗢𝗣】', colors: { primaryColor: 0xff6a88, secondaryColor: 0x7be0ff } },
    { key: 'week2', type: 'week', rank: 2, name: '【주간 2위_𝗧𝗢𝗣】', colors: { primaryColor: 0x9dff8a, secondaryColor: 0x4fb7ff } },
    { key: 'week3', type: 'week', rank: 3, name: '【주간 3위_𝗧𝗢𝗣】', colors: { primaryColor: 0xffb36b, secondaryColor: 0xc86bff } },
];

// 이번 주 월요일 00:00 (KST) 를 UTC 타임스탬프로
function weekStart(ts) {
    const k = new Date(ts + KST);
    const dow = (k.getUTCDay() + 6) % 7; // 월=0 ... 일=6
    return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - dow) - KST;
}

function colorsFor(guild, def) {
    const gradient = guild.features && guild.features.includes('ENHANCED_ROLE_COLORS');
    return gradient ? def.colors : { primaryColor: def.colors.primaryColor };
}

function sameColors(role, want) {
    const c = role.colors || {};
    return (c.primaryColor || 0) === (want.primaryColor || 0)
        && (c.secondaryColor || null) === (want.secondaryColor || null)
        && (c.tertiaryColor || null) === (want.tertiaryColor || null);
}

// 역할 찾기 (저장해 둔 ID → 이름 순) / 없으면 만들기
async function getRole(guild, def) {
    const saved = (store.getMeta('rankRoles') || {})[guild.id] || {};
    let role = (saved[def.key] && guild.roles.cache.get(saved[def.key])) || guild.roles.cache.find((r) => r.name === def.name);
    const colors = colorsFor(guild, def);
    if (!role) {
        role = await guild.roles.create({ name: def.name, colors, hoist: true, mentionable: false, reason: 'TOP 역할 자동 생성' });
    } else if (!sameColors(role, colors)) {
        await role.setColors(colors, 'TOP 역할 색 적용').catch((e) => console.error(`[TOP] 색 적용 실패 (${def.name}):`, e.message));
    }
    if (saved[def.key] !== role.id) {
        const all = store.getMeta('rankRoles') || {};
        all[guild.id] = { ...(all[guild.id] || {}), [def.key]: role.id };
        store.setMeta('rankRoles', all);
    }
    return role;
}

// 크리스탈 바로 위에 ROLE_DEFS 순서대로 쌓기 (이미 맞으면 건드리지 않아요)
async function placeRoles(guild, roles) {
    const crystal = guild.roles.cache.get(CRYSTAL_ROLE_ID);
    if (!crystal) return;
    const bottomUp = [...roles].reverse(); // 주간 3위 → ... → 전체 1위
    const ok = bottomUp.every((r, i) => r.position === crystal.position + 1 + i);
    if (ok) return;
    // 아래(크리스탈)부터 하나씩 바로 위 칸으로 옮겨요
    let prev = crystal;
    for (const role of bottomUp) {
        const fresh = guild.roles.cache.get(role.id);
        const below = guild.roles.cache.get(prev.id);
        if (!fresh || !below) return;
        if (fresh.position !== below.position + 1) {
            const target = fresh.position < below.position ? below.position : below.position + 1;
            try {
                await fresh.setPosition(target, { reason: 'TOP 역할 위치 (크리스탈 위)' });
            } catch (e) {
                console.error('[TOP] 역할 위치 변경 실패 (봇 역할이 더 위에 있어야 해요):', e.message);
                return;
            }
        }
        prev = fresh;
    }
}

// 아직 서버에 있는 사람만 3명
async function pickWinners(guild, list) {
    const out = [];
    for (const r of list) {
        if (out.length >= 3) break;
        const m = guild.members.cache.get(r.id) || await guild.members.fetch(r.id).catch(() => null);
        if (m && !m.user.bot) out.push({ member: m, spent: r.spent });
    }
    return out;
}

const won = (n) => `${Number(n || 0).toLocaleString('en-US')}원`;

// 한 서버 처리. 결과 요약 글을 돌려줘요.
async function runGuild(guild, { fullFetch = false } = {}) {
    if (fullFetch) await guild.members.fetch().catch(() => {}); // 역할 가진 사람 목록을 정확히 보려고

    const weekList = store.weeklyTop(guild.id, weekStart(Date.now()), Date.now() + 1);
    const winners = {
        week: await pickWinners(guild, weekList),
        all: await pickWinners(guild, store.ranking()),
    };

    const roles = [];
    const lines = { all: [], week: [] };
    for (const def of ROLE_DEFS) {
        let role;
        try {
            role = await getRole(guild, def);
        } catch (e) {
            console.error(`[TOP] 역할 만들기 실패 (${def.name}):`, e.message);
            lines[def.type].push(`${def.rank}위: 역할을 만들 수 없어요 (봇 권한 확인)`);
            continue;
        }
        roles.push(role);
        const w = winners[def.type][def.rank - 1] || null;
        // 순위에서 밀려난 사람 역할 회수
        for (const holder of role.members.values()) {
            if (w && holder.id === w.member.id) continue;
            await holder.roles.remove(role, 'TOP 갱신').catch((e) => console.error('[TOP] 역할 회수 실패:', e.message));
        }
        // 새 TOP 지급
        if (w) {
            if (!w.member.roles.cache.has(role.id)) {
                await w.member.roles.add(role, `${def.type === 'all' ? '전체' : '주간'} ${def.rank}위`).catch((e) => console.error('[TOP] 역할 지급 실패:', e.message));
            }
            lines[def.type].push(`${def.rank}위: ${w.member.user.username} (${won(w.spent)})`);
        }
    }
    if (roles.length === ROLE_DEFS.length) await placeRoles(guild, roles);

    return [
        '**전체 TOP 3** (서버 랭킹 기준)',
        lines.all.length ? lines.all.join('\n') : '구매 기록이 없어요.',
        '',
        '**주간 TOP 3** (이번 주 월요일 00:00 KST부터)',
        lines.week.length ? lines.week.join('\n') : '이번 주 구매 기록이 아직 없어요.',
    ].join('\n');
}

let running = false;
async function tick(client, fullFetch) {
    if (running) return;
    running = true;
    try {
        for (const guild of client.guilds.cache.values()) {
            if (!store.hasPurchases(guild.id)) continue; // 구매 기록이 전혀 없는 서버는 건드리지 않아요
            await runGuild(guild, { fullFetch }).catch((e) => console.error('[TOP] 갱신 실패:', e));
        }
    } finally {
        running = false;
    }
}

function start(client) {
    setTimeout(() => tick(client, true), 20 * 1000); // 켜진 직후 한 번 (멤버 전체 불러오기)
    setInterval(() => tick(client, false), 5 * 60 * 1000).unref();
    setInterval(() => tick(client, true), 6 * 60 * 60 * 1000).unref();
}

module.exports = { start, runGuild, weekStart, ROLE_DEFS, DAY };
