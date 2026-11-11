// 빼빼로데이 이벤트: 11.11초 맞히기 + $보상받기 카드 뽑기
//
// 슬래시 명령어 (관리자)
//   /이벤트패널 [채널]   → 이벤트 패널을 올려요 (채널을 안 고르면 지금 채널)
//   /이벤트로그 채널     → 도전/보상 기록이 올라갈 채널을 정해요
//   /이벤트현황          → 당첨자와 받은 보상을 확인해요 (지급할 때 보기)
//   /이벤트초기화         → 도전 기록·당첨자·보상을 전부 지워요 (로그 채널 설정은 유지)
//   /이벤트테스트         → 기록에 안 남는 연습 도전 (몇 번이든 가능, 성공하면 카드 뽑기까지 테스트)
// 메시지 명령어 (성공자)
//   $보상받기 / $보상선택  → 카드 3장 중 1장 선택 (빼빼로 / 계좌 1,100원 / 꽝)
//
// 판정: 기록을 소수점 둘째 자리까지 잘라서 정확히 11.11초일 때만 성공 (11.110 ~ 11.119초)
//
// 사람이 몰려도 버티게 한 부분
//   - 당첨 판정·기회 차감·보상 확정은 await 없이 한 번에 처리 → 연타·동시 클릭해도 중복 당첨/11번째 당첨 불가
//   - 버튼은 받자마자 바로 응답 (3초 안에 응답 못 해서 "상호작용 실패" 뜨는 일 방지)
//   - 패널 수정은 최대 3초에 한 번만 (디스코드 속도 제한 방지)
//   - 로그는 대기열에 넣고 순서대로 하나씩 전송
//   - 저장은 1초 모아서 한 번 (매 클릭마다 data.json 전체를 쓰지 않음)
//   - 모든 처리에 try/catch → 에러가 나도 봇이 꺼지지 않음

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const store = require('./store');

// ───────── 설정 ─────────
const TARGET_CS = 1111;   // 목표 11.11초 (1/100초 단위)
const MAX_WINNERS = 10;   // 선착순 당첨 인원
const TIMEOUT_SEC = 30;   // 시작 후 이 시간 안에 안 누르면 실패
const COLOR = 0x8b5a2b;   // 초콜릿 색
const GREEN = 0x3ba55d;
const RED = 0xed4245;
const GRAY = 0x5c5c5c;
const YELLOW = 0xfee75c;

const REWARDS = [
    { id: 'pepero', label: '빼빼로', desc: '빼빼로 당첨! 관리자가 곧 지급해 드릴게요.' },
    { id: 'cash', label: '계좌 1,100원', desc: '1,100원 당첨! 관리자가 곧 연락드릴게요.' },
    { id: 'none', label: '꽝', desc: '아쉽지만 꽝이에요. 참여해 주셔서 고마워요!' }
];
const rewardOf = (id) => REWARDS.find((r) => r.id === id);

const FLAG_V2 = 1 << 15;
const FLAG_EPHEMERAL = 1 << 6;

let client = null;
let isAdmin = () => false;

// ───────── 저장 (store meta 'pepero' 에 서버별로 저장, 1초 모아서 저장) ─────────
let state = null;
function S() {
    if (!state) {
        state = store.getMeta('pepero');
        if (!state || typeof state !== 'object') state = {};
    }
    return state;
}
function G(guildId) {
    const s = S();
    if (!s[guildId]) s[guildId] = { logChannelId: null, panel: null, attempts: {}, winners: [], cards: {}, rewards: {} };
    return s[guildId];
}
let saveTimer = null;
function persist() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            store.setMeta('pepero', S());
        } catch (e) {
            console.error('[빼빼로] 저장 실패:', e.message);
        }
    }, 1000);
}

// ───────── 시간 ─────────
// ms → 1/100초 단위로 자름 (11.119초 → 1111)
const toCs = (ms) => Math.floor(ms / 10);
const fmt = (ms) => `${(toCs(ms) / 100).toFixed(2)}초`;
const fmtExact = (ms) => `${(ms / 1000).toFixed(3)}초`;
const isHit = (ms) => toCs(ms) === TARGET_CS;
const nowTag = () => `<t:${Math.floor(Date.now() / 1000)}:T>`;

