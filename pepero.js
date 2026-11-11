// 🍫 빼빼로데이 이벤트: 11.11초 맞히기 + $보상받기 카드 뽑기
//
// 명령어 (관리자)
//   $이벤트패널          → 지금 채널에 이벤트 패널을 올려요
//   $이벤트로그 #채널     → 도전/보상 기록이 올라갈 채널을 정해요
//   $이벤트현황          → 당첨자와 받은 보상을 확인해요 (지급할 때 보기)
//   $이벤트초기화         → 도전 기록·당첨자·보상을 전부 지워요 (로그 채널 설정은 유지)
// 명령어 (성공자)
//   $보상받기 / $보상선택  → 카드 3장 중 1장 선택 (빼빼로 / 계좌 1,100원 / 꽝)
//
// 사람이 몰려도 버티게 한 부분
//   - 당첨 판정·기회 차감·보상 확정은 await 없이 한 번에 처리 → 연타·동시 클릭해도 중복 당첨/11번째 당첨 불가
//   - 버튼은 받자마자 바로 응답 (3초 안에 응답 못 해서 "상호작용 실패" 뜨는 일 방지)
//   - 패널 수정은 최대 3초에 한 번만 (디스코드 속도 제한 방지)
//   - 로그는 대기열에 넣고 순서대로 하나씩 전송
//   - 저장은 1초 모아서 한 번 (매 클릭마다 data.json 전체를 쓰지 않음)
//   - 모든 처리에 try/catch → 에러가 나도 봇이 꺼지지 않음

