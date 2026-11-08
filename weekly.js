// 주간 TOP 3 역할 자동 지급
//  - 매주 월요일 00:00(한국 시간)에 "지난주(월~일)" 구매 금액이 가장 많은 3명에게 역할을 줘요.
//  - 새 주가 시작되면 지난주 역할은 모두 빼고, 새 TOP 3에게 다시 지급해요. (매주 반복)
//  - 역할이 서버에 없으면 자동으로 만들어요. (봇에게 "역할 관리" 권한이 필요하고, 봇 역할이 이 역할들보다 위에 있어야 해요)
const store = require('./store');

const DAY = 24 * 60 * 60 * 1000;
const KST = 9 * 60 * 60 * 1000;

const ROLE_DEFS = [
    { rank: 1, name: '【주간 1위_𝗧𝗢𝗣】', color: 0xf5c542 },
    { rank: 2, name: '【주간 2위_𝗧𝗢𝗣】', color: 0xc0c7d1 },
    { rank: 3, name: '【주간 3위_𝗧𝗢𝗣】', color: 0xd08a4e },
];

// 이번 주 월요일 00:00 (KST) 를 UTC 타임스탬프로
function weekStart(ts) {
    const k = new Date(ts + KST);
    const dow = (k.getUTCDay() + 6) % 7; // 월=0 ... 일=6
    return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - dow) - KST;
}

async function getRole(guild, def, create) {
    let role = guild.roles.cache.find((r) => r.name === def.name);
    if (!role && create) {
        role = await guild.roles.create({ name: def.name, color: def.color, hoist: true, mentionable: false, reason: '주간 TOP 역할 자동 생성' });
    }
    return role || null;
}

// 한 서버 처리. 지난주 TOP3 -> 역할 교체. 결과 요약 글을 돌려줘요.
async function runGuild(guild) {
    const thisStart = weekStart(Date.now());
    const from = thisStart - 7 * DAY;
    const ranking = store.weeklyTop(guild.id, from, thisStart);

    // 아직 서버에 있는 사람만 3명
    const winners = [];
    for (const r of ranking) {
        if (winners.length >= 3) break;
        const m = await guild.members.fetch(r.id).catch(() => null);
        if (m && !m.user.bot) winners.push({ member: m, spent: r.spent });
    }

    await guild.members.fetch().catch(() => {}); // 역할 가진 사람 목록을 정확히 보려고
    const lines = [];
    for (let i = 0; i < 3; i++) {
        const def = ROLE_DEFS[i];
        const w = winners[i] || null;
        let role;
        try {
            role = await getRole(guild, def, !!w);
        } catch (e) {
            console.error(`[주간] 역할 만들기 실패 (${def.name}):`, e.message);
            lines.push(`${def.rank}위: 역할을 만들 수 없어요 (봇 권한 확인)`);
            continue;
        }
        if (!role) continue;
        // 지난주 역할 회수
        for (const holder of role.members.values()) {
            if (w && holder.id === w.member.id) continue;
            await holder.roles.remove(role, '주간 TOP 갱신').catch((e) => console.error('[주간] 역할 회수 실패:', e.message));
        }
        // 새 TOP 지급
        if (w) {
            if (!w.member.roles.cache.has(role.id)) {
                await w.member.roles.add(role, `주간 ${def.rank}위`).catch((e) => console.error('[주간] 역할 지급 실패:', e.message));
            }
            lines.push(`${def.rank}위: ${w.member.user.username} (${Number(w.spent).toLocaleString('en-US')}원)`);
        }
    }
    return lines.length ? lines.join('\n') : '지난주 구매 기록이 없어서 지급할 사람이 없어요.';
}

// 새 주가 시작됐는데 아직 처리 안 한 서버만 처리
async function checkDue(client) {
    const key = String(weekStart(Date.now()));
    const meta = store.getMeta('weekly') || {};
    for (const guild of client.guilds.cache.values()) {
        if (meta[guild.id] === key) continue;
        if (!store.hasPurchases(guild.id) && !meta[guild.id]) continue; // 구매 기록이 전혀 없는 서버는 건드리지 않아요
        try {
            const summary = await runGuild(guild);
            console.log(`[주간] ${guild.name} 갱신 완료\n${summary}`);
        } catch (e) {
            console.error('[주간] 갱신 실패:', e);
        }
        meta[guild.id] = key;
        store.setMeta('weekly', meta);
    }
}

function start(client) {
    const tick = () => checkDue(client).catch((e) => console.error('[주간] 확인 오류:', e));
    setTimeout(tick, 20 * 1000); // 켜진 직후 한 번 (재시작으로 월요일을 놓쳐도 바로 처리)
    setInterval(tick, 10 * 60 * 1000).unref();
}

module.exports = { start, runGuild, weekStart, ROLE_DEFS };