// ───────── Components V2 헬퍼 ─────────
const text = (content) => new TextDisplayBuilder().setContent(content);
const line = (big = false) =>
    new SeparatorBuilder().setDivider(true).setSpacing(big ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);

function box(title, body, color = COLOR) {
    return new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(text(`### ${title}`))
        .addSeparatorComponents(line())
        .addTextDisplayComponents(text(body));
}
const v2 = (container) => ({ components: [container], flags: FLAG_V2, allowedMentions: { parse: [] } });
const v2e = (container) => ({ components: [container], flags: FLAG_V2 | FLAG_EPHEMERAL, allowedMentions: { parse: [] } });

// ───────── 패널 ─────────
function buildPanel(g) {
    const remaining = Math.max(0, MAX_WINNERS - g.winners.length);
    const challengers = Object.keys(g.attempts).length;
    const closed = remaining === 0;

    const startBtn = new ButtonBuilder()
        .setCustomId('pp_start')
        .setLabel(closed ? '마감되었습니다' : '도전하기')
        .setStyle(closed ? ButtonStyle.Secondary : ButtonStyle.Primary)
        .setDisabled(closed);

    return new ContainerBuilder()
        .setAccentColor(closed ? GRAY : COLOR)
        .addTextDisplayComponents(text('## 11.11초 맞히기'))
        .addTextDisplayComponents(text(
            '**도전하기** → **시작하기**를 누르면 타이머가 시작돼요.\n' +
            '정확히 **11.11초**에 **멈추기**를 누르세요.'
        ))
        .addSeparatorComponents(line(true))
        .addTextDisplayComponents(text(
            `남은 인원 **${remaining}명**\n` +
            `도전 횟수 **1번**\n` +
            `도전한 사람 **${challengers}명**`
        ))
        .addSeparatorComponents(line(true))
        .addTextDisplayComponents(text(
            `-# 선착순 ${MAX_WINNERS}명 · 성공하면 \`$보상받기\`로 보상 카드를 뽑을 수 있어요`
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(startBtn));
}

// 패널 수정은 최대 3초에 한 번 (몰려도 마지막 상태로 한 번만 수정)
const panelTimers = new Map();
const panelLast = new Map();
function refreshPanel(guildId) {
    if (panelTimers.has(guildId)) return;
    const wait = Math.max(0, 3000 - (Date.now() - (panelLast.get(guildId) || 0)));
    panelTimers.set(guildId, setTimeout(async () => {
        panelTimers.delete(guildId);
        panelLast.set(guildId, Date.now());
        const g = G(guildId);
        if (!g.panel) return;
        try {
            const ch = await client.channels.fetch(g.panel.channelId);
            const msg = await ch.messages.fetch(g.panel.messageId);
            await msg.edit(v2(buildPanel(g)));
        } catch (e) {
            console.error('[빼빼로] 패널 갱신 실패:', e.message);
        }
    }, wait));
}

// ───────── 로그 (대기열에 넣고 순서대로 전송) ─────────
const logQueue = [];
let logRunning = false;
function sendLog(guildId, container) {
    const g = G(guildId);
    if (!g.logChannelId) return;
    if (logQueue.length > 500) logQueue.shift(); // 비정상적으로 쌓이면 오래된 것부터 버림
    logQueue.push({ channelId: g.logChannelId, container });
    runLogQueue();
}
async function runLogQueue() {
    if (logRunning) return;
    logRunning = true;
    while (logQueue.length) {
        const { channelId, container } = logQueue.shift();
        try {
            const ch = await client.channels.fetch(channelId);
            await ch.send(v2(container));
        } catch (e) {
            console.error('[빼빼로] 로그 전송 실패:', e.message);
        }
        await new Promise((r) => setTimeout(r, 300));
    }
    logRunning = false;
}

function attemptLog(userId, a, winnerNo, test = false) {
    const result = a.success
        ? (test ? '성공' : `성공 (${winnerNo}번째 당첨)`)
        : a.lateFull ? '11.11초였지만 마감' : '실패';
    return box(
        test ? '11.11초 테스트 기록' : '11.11초 도전 기록',
        `유저 <@${userId}> (\`${userId}\`)\n` +
        `기록 **${a.ms == null ? '시간 초과' : `${fmt(a.ms)}`}**${a.ms == null ? '' : ` (${fmtExact(a.ms)})`}\n` +
        `결과 **${result}**\n` +
        `-# ${test ? '테스트라 실제 기록에는 반영되지 않아요 · ' : ''}${nowTag()}`,
        test ? GRAY : a.success ? GREEN : RED
    );
}

function resultBox(a, winnerNo, test = false) {
    if (a.ms == null) return box('시간 초과', `${TIMEOUT_SEC}초 안에 누르지 않아 실패했어요.`, RED);
    const rec = `기록 **${fmt(a.ms)}**`;
    if (a.success) {
        return test
            ? box('[테스트] 성공', `${rec}\n아래 버튼으로 보상 카드 뽑기도 테스트해 보세요.`, GREEN)
            : box('성공', `${rec}\n**${winnerNo}번째** 당첨자예요.\n\n채팅에 \`$보상받기\`를 입력해서 보상 카드를 뽑으세요.`, GREEN);
    }
    if (a.lateFull) return box('아깝다', `${rec}\n11.11초였지만 선착순이 이미 마감됐어요.`, RED);
    return box(test ? '[테스트] 실패' : '실패', `${rec}\n${test ? '`/이벤트테스트`로 다시 해볼 수 있어요.' : '도전 기회를 모두 사용했어요.'}`, RED);
}

// ───────── 준비 / 타이머 화면 ─────────
function readyBox(test) {
    const goBtn = new ButtonBuilder()
        .setCustomId(test ? 'pp_tgo' : 'pp_go')
        .setLabel('시작하기')
        .setStyle(ButtonStyle.Success);
    return new ContainerBuilder()
        .setAccentColor(COLOR)
        .addTextDisplayComponents(text(test ? '## [테스트] 준비' : '## 준비'))
        .addTextDisplayComponents(text(
            '**시작하기**를 누르면 바로 타이머가 시작돼요.\n' +
            '타이머를 보면서 정확히 **11.11초**에 **멈추기**를 누르세요.'
        ))
        .addSeparatorComponents(line())
        .addTextDisplayComponents(text(
            test
                ? '-# 테스트는 기록에 남지 않고 몇 번이든 할 수 있어요'
                : '-# 시작하기를 누르는 순간 도전 기회 1번이 사용돼요'
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(goBtn));
}

function timerBox(test, elapsedMs) {
    const stopBtn = new ButtonBuilder()
        .setCustomId(test ? 'pp_tstop' : 'pp_stop')
        .setLabel('멈추기')
        .setStyle(ButtonStyle.Danger);
    return new ContainerBuilder()
        .setAccentColor(COLOR)
        .addTextDisplayComponents(text(test ? '## [테스트] 진행 중' : '## 진행 중'))
        .addTextDisplayComponents(text(`# ${(Math.max(0, elapsedMs) / 1000).toFixed(2)}초`))
        .addSeparatorComponents(line())
        .addTextDisplayComponents(text('**11.11초**에 멈추기를 누르세요.'))
        .addTextDisplayComponents(text(`-# 타이머는 1초마다 갱신돼요 · ${TIMEOUT_SEC}초가 지나면 실패`))
        .addActionRowComponents(new ActionRowBuilder().addComponents(stopBtn));
}

// ───────── 타이머 진행 ─────────
// 시작 시각은 디스코드가 "시작하기" 클릭을 받은 시각, 기록은 "멈추기" 클릭을 받은 시각으로 계산해요.
// 화면 숫자는 1초마다 실제 시간 기준으로 다시 계산해서 보여줘요. (수정이 밀리면 그 회차는 건너뛰어서 느려지지 않음)
// 인터랙션 메시지 수정은 봇 전체 속도 제한에 포함되지 않아서, 여러 명이 동시에 해도 서로 밀리지 않아요.
const TICK_MS = 1000;
const runs = new Map(); // `${guildId}:${userId}:r|t` → { start, timer, busy, current, stopped }
const runKey = (guildId, uid, test) => `${guildId}:${uid}:${test ? 't' : 'r'}`;

function startRun(key, ia, start, test, onTimeout) {
    const old = runs.get(key);
    if (old) finishRun(key);
    const run = { start, timer: null, busy: false, current: Promise.resolve(), stopped: false };
    runs.set(key, run);
    const tick = () => {
        if (run.stopped) return;
        const elapsed = Date.now() - start;
        if (elapsed >= TIMEOUT_SEC * 1000) {
            finishRun(key);
            onTimeout(run);
            return;
        }
        if (!run.busy) {
            run.busy = true;
            run.current = ia.editReply(v2(timerBox(test, elapsed)))
                .catch(() => {})
                .finally(() => { run.busy = false; });
        }
        run.timer = setTimeout(tick, TICK_MS - ((Date.now() - start) % TICK_MS));
    };
    run.timer = setTimeout(tick, TICK_MS - ((Date.now() - start) % TICK_MS));
    return run;
}

function finishRun(key) {
    const run = runs.get(key);
    if (!run) return null;
    run.stopped = true;
    clearTimeout(run.timer);
    runs.delete(key);
    return run;
}

// ───────── 카드 ─────────
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function buildCards(uid, test = false) {
    const row = new ActionRowBuilder().addComponents(
        [0, 1, 2].map((i) =>
            new ButtonBuilder()
                .setCustomId(`${test ? 'pp_tcard' : 'pp_card'}:${uid}:${i}`)
                .setLabel(`카드 ${i + 1}`)
                .setStyle(ButtonStyle.Secondary)
        )
    );
    return new ContainerBuilder()
        .setAccentColor(COLOR)
        .addTextDisplayComponents(text(test ? '## [테스트] 보상 카드 뽑기' : '## 보상 카드 뽑기'))
        .addTextDisplayComponents(text(`<@${uid}>님, 세 장 중 **한 장만** 고를 수 있어요.`))
        .addSeparatorComponents(line(true))
        .addTextDisplayComponents(text('빼빼로 · 계좌 1,100원 · 꽝'))
        .addSeparatorComponents(line())
        .addActionRowComponents(row);
}

function buildCardResult(uid, order, picked, test = false) {
    const chosen = rewardOf(order[picked]);
    const row = new ActionRowBuilder().addComponents(
        order.map((id, i) =>
            new ButtonBuilder()
                .setCustomId(`pp_done:${i}`)
                .setLabel(rewardOf(id).label)
                .setStyle(i === picked ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(true)
        )
    );
    return new ContainerBuilder()
        .setAccentColor(chosen.id === 'none' ? GRAY : GREEN)
        .addTextDisplayComponents(text(test ? '## [테스트] 카드 결과' : '## 카드 결과'))
        .addTextDisplayComponents(text(`<@${uid}>님은 **카드 ${picked + 1}**을 골랐어요.`))
        .addSeparatorComponents(line(true))
        .addTextDisplayComponents(text(`### ${chosen.label}\n${test ? '테스트라 실제로 지급되지 않아요.' : chosen.desc}`))
        .addSeparatorComponents(line())
        .addActionRowComponents(row);
}

// ───────── 슬래시 명령어 ─────────
const SLASH = ['이벤트패널', '이벤트로그', '이벤트현황', '이벤트초기화', '이벤트테스트', '당첨지정', '당첨제거'];

function commands() {
    const admin = (b) => b.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
    return [
        admin(new SlashCommandBuilder().setName('이벤트패널').setDescription('11.11초 이벤트 패널을 올립니다.')
            .addChannelOption((o) => o.setName('채널').setDescription('패널을 올릴 채널 (안 고르면 지금 채널)')
                .addChannelTypes(ChannelType.GuildText).setRequired(false))),
        admin(new SlashCommandBuilder().setName('이벤트로그').setDescription('11.11초 이벤트 기록이 올라갈 로그 채널을 정합니다.')
            .addChannelOption((o) => o.setName('채널').setDescription('로그 채널')
                .addChannelTypes(ChannelType.GuildText).setRequired(true))),
        admin(new SlashCommandBuilder().setName('이벤트현황').setDescription('11.11초 이벤트 당첨자와 보상을 확인합니다.')),
        admin(new SlashCommandBuilder().setName('이벤트초기화').setDescription('11.11초 이벤트 기록을 전부 지웁니다. (로그 채널 설정은 유지)')),
        admin(new SlashCommandBuilder().setName('이벤트테스트').setDescription('기록에 안 남는 연습 도전을 합니다. (몇 번이든 가능)')),
        admin(new SlashCommandBuilder().setName('당첨지정').setDescription('특정 유저를 11.11초 성공자로 지정합니다. ($보상받기 사용 가능)')
            .addUserOption((o) => o.setName('유저').setDescription('성공 처리할 유저').setRequired(true))),
        admin(new SlashCommandBuilder().setName('당첨제거').setDescription('특정 유저의 당첨을 취소합니다. (받은 보상 기록도 지워져요)')
            .addUserOption((o) => o.setName('유저').setDescription('당첨을 취소할 유저').setRequired(true))
            .addBooleanOption((o) => o.setName('기회돌려주기').setDescription('도전 기회도 다시 줄까요? (기본: 아니요)').setRequired(false)))
    ];
}

async function handleSlash(interaction) {
    if (!isAdmin(interaction.member)) {
        await interaction.reply({ content: '이 명령어를 사용할 권한이 없습니다.', flags: FLAG_EPHEMERAL }).catch(() => {});
        return;
    }
    const guildId = interaction.guild.id;
    const g = G(guildId);
    const name = interaction.commandName;

    if (name === '이벤트패널') {
        const ch = interaction.options.getChannel('채널') || interaction.channel;
        await interaction.deferReply({ flags: FLAG_EPHEMERAL });
        try {
            const sent = await ch.send(v2(buildPanel(g)));
            g.panel = { channelId: sent.channel.id, messageId: sent.id };
            persist();
            await interaction.editReply({ content: `${ch}에 패널을 올렸어요.` });
        } catch (e) {
            console.error('[빼빼로] 패널 전송 실패:', e.message);
            await interaction.editReply({ content: `${ch}에 패널을 올리지 못했어요. 봇 권한(메시지 보내기)을 확인해 주세요.` });
        }
        return;
    }

    if (name === '이벤트로그') {
        const ch = interaction.options.getChannel('채널');
        g.logChannelId = ch.id;
        persist();
        await interaction.reply(v2e(box('로그 채널 설정 완료', `앞으로 도전 기록과 보상 기록이 ${ch}에 올라가요.`)));
        return;
    }

    if (name === '이벤트현황') {
        const lines = g.winners.map((uid, i) => {
            const a = g.attempts[uid];
            const r = g.rewards[uid];
            return `**${i + 1}.** <@${uid}> · ${a && a.manual ? '관리자 지정' : a && a.ms != null ? fmt(a.ms) : '-'} · ${r ? rewardOf(r.id).label : '카드 미선택'}`;
        });
        await interaction.reply(v2e(box(
            '이벤트 현황',
            `도전한 사람 **${Object.keys(g.attempts).length}명** · 당첨 **${g.winners.length}/${MAX_WINNERS}명**\n\n` +
            (lines.length ? lines.join('\n') : '아직 당첨자가 없어요.')
        )));
        return;
    }

    if (name === '이벤트초기화') {
        Object.assign(g, { attempts: {}, winners: [], cards: {}, rewards: {} });
        for (const key of [...runs.keys()]) {
            if (key.startsWith(`${guildId}:`) && key.endsWith(':r')) finishRun(key);
        }
        persist();
        refreshPanel(guildId);
        await interaction.reply(v2e(box('초기화 완료', '도전 기록, 당첨자, 보상 기록을 모두 지웠어요.')));
        return;
    }

    if (name === '당첨지정') {
        const target = interaction.options.getUser('유저');
        if (target.bot) {
            await interaction.reply(v2e(box('지정할 수 없어요', '봇은 당첨자로 지정할 수 없어요.', RED)));
            return;
        }
        if (g.winners.includes(target.id)) {
            await interaction.reply(v2e(box('이미 당첨자예요', `${target}님은 이미 성공자 목록에 있어요.`, GRAY)));
            return;
        }
        // 진행 중인 도전이 있으면 끝내고 성공자로 등록 (선착순 인원이 다 찼어도 관리자 지정은 추가돼요)
        finishRun(runKey(guildId, target.id, false));
        const a = g.attempts[target.id] || { start: null, ms: null };
        Object.assign(a, { success: true, done: true, lateFull: false, manual: true });
        g.attempts[target.id] = a;
        g.winners.push(target.id);
        persist();
        refreshPanel(guildId);
        await interaction.reply(v2e(box(
            '당첨 지정 완료',
            `${target}님을 성공자로 지정했어요. (${g.winners.length}번째)\n이제 \`$보상받기\`를 사용할 수 있어요.`,
            GREEN
        )));
        sendLog(guildId, box(
            '당첨 지정',
            `유저 ${target} (\`${target.id}\`)\n처리한 관리자 ${interaction.user}\n결과 **관리자 지정 성공 (${g.winners.length}번째)**\n-# ${nowTag()}`,
            GREEN
        ));
        return;
    }

    if (name === '당첨제거') {
        const target = interaction.options.getUser('유저');
        const giveBack = interaction.options.getBoolean('기회돌려주기') === true;
        const idx = g.winners.indexOf(target.id);
        if (idx === -1 && !(giveBack && g.attempts[target.id])) {
            await interaction.reply(v2e(box('당첨자가 아니에요', `${target}님은 성공자 목록에 없어요.`, GRAY)));
            return;
        }
        const hadReward = g.rewards[target.id] ? rewardOf(g.rewards[target.id].id).label : null;
        if (idx !== -1) g.winners.splice(idx, 1);
        delete g.cards[target.id];
        delete g.rewards[target.id];
        if (giveBack) {
            finishRun(runKey(guildId, target.id, false));
            delete g.attempts[target.id];
        } else if (g.attempts[target.id]) {
            g.attempts[target.id].success = false;
            g.attempts[target.id].removed = true;
        }
        persist();
        refreshPanel(guildId);
        const body =
            `${target}님의 당첨을 취소했어요.\n` +
            (hadReward ? `받았던 보상 **${hadReward}** 기록도 지웠어요.\n` : '') +
            (giveBack ? '도전 기회를 다시 줬어요.' : '도전 기회는 돌려주지 않았어요.');
        await interaction.reply(v2e(box('당첨 제거 완료', body, RED)));
        sendLog(guildId, box(
            '당첨 제거',
            `유저 ${target} (\`${target.id}\`)\n처리한 관리자 ${interaction.user}\n` +
            (hadReward ? `취소된 보상 **${hadReward}**\n` : '') +
            `도전 기회 **${giveBack ? '돌려줌' : '그대로'}**\n-# ${nowTag()}`,
            RED
        ));
        return;
    }

    if (name === '이벤트테스트') {
        // 기록·당첨자·패널에 영향 없음. 시작하기를 누르면 타이머 시작
        await interaction.reply(v2e(readyBox(true)));
    }
}

// ───────── 메시지 명령어 ($보상받기) ─────────
const cmdCooldown = new Map();
function cooldownOk(userId, ms = 3000) {
    const now = Date.now();
    if (now - (cmdCooldown.get(userId) || 0) < ms) return false;
    cmdCooldown.set(userId, now);
    if (cmdCooldown.size > 5000) cmdCooldown.clear();
    return true;
}

async function handleMessage(message) {
    if (!message.guild || message.author.bot) return false;
    const cmd = message.content.trim().split(/\s+/)[0];
    if (cmd !== '$보상받기' && cmd !== '$보상선택') return false;

    try {
        if (!cooldownOk(message.author.id)) return true;
        const g = G(message.guild.id);
        const uid = message.author.id;
        const reply = (c) => message.reply(v2(c)).catch(() => {});

        if (!g.winners.includes(uid)) {
            await reply(box('사용할 수 없어요', '11.11초 맞히기 성공자만 사용할 수 있어요.', RED));
            return true;
        }
        if (g.rewards[uid]) {
            await reply(box('이미 보상을 받았어요', `받은 보상: **${rewardOf(g.rewards[uid].id).label}**`));
            return true;
        }
        // 카드 순서는 처음 한 번만 섞어서 저장 → 명령어를 다시 써도 순서가 안 바뀜
        if (!g.cards[uid]) {
            g.cards[uid] = shuffle(REWARDS.map((r) => r.id));
            persist();
        }
        await reply(buildCards(uid));
    } catch (e) {
        console.error('[빼빼로] $보상받기 오류:', e);
    }
    return true;
}

// ───────── 버튼 / 슬래시 처리 ─────────

// 도전할 수 없는 상태면 안내 박스, 가능하면 null
function checkBlocked(g, uid) {
    if (g.winners.length >= MAX_WINNERS) return box('마감', '선착순 인원이 모두 찼어요.', GRAY);
    const prev = g.attempts[uid];
    if (prev) {
        const t = prev.manual ? '관리자 지정' : prev.ms != null ? fmt(prev.ms) : prev.done ? '시간 초과' : '진행 중';
        return box('이미 도전했어요', `도전 기회는 1번뿐이에요.\n내 기록: **${t}**`, RED);
    }
    return null;
}

async function handleInteraction(interaction) {
    const isOurSlash = interaction.isChatInputCommand() && SLASH.includes(interaction.commandName);
    const isOurButton = interaction.isButton() && /^pp_/.test(interaction.customId);
    if (!isOurSlash && !isOurButton) return false;
    if (!interaction.guild) return true;

    try {
        if (isOurSlash) {
            await handleSlash(interaction);
            return true;
        }

        const guildId = interaction.guild.id;
        const g = G(guildId);
        const uid = interaction.user.id;
        const id = interaction.customId;

        // ── 패널의 도전하기 → 준비 화면 (아직 기회 안 씀) ──
        if (id === 'pp_start') {
            const blocked = checkBlocked(g, uid);
            await interaction.reply(v2e(blocked || readyBox(false))).catch(() => {});
            return true;
        }

        // ── 시작하기 → 기회 사용 + 타이머 시작 ──
        if (id === 'pp_go') {
            const blocked = checkBlocked(g, uid);
            if (blocked) {
                await interaction.update(v2(blocked)).catch(() => {});
                return true;
            }
            // await 전에 바로 기록 → 연타해도 기회는 1번만 쓰임
            const start = interaction.createdTimestamp;
            g.attempts[uid] = { start, ms: null, success: false, done: false };
            persist();
            refreshPanel(guildId);

            await interaction.update(v2(timerBox(false, 0))).catch((e) => console.error('[빼빼로] 시작 응답 실패:', e.message));
            startRun(runKey(guildId, uid, false), interaction, start, false, async (run) => {
                const a = g.attempts[uid];
                if (!a || a.done) return;
                a.done = true;
                persist();
                await run.current;
                interaction.editReply(v2(resultBox(a))).catch(() => {});
                sendLog(guildId, attemptLog(uid, a));
            });
            return true;
        }

        // ── 멈추기 ──
        if (id === 'pp_stop') {
            const a = g.attempts[uid];
            if (!a || a.done || a.start == null) {
                await interaction.update(v2(box('끝난 도전', '이미 종료된 도전이에요.', GRAY))).catch(() => {});
                return true;
            }
            // 여기서부터 await 전까지 한 번에 처리 → 동시에 눌러도 당첨자가 10명을 넘지 않음
            a.done = true;
            const run = finishRun(runKey(guildId, uid, false));
            const ms = interaction.createdTimestamp - a.start;
            let winnerNo = null;
            if (ms <= TIMEOUT_SEC * 1000) {
                a.ms = ms;
                if (isHit(ms) && g.winners.length < MAX_WINNERS) {
                    a.success = true;
                    g.winners.push(uid);
                    winnerNo = g.winners.length;
                } else if (isHit(ms)) {
                    a.lateFull = true;
                }
            }
            persist();
            refreshPanel(guildId);

            // 타이머 수정이 결과를 덮어쓰지 않게, 진행 중인 수정이 끝난 뒤 결과 표시
            await interaction.deferUpdate().catch(() => {});
            if (run) await run.current;
            await interaction.editReply(v2(resultBox(a, winnerNo))).catch((e) => console.error('[빼빼로] 결과 응답 실패:', e.message));
            sendLog(guildId, attemptLog(uid, a, winnerNo));
            return true;
        }

        // ── 테스트 시작하기 ──
        if (id === 'pp_tgo') {
            const start = interaction.createdTimestamp;
            const key = runKey(guildId, uid, true);
            await interaction.update(v2(timerBox(true, 0))).catch(() => {});
            startRun(key, interaction, start, true, async (run) => {
                await run.current;
                interaction.editReply(v2(resultBox({ ms: null }, null, true))).catch(() => {});
            });
            return true;
        }

        // ── 테스트 멈추기 ──
        if (id === 'pp_tstop') {
            const run = finishRun(runKey(guildId, uid, true));
            if (!run) {
                await interaction.update(v2(box('끝난 테스트', '`/이벤트테스트`로 다시 시작해 주세요.', GRAY))).catch(() => {});
                return true;
            }
            const ms = interaction.createdTimestamp - run.start;
            const a = ms <= TIMEOUT_SEC * 1000 ? { ms, success: isHit(ms) } : { ms: null, success: false };

            await interaction.deferUpdate().catch(() => {});
            await run.current;
            const payload = v2(resultBox(a, null, true));
            if (a.success) payload.components.push(buildCards(uid, true));
            await interaction.editReply(payload).catch((e) => console.error('[빼빼로] 테스트 응답 실패:', e.message));
            sendLog(guildId, attemptLog(uid, a, null, true)); // 로그 채널이 잘 되는지도 같이 확인
            return true;
        }

        // ── 카드 선택 (실제 / 테스트) ──
        if (id.startsWith('pp_card:') || id.startsWith('pp_tcard:')) {
            const test = id.startsWith('pp_tcard:');
            const [, owner, idx] = id.split(':');
            const picked = Number(idx);
            if (owner !== uid) {
                await interaction.reply(v2e(box('내 카드가 아니에요', '`$보상받기`로 내 카드를 열어 주세요.', RED))).catch(() => {});
                return true;
            }
            if (!(picked >= 0 && picked <= 2)) return true;

            if (test) {
                const order = shuffle(REWARDS.map((r) => r.id));
                await interaction.update(v2(buildCardResult(uid, order, picked, true))).catch(() => {});
                return true;
            }

            if (g.rewards[uid]) {
                await interaction.reply(v2e(box('이미 보상을 받았어요', '카드는 한 번만 고를 수 있어요.', RED))).catch(() => {});
                return true;
            }
            const order = g.cards[uid];
            if (!order) {
                await interaction.reply(v2e(box('카드 오류', '`$보상받기`를 다시 입력해 주세요.', RED))).catch(() => {});
                return true;
            }
            // await 전에 바로 확정 → 연타해도 보상은 1번만
            const rewardId = order[picked];
            g.rewards[uid] = { id: rewardId, card: picked + 1, ts: Date.now() };
            persist();

            await interaction.update(v2(buildCardResult(uid, order, picked))).catch((e) => console.error('[빼빼로] 카드 응답 실패:', e.message));

            sendLog(guildId, box(
                '보상 카드 기록',
                `유저 <@${uid}> (\`${uid}\`)\n` +
                `선택 카드 **${picked + 1}번**\n` +
                `보상 **${rewardOf(rewardId).label}**\n` +
                (rewardId === 'none' ? '' : '**지급 필요**\n') +
                `-# ${nowTag()}`,
                rewardId === 'none' ? GRAY : YELLOW
            ));
            return true;
        }
    } catch (e) {
        console.error('[빼빼로] 처리 오류:', e);
        if (!interaction.replied && !interaction.deferred) {
            interaction.reply({ content: '잠시 후 다시 시도해 주세요.', flags: FLAG_EPHEMERAL }).catch(() => {});
        }
    }
    return true;
}

function init(c, opts = {}) {
    client = c;
    if (typeof opts.isAdmin === 'function') isAdmin = opts.isAdmin;
    // 재시작 전에 진행 중이던 도전은 실패 처리 (기회는 이미 사용됨)
    let changed = false;
    for (const g of Object.values(S())) {
        for (const a of Object.values(g.attempts || {})) {
            if (!a.done) {
                a.done = true;
                changed = true;
            }
        }
    }
    if (changed) persist();
}

module.exports = { init, commands, handleInteraction, handleMessage };