const {
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
const TARGET = 11.11;     // 목표 시간(초)
const TOLERANCE = 0.03;   // 허용 오차(초) → 11.08 ~ 11.14초면 성공
const MAX_WINNERS = 10;   // 선착순 당첨 인원
const TIMEOUT_SEC = 30;   // 시작 후 이 시간 안에 안 누르면 실패
const COLOR = 0x8b5a2b;   // 초콜릿 색
const GREEN = 0x3ba55d;
const RED = 0xed4245;
const GRAY = 0x5c5c5c;

const REWARDS = [
    { id: 'pepero', label: '🍫 빼빼로', desc: '빼빼로 당첨! 관리자가 곧 지급해 드릴게요.' },
    { id: 'cash', label: '💸 계좌 1,100원', desc: '1,100원 당첨! 관리자가 곧 연락드릴게요.' },
    { id: 'none', label: '💨 꽝', desc: '아쉽지만 꽝이에요. 참여해 주셔서 고마워요!' }
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
const v2 = (container, extra = {}) => ({ components: [container], flags: FLAG_V2, allowedMentions: { parse: [] }, ...extra });
const v2e = (container) => ({ components: [container], flags: FLAG_V2 | FLAG_EPHEMERAL, allowedMentions: { parse: [] } });
const sec = (n) => `${n.toFixed(3)}초`;
const signed = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(3)}초`;
const nowTag = () => `<t:${Math.floor(Date.now() / 1000)}:T>`;

// ───────── 패널 ─────────
function buildPanel(g) {
    const remaining = Math.max(0, MAX_WINNERS - g.winners.length);
    const challengers = Object.keys(g.attempts).length;
    const closed = remaining === 0;

    const startBtn = new ButtonBuilder()
        .setCustomId('pp_start')
        .setLabel(closed ? '마감되었습니다' : '도전 시작')
        .setEmoji(closed ? '🔒' : '⏱️')
        .setStyle(closed ? ButtonStyle.Secondary : ButtonStyle.Primary)
        .setDisabled(closed);

    return new ContainerBuilder()
        .setAccentColor(closed ? GRAY : COLOR)
        .addTextDisplayComponents(text('## 🍫 11.11초 맞히기 챌린지'))
        .addTextDisplayComponents(text(
            '**도전 시작**을 누르고 속으로 시간을 세다가,\n' +
            '정확히 **11.11초**가 됐을 때 **멈추기**를 누르세요.\n' +
            '타이머는 보이지 않아요. 오직 감으로만!'
        ))
        .addSeparatorComponents(line(true))
        .addTextDisplayComponents(text(
            `🎯 남은 인원 **${remaining}명**\n` +
            `🔁 도전 횟수 **1번**\n` +
            `👥 도전한 사람 **${challengers}명**`
        ))
        .addSeparatorComponents(line(true))
        .addTextDisplayComponents(text(
            `-# 성공 범위 ${(TARGET - TOLERANCE).toFixed(2)}초 ~ ${(TARGET + TOLERANCE).toFixed(2)}초 · 선착순 ${MAX_WINNERS}명 · ${TIMEOUT_SEC}초 안에 안 누르면 실패\n` +
            '-# 성공하면 `$보상받기` 명령어로 보상 카드를 뽑을 수 있어요'
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

function attemptLog(userId, a, winnerNo) {
    const result = a.success ? `✅ 성공 (${winnerNo}번째 당첨)` : a.lateFull ? '⚠️ 범위 안이지만 마감' : '❌ 실패';
    return box(
        '⏱️ 11.11초 도전 기록',
        `👤 <@${userId}> (\`${userId}\`)\n` +
        `⏱️ 기록 **${a.time == null ? '시간 초과' : sec(a.time)}**\n` +
        `📏 오차 ${a.time == null ? '-' : signed(a.time - TARGET)}\n` +
        `📌 결과 ${result}\n` +
        `-# ${nowTag()}`,
        a.success ? GREEN : RED
    );
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

function buildCards(uid) {
    const row = new ActionRowBuilder().addComponents(
        [0, 1, 2].map((i) =>
            new ButtonBuilder()
                .setCustomId(`pp_card:${uid}:${i}`)
                .setLabel(`카드 ${i + 1}`)
                .setEmoji('🎴')
                .setStyle(ButtonStyle.Secondary)
        )
    );
    return new ContainerBuilder()
        .setAccentColor(COLOR)
        .addTextDisplayComponents(text('## 🎴 보상 카드 뽑기'))
        .addTextDisplayComponents(text(`<@${uid}>님, 11.11초 성공을 축하해요!\n세 장 중 **한 장만** 고를 수 있어요.`))
        .addSeparatorComponents(line(true))
        .addTextDisplayComponents(text('🍫 빼빼로 · 💸 계좌 1,100원 · 💨 꽝'))
        .addSeparatorComponents(line())
        .addActionRowComponents(row);
}

function buildCardResult(uid, order, picked) {
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
        .addTextDisplayComponents(text('## 🎴 카드 결과'))
        .addTextDisplayComponents(text(`<@${uid}>님은 **카드 ${picked + 1}**을 골랐어요.`))
        .addSeparatorComponents(line(true))
        .addTextDisplayComponents(text(`### ${chosen.label}\n${chosen.desc}`))
        .addSeparatorComponents(line())
        .addActionRowComponents(row);
}

// ───────── 메시지 명령어 ─────────
const cmdCooldown = new Map();
function cooldownOk(userId, ms = 3000) {
    const now = Date.now();
    if (now - (cmdCooldown.get(userId) || 0) < ms) return false;
    cmdCooldown.set(userId, now);
    if (cmdCooldown.size > 5000) cmdCooldown.clear();
    return true;
}

const COMMANDS = new Set(['$이벤트패널', '$이벤트로그', '$이벤트현황', '$이벤트초기화', '$보상받기', '$보상선택']);

async function handleMessage(message) {
    if (!message.guild || message.author.bot) return false;
    const args = message.content.trim().split(/\s+/);
    const cmd = args[0];
    if (!COMMANDS.has(cmd)) return false;

    try {
        const guildId = message.guild.id;
        const g = G(guildId);
        const reply = (c) => message.reply(v2(c)).catch(() => {});

        if (cmd === '$보상받기' || cmd === '$보상선택') {
            if (!cooldownOk(message.author.id)) return true;
            const uid = message.author.id;
            if (!g.winners.includes(uid)) {
                return reply(box('🔒 사용할 수 없어요', '11.11초 챌린지 성공자만 사용할 수 있어요.', RED)), true;
            }
            if (g.rewards[uid]) {
                return reply(box('📦 이미 보상을 받았어요', `받은 보상: **${rewardOf(g.rewards[uid].id).label}**`)), true;
            }
            // 카드 순서는 처음 한 번만 섞어서 저장 → 명령어를 다시 써도 순서가 안 바뀜
            if (!g.cards[uid]) {
                g.cards[uid] = shuffle(REWARDS.map((r) => r.id));
                persist();
            }
            await reply(buildCards(uid));
            return true;
        }

        // 여기부터 관리자 전용
        if (!isAdmin(message.member)) {
            await message.reply({ content: '해당 명령어를 사용할 권한이 없습니다.', allowedMentions: { repliedUser: false } }).catch(() => {});
            return true;
        }

        if (cmd === '$이벤트패널') {
            const sent = await message.channel.send(v2(buildPanel(g)));
            g.panel = { channelId: sent.channel.id, messageId: sent.id };
            persist();
            message.delete().catch(() => {});
            return true;
        }

        if (cmd === '$이벤트로그') {
            const ch = message.mentions.channels.first() || message.guild.channels.cache.get(args[1]);
            if (!ch) {
                await reply(box('⚠️ 사용법', '`$이벤트로그 #채널`', RED));
                return true;
            }
            g.logChannelId = ch.id;
            persist();
            await reply(box('✅ 로그 채널 설정 완료', `앞으로 도전 기록과 보상 기록이 ${ch}에 올라가요.`));
            return true;
        }

        if (cmd === '$이벤트현황') {
            const lines = g.winners.map((uid, i) => {
                const a = g.attempts[uid];
                const r = g.rewards[uid];
                return `**${i + 1}.** <@${uid}> · ${a && a.time != null ? sec(a.time) : '-'} · ${r ? rewardOf(r.id).label : '⏳ 카드 미선택'}`;
            });
            await reply(box(
                '📋 이벤트 현황',
                `👥 도전한 사람 **${Object.keys(g.attempts).length}명** · 🎯 당첨 **${g.winners.length}/${MAX_WINNERS}명**\n\n` +
                (lines.length ? lines.join('\n') : '아직 당첨자가 없어요.')
            ));
            return true;
        }

        if (cmd === '$이벤트초기화') {
            Object.assign(g, { attempts: {}, winners: [], cards: {}, rewards: {} });
            for (const [key, t] of pending) {
                if (key.startsWith(`${guildId}:`)) {
                    clearTimeout(t);
                    pending.delete(key);
                }
            }
            persist();
            refreshPanel(guildId);
            await reply(box('🔄 초기화 완료', '도전 기록, 당첨자, 보상 기록을 모두 지웠어요.'));
            return true;
        }
    } catch (e) {
        console.error('[빼빼로] 명령어 처리 오류:', e);
    }
    return true;
}

// ───────── 버튼 ─────────
const pending = new Map(); // `${guildId}:${userId}` → 시간 초과 타이머

async function handleInteraction(interaction) {
    if (!interaction.isButton() || !/^pp_/.test(interaction.customId)) return false;
    if (!interaction.guild) return true;

    try {
        const guildId = interaction.guild.id;
        const g = G(guildId);
        const uid = interaction.user.id;

        // ── 도전 시작 ──
        if (interaction.customId === 'pp_start') {
            if (g.winners.length >= MAX_WINNERS) {
                await interaction.reply(v2e(box('🔒 마감', '선착순 인원이 모두 찼어요.', GRAY))).catch(() => {});
                return true;
            }
            const prev = g.attempts[uid];
            if (prev) {
                const t = prev.time != null ? sec(prev.time) : prev.done ? '시간 초과' : '진행 중';
                await interaction.reply(v2e(box('🚫 이미 도전했어요', `도전 기회는 1번뿐이에요.\n내 기록: **${t}**`, RED))).catch(() => {});
                return true;
            }

            // await 전에 바로 기록 → 연타해도 기회는 1번만 쓰임
            // 시간은 디스코드가 클릭을 받은 시각 기준 → 사람마다 핑 차이 최소화
            g.attempts[uid] = { start: interaction.createdTimestamp, time: null, success: false, done: false };
            persist();
            refreshPanel(guildId);

            const stopBtn = new ButtonBuilder().setCustomId('pp_stop').setLabel('멈추기').setEmoji('🛑').setStyle(ButtonStyle.Danger);
            const c = new ContainerBuilder()
                .setAccentColor(COLOR)
                .addTextDisplayComponents(text('## ⏱️ 시작!'))
                .addTextDisplayComponents(text('속으로 세다가 **11.11초**에 멈추기를 누르세요.'))
                .addSeparatorComponents(line())
                .addTextDisplayComponents(text(`-# ${TIMEOUT_SEC}초 안에 안 누르면 실패 처리돼요`))
                .addActionRowComponents(new ActionRowBuilder().addComponents(stopBtn));
            await interaction.reply(v2e(c)).catch((e) => console.error('[빼빼로] 시작 응답 실패:', e.message));

            const key = `${guildId}:${uid}`;
            pending.set(key, setTimeout(() => {
                pending.delete(key);
                const a = g.attempts[uid];
                if (!a || a.done) return;
                a.done = true;
                persist();
                interaction.editReply(v2(box('⌛ 시간 초과', `${TIMEOUT_SEC}초 안에 누르지 않아 실패했어요.`, RED))).catch(() => {});
                sendLog(guildId, attemptLog(uid, a));
            }, TIMEOUT_SEC * 1000 + 500));
            return true;
        }

        // ── 멈추기 ──
        if (interaction.customId === 'pp_stop') {
            const a = g.attempts[uid];
            if (!a || a.done) {
                await interaction.update(v2(box('🚫 끝난 도전', '이미 종료된 도전이에요.', GRAY))).catch(() => {});
                return true;
            }
            // 여기서부터 await 전까지 한 번에 처리 → 동시에 눌러도 당첨자가 10명을 넘지 않음
            a.done = true;
            const key = `${guildId}:${uid}`;
            clearTimeout(pending.get(key));
            pending.delete(key);

            const elapsed = (interaction.createdTimestamp - a.start) / 1000;
            let winnerNo = null;
            if (elapsed <= TIMEOUT_SEC) {
                a.time = elapsed;
                const inRange = Math.abs(elapsed - TARGET) <= TOLERANCE + 1e-9;
                if (inRange && g.winners.length < MAX_WINNERS) {
                    a.success = true;
                    g.winners.push(uid);
                    winnerNo = g.winners.length;
                } else if (inRange) {
                    a.lateFull = true;
                }
            }
            persist();
            refreshPanel(guildId);

            let c;
            if (a.time == null) {
                c = box('⌛ 시간 초과', `${TIMEOUT_SEC}초가 지나서 실패했어요.`, RED);
            } else if (a.success) {
                c = box(
                    '🎉 성공!',
                    `기록 **${sec(a.time)}** (오차 ${signed(a.time - TARGET)})\n` +
                    `**${winnerNo}번째** 당첨자예요!\n\n` +
                    '채팅에 `$보상받기`를 입력해서 보상 카드를 뽑으세요.',
                    GREEN
                );
            } else {
                c = box(
                    a.lateFull ? '😢 아깝다!' : '❌ 실패',
                    `기록 **${sec(a.time)}** (오차 ${signed(a.time - TARGET)})\n` +
                    (a.lateFull ? '범위 안이었지만 선착순이 이미 마감됐어요.' : '도전 기회를 모두 사용했어요.'),
                    RED
                );
            }
            await interaction.update(v2(c)).catch((e) => console.error('[빼빼로] 결과 응답 실패:', e.message));
            sendLog(guildId, attemptLog(uid, a, winnerNo));
            return true;
        }

        // ── 카드 선택 ──
        if (interaction.customId.startsWith('pp_card:')) {
            const [, owner, idx] = interaction.customId.split(':');
            if (owner !== uid) {
                await interaction.reply(v2e(box('🚫 내 카드가 아니에요', '`$보상받기`로 내 카드를 열어 주세요.', RED))).catch(() => {});
                return true;
            }
            if (g.rewards[uid]) {
                await interaction.reply(v2e(box('📦 이미 보상을 받았어요', '카드는 한 번만 고를 수 있어요.', RED))).catch(() => {});
                return true;
            }
            const order = g.cards[uid];
            const picked = Number(idx);
            if (!order || !(picked >= 0 && picked <= 2)) {
                await interaction.reply(v2e(box('⚠️ 카드 오류', '`$보상받기`를 다시 입력해 주세요.', RED))).catch(() => {});
                return true;
            }
            // await 전에 바로 확정 → 연타해도 보상은 1번만
            const rewardId = order[picked];
            g.rewards[uid] = { id: rewardId, card: picked + 1, ts: Date.now() };
            persist();

            await interaction.update(v2(buildCardResult(uid, order, picked))).catch((e) => console.error('[빼빼로] 카드 응답 실패:', e.message));

            const r = rewardOf(rewardId);
            sendLog(guildId, box(
                '🎴 보상 카드 기록',
                `👤 <@${uid}> (\`${uid}\`)\n` +
                `🎴 선택 카드 **${picked + 1}번**\n` +
                `🎁 보상 **${r.label}**\n` +
                (rewardId === 'none' ? '' : '📌 지급 필요\n') +
                `-# ${nowTag()}`,
                rewardId === 'none' ? GRAY : 0xfee75c
            ));
            return true;
        }
    } catch (e) {
        console.error('[빼빼로] 버튼 처리 오류:', e);
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

module.exports = { init, handleInteraction, handleMessage };
