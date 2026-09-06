const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    REST,
    Routes,
    SlashCommandBuilder,
    AttachmentBuilder,
    PermissionFlagsBits
} = require('discord.js');

const {
    createCanvas,
    loadImage,
    registerFont
} = require('canvas');

const fetch = (...args) =>
    import('node-fetch').then(({ default: fetch }) => fetch(...args));

const { QuickDB } = require('quick.db');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const TOKEN = process.env.DISCORD_TOKEN;

// ======================================================
// 디스코드 설정
// ======================================================

const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
];

const client = new Client({ intents });

// ======================================================
// 서버 설정
// ======================================================

const GUILD_ID = '1456729030459134115';

const PURCHASE_LOG_CHANNEL_ID =
    '1457384858065047663';

// ======================================================
// 데이터베이스
// ======================================================

const db = new QuickDB();

// ======================================================
// 폰트
// GitHub:
// fonts/
// ├─ Pretendard-Regular.ttf
// └─ Pretendard-Bold.ttf
// ======================================================

const FONT_REGULAR_PATH = path.join(
    __dirname,
    'fonts',
    'Pretendard-Regular.ttf'
);

const FONT_BOLD_PATH = path.join(
    __dirname,
    'fonts',
    'Pretendard-Bold.ttf'
);

try {
    registerFont(FONT_REGULAR_PATH, {
        family: 'Pretendard',
        weight: '400'
    });

    registerFont(FONT_BOLD_PATH, {
        family: 'Pretendard',
        weight: '700'
    });

    console.log('✅ Pretendard 폰트 로드 완료');
} catch (error) {
    console.error('❌ Pretendard 폰트 로드 실패');
    console.error(error);
}

// ======================================================
// 색상
// ======================================================

const COLORS = {
    background: '#0D0D0F',
    panel: '#101012',
    card: '#171719',

    white: '#F2EDF0',
    gray: '#AAA5AA',
    darkGray: '#656166',

    pink: '#F58FBD',
    pinkBorder: '#543747',

    cardBorder: '#303033',
    divider: '#363338',

    footer: '#634354'
};

// ======================================================
// 서버 역할 설정
// ======================================================

const SERVER_ROLES_CONFIG = [

    {
        id: '1456729030459134117',
        name: '방장',
        color: '#FF82B5',
        icon: 'crown'
    },

    {
        id: '1458178323434836199',
        name: '서버 관리자',
        color: '#FF82B5',
        icon: 'crown'
    },

    {
        id: '1545686320993796126',
        name: '서버 관리자',
        color: '#FF82B5',
        icon: 'crown'
    },

    {
        id: '1529484356748574720',
        name: '판매자',
        color: '#B78CFF',
        icon: 'diamond'
    },

    {
        id: '1522815168286036098',
        name: '판매자',
        color: '#B78CFF',
        icon: 'diamond'
    },

    {
        id: '1456735270119411734',
        name: '회원',
        color: '#9B969B',
        icon: 'user'
    }
];

// ======================================================
// 구매 등급 설정
// ======================================================

const BUY_TIERS_CONFIG = [

    {
        id: '1489943721146449920',
        name: 'Crystal',
        color: '#8EEBFF',
        icon: 'crystal'
    },

    {
        id: '1456737896525725719',
        name: 'Emerald',
        color: '#69E6A1',
        icon: 'emerald'
    },

    {
        id: '1456736865779581031',
        name: 'Ruby',
        color: '#FF7188',
        icon: 'ruby'
    },

    {
        id: '1456736771344826535',
        name: 'Gold',
        color: '#FFD76A',
        icon: 'gold'
    },

    {
        id: '1456736573797171384',
        name: 'Silver',
        color: '#D6D6DE',
        icon: 'silver'
    },

    {
        id: '1457383788236505299',
        name: 'Bronze',
        color: '#C98A62',
        icon: 'bronze'
    }
];

// ======================================================
// 폰트
// ======================================================

function font(size, bold = false) {
    return `${bold ? '700' : '400'} ${size}px "Pretendard"`;
}

// ======================================================
// 역할 가져오기
// ======================================================

function getHighestRole(
    member,
    configList,
    defaultRole
) {
    if (!member) {
        return defaultRole;
    }

    for (const role of configList) {

        if (member.roles.cache.has(role.id)) {
            return role;
        }
    }

    return defaultRole;
}

// ======================================================
// DB - 구매 기록
// ======================================================

async function update_user_purchase(user_id, amount) {

    const user_key = `user_${user_id}`;

    if (!await db.has(user_key)) {

        await db.set(user_key, {
            total_amount: 0,
            buy_count: 0,
            max_amount: 0
        });
    }

    await db.add(
        `${user_key}.total_amount`,
        amount
    );

    await db.add(
        `${user_key}.buy_count`,
        1
    );

    const current_data =
        await db.get(user_key);

    if (amount > current_data.max_amount) {

        await db.set(
            `${user_key}.max_amount`,
            amount
        );
    }

    console.log(
        `💾 DB 저장 완료: 유저 ${user_id} - ₩${amount.toLocaleString()}`
    );
}

// ======================================================
// 구매 순위
// ======================================================

async function get_user_rank(user_id) {

    const all_data = await db.all();

    const user_entries = all_data.filter(
        entry =>
            entry.id.startsWith('user_') &&
            entry.value &&
            typeof entry.value.total_amount === 'number'
    );

    user_entries.sort(
        (a, b) =>
            b.value.total_amount -
            a.value.total_amount
    );

    const rankIndex =
        user_entries.findIndex(
            entry =>
                entry.id === `user_${user_id}`
        );

    if (rankIndex !== -1) {
        return `#${rankIndex + 1}`;
    }

    return `#${user_entries.length + 1}`;
}

// ======================================================
// 원형 아바타
// ======================================================

async function drawCircleAvatar(
    ctx,
    url,
    x,
    y,
    size
) {

    try {

        const response = await fetch(url);

        const avatarBuffer =
            await response.arrayBuffer();

        const avatarImg =
            await loadImage(
                Buffer.from(avatarBuffer)
            );

        ctx.save();

        ctx.beginPath();

        ctx.arc(
            x + size / 2,
            y + size / 2,
            size / 2,
            0,
            Math.PI * 2
        );

        ctx.closePath();

        ctx.clip();

        ctx.drawImage(
            avatarImg,
            x,
            y,
            size,
            size
        );

        ctx.restore();

        // 아바타 테두리

        ctx.strokeStyle =
            COLORS.pink;

        ctx.lineWidth = 4;

        ctx.beginPath();

        ctx.arc(
            x + size / 2,
            y + size / 2,
            size / 2,
            0,
            Math.PI * 2
        );

        ctx.stroke();

    } catch (error) {

        console.error(
            '❌ 아바타 로드 실패:',
            error
        );
    }
}

// ======================================================
// 역할 아이콘
// ======================================================

function drawRoleIcon(
    ctx,
    type,
    x,
    y,
    size,
    color
) {

    ctx.save();

    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    ctx.lineWidth =
        Math.max(2, size * 0.08);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const cx =
        x + size / 2;

    const cy =
        y + size / 2;

    // ==================================================
    // 왕관
    // ==================================================

    if (type === 'crown') {

        ctx.beginPath();

        ctx.moveTo(
            x + size * 0.10,
            y + size * 0.28
        );

        ctx.lineTo(
            x + size * 0.28,
            y + size * 0.46
        );

        ctx.lineTo(
            cx,
            y + size * 0.15
        );

        ctx.lineTo(
            x + size * 0.72,
            y + size * 0.46
        );

        ctx.lineTo(
            x + size * 0.90,
            y + size * 0.28
        );

        ctx.lineTo(
            x + size * 0.78,
            y + size * 0.78
        );

        ctx.lineTo(
            x + size * 0.22,
            y + size * 0.78
        );

        ctx.closePath();

        ctx.stroke();

        ctx.beginPath();

        ctx.moveTo(
            x + size * 0.20,
            y + size * 0.90
        );

        ctx.lineTo(
            x + size * 0.80,
            y + size * 0.90
        );

        ctx.stroke();
    }

    // ==================================================
    // 다이아몬드
    // ==================================================

    else if (
        type === 'diamond' ||
        type === 'crystal'
    ) {

        ctx.beginPath();

        ctx.moveTo(
            cx,
            y + size * 0.08
        );

        ctx.lineTo(
            x + size * 0.88,
            cy
        );

        ctx.lineTo(
            cx,
            y + size * 0.92
        );

        ctx.lineTo(
            x + size * 0.12,
            cy
        );

        ctx.closePath();

        ctx.stroke();

        ctx.beginPath();

        ctx.moveTo(
            x + size * 0.12,
            cy
        );

        ctx.lineTo(
            x + size * 0.88,
            cy
        );

        ctx.moveTo(
            cx,
            y + size * 0.08
        );

        ctx.lineTo(
            cx,
            y + size * 0.92
        );

        ctx.stroke();
    }

    // ==================================================
    // 사람
    // ==================================================

    else if (type === 'user') {

        ctx.beginPath();

        ctx.arc(
            cx,
            y + size * 0.30,
            size * 0.18,
            0,
            Math.PI * 2
        );

        ctx.stroke();

        ctx.beginPath();

        ctx.arc(
            cx,
            y + size * 0.87,
            size * 0.34,
            Math.PI,
            Math.PI * 2
        );

        ctx.stroke();
    }

    // ==================================================
    // Emerald
    // ==================================================

    else if (type === 'emerald') {

        ctx.beginPath();

        ctx.moveTo(
            cx,
            y + size * 0.08
        );

        ctx.lineTo(
            x + size * 0.85,
            y + size * 0.30
        );

        ctx.lineTo(
            x + size * 0.68,
            y + size * 0.84
        );

        ctx.lineTo(
            x + size * 0.32,
            y + size * 0.84
        );

        ctx.lineTo(
            x + size * 0.15,
            y + size * 0.30
        );

        ctx.closePath();

        ctx.stroke();
    }

    // ==================================================
    // Ruby
    // ==================================================

    else if (type === 'ruby') {

        ctx.beginPath();

        ctx.moveTo(
            cx,
            y + size * 0.08
        );

        ctx.lineTo(
            x + size * 0.86,
            y + size * 0.32
        );

        ctx.lineTo(
            cx,
            y + size * 0.92
        );

        ctx.lineTo(
            x + size * 0.14,
            y + size * 0.32
        );

        ctx.closePath();

        ctx.stroke();
    }

    // ==================================================
    // Gold
    // ==================================================

    else if (type === 'gold') {

        ctx.beginPath();

        ctx.arc(
            cx,
            cy,
            size * 0.34,
            0,
            Math.PI * 2
        );

        ctx.stroke();

        ctx.beginPath();

        ctx.moveTo(
            cx - size * 0.13,
            cy
        );

        ctx.lineTo(
            cx + size * 0.13,
            cy
        );

        ctx.stroke();
    }

    // ==================================================
    // Silver
    // ==================================================

    else if (type === 'silver') {

        ctx.beginPath();

        ctx.arc(
            cx,
            cy,
            size * 0.34,
            0,
            Math.PI * 2
        );

        ctx.stroke();
    }

    // ==================================================
    // Bronze
    // ==================================================

    else if (type === 'bronze') {

        ctx.beginPath();

        ctx.arc(
            cx,
            cy,
            size * 0.34,
            0,
            Math.PI * 2
        );

        ctx.stroke();

        ctx.beginPath();

        ctx.moveTo(
            cx - size * 0.14,
            cy + size * 0.14
        );

        ctx.lineTo(
            cx + size * 0.14,
            cy - size * 0.14
        );

        ctx.stroke();
    }

    ctx.restore();
}

// ======================================================
// 봇 준비
// ======================================================

client.once('ready', async () => {

    const commands = [

        new SlashCommandBuilder()
            .setName('지급완료')
            .setDescription(
                '구매 데이터를 기록하고 로그를 전송합니다.'
            )
            .addUserOption(option =>
                option
                    .setName('구매자')
                    .setDescription(
                        '아이템을 지급받을 유저'
                    )
                    .setRequired(true)
            )
            .addIntegerOption(option =>
                option
                    .setName('금액')
                    .setDescription(
                        '거래 금액 (숫자만 입력)'
                    )
                    .setRequired(true)
            )
    ];

    const rest =
        new REST({ version: '10' })
            .setToken(TOKEN);

    try {

        await rest.put(
            Routes.applicationGuildCommands(
                client.user.id,
                GUILD_ID
            ),
            {
                body: commands
            }
        );

        console.log(
            `✅ ${client.user.tag} 봇 준비 완료`
        );

        console.log(
            '✅ 슬래시 명령어 동기화 완료'
        );

        console.log(
            '💾 database.sqlite 영구 저장 사용'
        );

    } catch (error) {

        console.error(
            '❌ 명령어 동기화 실패:',
            error
        );
    }
});

// ======================================================
// /지급완료
// ======================================================

client.on(
    'interactionCreate',
    async interaction => {

        if (!interaction.isChatInputCommand()) {
            return;
        }

        if (
            interaction.commandName !==
            '지급완료'
        ) {
            return;
        }

        // 관리자 권한
        if (
            !interaction.member.permissions.has(
                PermissionFlagsBits.Administrator
            )
        ) {

            return interaction.reply({
                content:
                    '❌ 이 명령어를 사용할 권한이 없습니다.',
                ephemeral: true
            });
        }

        const 구매자 =
            interaction.options.getUser('구매자');

        const 금액 =
            interaction.options.getInteger('금액');

        // 구매 데이터 저장
        await update_user_purchase(
            구매자.id,
            금액
        );

        // 성공 메시지
        const success_embed =
            new EmbedBuilder()
                .setDescription(
                    `**${구매자}님, 아이템이 정상적으로 지급되었어요.** <a:veryheart:1479957265871143104>`
                )
                .setColor(0xFFC1D6)
                .addFields([
                    {
                        name: '\u200B',
                        value: '리뷰 작성은 필수입니다.'
                    }
                ]);

        await interaction.reply({
            embeds: [success_embed]
        });

        // 구매 로그
        const log_channel =
            client.channels.cache.get(
                PURCHASE_LOG_CHANNEL_ID
            );

        if (!log_channel) {

            console.error(
                `❌ 로그 채널을 찾을 수 없습니다.`
            );

            return;
        }

        const user_data =
            await db.get(
                `user_${구매자.id}`
            );

        const log_embed =
            new EmbedBuilder()
                .setTitle(
                    '🛍️ 아이템 지급 완료 로그'
                )
                .setColor(0xFFC1D6)
                .setTimestamp()
                .addFields(

                    {
                        name: '구매자',
                        value:
                            `${구매자} (${구매자.id})`,
                        inline: true
                    },

                    {
                        name: '처리 관리자',
                        value:
                            `${interaction.user}`,
                        inline: true
                    },

                    {
                        name: '거래 금액',
                        value:
                            `₩${금액.toLocaleString()}`,
                        inline: false
                    },

                    {
                        name: '유저 누적 금액',
                        value:
                            `₩${user_data.total_amount.toLocaleString()}`,
                        inline: true
                    },

                    {
                        name: '유저 누적 횟수',
                        value:
                            `${user_data.buy_count}회`,
                        inline: true
                    }
                );

        await log_channel.send({
            embeds: [log_embed]
        });
    }
);

// ======================================================
// $정보
// ======================================================

client.on(
    'messageCreate',
    async message => {

        // 봇 무시
        if (message.author.bot) {
            return;
        }

        // 서버에서만 사용
        if (!message.guild) {
            return;
        }

        // $로 시작하지 않으면 무시
        if (!message.content.startsWith('$')) {
            return;
        }

        const command =
            message.content
                .substring(1)
                .trim()
                .split(/\s+/);

        const cmd_name =
            command[0];

        if (cmd_name !== '정보') {
            return;
        }

        try {

            // ==================================================
            // 대상 유저
            // ==================================================

            const target =
                message.mentions.users.first() ||
                message.author;

            const member =
                message.guild.members.cache.get(
                    target.id
                );

            // ==================================================
            // DB 데이터
            // ==================================================

            const user_key =
                `user_${target.id}`;

            let user_data =
                await db.get(user_key);

            if (!user_data) {

                user_data = {
                    total_amount: 0,
                    buy_count: 0,
                    max_amount: 0
                };
            }

            const totalAmount =
                Number(
                    user_data.total_amount || 0
                );

            const buyCount =
                Number(
                    user_data.buy_count || 0
                );

            const maxAmount =
                Number(
                    user_data.max_amount || 0
                );

            // ==================================================
            // 캔버스
            // ==================================================

            const W = 1536;
            const H = 808;

            const canvas =
                createCanvas(W, H);

            const ctx =
                canvas.getContext('2d');

            // ==================================================
            // 배경
            // ==================================================

            ctx.fillStyle =
                COLORS.background;

            ctx.fillRect(
                0,
                0,
                W,
                H
            );

            // ==================================================
            // 메인 패널
            // ==================================================

            ctx.fillStyle =
                COLORS.panel;

            ctx.strokeStyle =
                COLORS.pinkBorder;

            ctx.lineWidth = 2;

            ctx.beginPath();

            ctx.roundRect(
                23,
                40,
                1490,
                727,
                30
            );

            ctx.fill();
            ctx.stroke();

            // ==================================================
            // 아바타
            // ==================================================

            await drawCircleAvatar(
                ctx,
                target.displayAvatarURL({
                    extension: 'png',
                    size: 256
                }),
                88,
                113,
                205
            );

            // 온라인 점
            ctx.fillStyle =
                COLORS.pink;

            ctx.strokeStyle =
                COLORS.panel;

            ctx.lineWidth = 7;

            ctx.beginPath();

            ctx.arc(
                271,
                292,
                22,
                0,
                Math.PI * 2
            );

            ctx.fill();
            ctx.stroke();

            // ==================================================
            // 사용자 이름
            // ==================================================

            ctx.fillStyle =
                COLORS.white;

            ctx.font =
                font(64, true);

            ctx.fillText(
                target.username,
                352,
                180
            );

            // ==================================================
            // 태그
            // ==================================================

            ctx.fillStyle =
                COLORS.darkGray;

            ctx.font =
                font(31);

            const tag =
                target.discriminator &&
                target.discriminator !== '0'
                    ? `#${target.discriminator}`
                    : `#${target.id.slice(-4)}`;

            ctx.fillText(
                tag,
                353,
                235
            );

            // ==================================================
            // 서버 역할
            // ==================================================

            const serverRole =
                getHighestRole(
                    member,
                    SERVER_ROLES_CONFIG,
                    {
                        name: '회원',
                        color: '#9B969B',
                        icon: 'user'
                    }
                );

            drawRoleIcon(
                ctx,
                serverRole.icon,
                350,
                265,
                35,
                serverRole.color
            );

            ctx.fillStyle =
                serverRole.color;

            ctx.font =
                font(27, true);

            ctx.fillText(
                serverRole.name,
                405,
                294
            );

            // ==================================================
            // 가입일
            // ==================================================

            ctx.fillStyle =
                COLORS.gray;

            ctx.font =
                font(24);

            ctx.fillText(
                '가입일',
                835,
                213
            );

            let joined_str =
                '2026. 09. 06';

            if (
                member &&
                member.joinedAt
            ) {

                const d =
                    member.joinedAt;

                joined_str =
                    `${d.getFullYear()}. ` +
                    `${String(
                        d.getMonth() + 1
                    ).padStart(2, '0')}. ` +
                    `${String(
                        d.getDate()
                    ).padStart(2, '0')}`;
            }

            ctx.fillStyle =
                COLORS.white;

            ctx.font =
                font(29);

            ctx.fillText(
                joined_str,
                835,
                255
            );

            // ==================================================
            // 구분선
            // ==================================================

            ctx.strokeStyle =
                COLORS.divider;

            ctx.lineWidth = 2;

            ctx.beginPath();

            ctx.moveTo(
                1039,
                166
            );

            ctx.lineTo(
                1039,
                273
            );

            ctx.stroke();

            // ==================================================
            // 서버
            // ==================================================

            ctx.fillStyle =
                COLORS.gray;

            ctx.font =
                font(24);

            ctx.fillText(
                '서버',
                1175,
                213
            );

            ctx.fillStyle =
                COLORS.white;

            ctx.font =
                font(17, true);

            ctx.fillText(
                'SODDU DISCORD SERVER',
                1175,
                250
            );

            ctx.fillStyle =
                COLORS.pink;

            ctx.font =
                font(32, true);

            ctx.fillText(
                '›',
                1450,
                250
            );

            ctx.fillStyle =
                COLORS.footer;

            ctx.font =
                font(12);

            ctx.fillText(
                'S I N C E  2 0 2 0',
                1175,
                285
            );

            // ==================================================
            // 카드
            // ==================================================

            const cardY = 354;
            const cardH = 296;
            const cardW = 344;

            const cardX = [
                56,
                418,
                778,
                1138
            ];

            for (
                const x of cardX
            ) {

                ctx.fillStyle =
                    COLORS.card;

                ctx.strokeStyle =
                    COLORS.cardBorder;

                ctx.lineWidth = 2;

                ctx.beginPath();

                ctx.roundRect(
                    x,
                    cardY,
                    cardW,
                    cardH,
                    24
                );

                ctx.fill();
                ctx.stroke();
            }

            // ==================================================
            // 카드 1
            // 총 거래량
            // ==================================================

            drawRoleIcon(
                ctx,
                'diamond',
                94,
                390,
                38,
                COLORS.pink
            );

            ctx.fillStyle =
                '#C1BCC1';

            ctx.font =
                font(25);

            ctx.fillText(
                '총 거래량',
                163,
                426
            );

            ctx.fillStyle =
                COLORS.white;

            ctx.font =
                font(47, true);

            ctx.fillText(
                `₩${totalAmount.toLocaleString()}`,
                95,
                512
            );

            ctx.strokeStyle =
                COLORS.divider;

            ctx.lineWidth = 2;

            ctx.beginPath();

            ctx.moveTo(
                95,
                535
            );

            ctx.lineTo(
                360,
                535
            );

            ctx.stroke();

            ctx.fillStyle =
                COLORS.gray;

            ctx.font =
                font(20);

            ctx.fillText(
                '최대 거래 금액',
                95,
                584
            );

            ctx.fillStyle =
                COLORS.white;

            ctx.font =
                font(27, true);

            ctx.fillText(
                `₩${maxAmount.toLocaleString()}`,
                95,
                620
            );

            // ==================================================
            // 카드 2
            // 총 거래 횟수
            // ==================================================

            drawRoleIcon(
                ctx,
                'silver',
                456,
                390,
                38,
                COLORS.pink
            );

            ctx.fillStyle =
                '#C1BCC1';

            ctx.font =
                font(25);

            ctx.fillText(
                '총 거래 횟수',
                535,
                426
            );

            ctx.fillStyle =
                COLORS.white;

            ctx.font =
                font(47, true);

            ctx.fillText(
                `${buyCount}`,
                456,
                512
            );

            // ==================================================
            // 카드 3
            // 구매 등급
            // ==================================================

            const tier =
                getHighestRole(
                    member,
                    BUY_TIERS_CONFIG,
                    {
                        name: 'NONE',
                        color: '#777277',
                        icon: 'silver'
                    }
                );

            drawRoleIcon(
                ctx,
                tier.icon,
                816,
                390,
                38,
                tier.color
            );

            ctx.fillStyle =
                '#C1BCC1';

            ctx.font =
                font(25);

            ctx.fillText(
                '구매 등급',
                895,
                426
            );

            ctx.fillStyle =
                tier.color;

            ctx.font =
                font(31, true);

            ctx.fillText(
                tier.name,
                817,
                512
            );

            // ==================================================
            // 카드 4
            // 초대 횟수
            // ==================================================

            drawRoleIcon(
                ctx,
                'user',
                1177,
                390,
                38,
                COLORS.pink
            );

            ctx.fillStyle =
                '#C1BCC1';

            ctx.font =
                font(25);

            ctx.fillText(
                '초대 횟수',
                1250,
                426
            );

            // 현재 초대 시스템 미연동
            // 기본값 0
            ctx.fillStyle =
                COLORS.white;

            ctx.font =
                font(47, true);

            ctx.fillText(
                '0',
                1177,
                512
            );

            ctx.strokeStyle =
                COLORS.divider;

            ctx.lineWidth = 2;

            ctx.beginPath();

            ctx.moveTo(
                1177,
                535
            );

            ctx.lineTo(
                1440,
                535
            );

            ctx.stroke();

            ctx.fillStyle =
                COLORS.gray;

            ctx.font =
                font(20);

            ctx.fillText(
                '서버 순위',
                1177,
                584
            );

            // ==================================================
            // 구매 순위
            // ==================================================

            const purchaseRank =
                await get_user_rank(
                    target.id
                );

            ctx.fillStyle =
                COLORS.pink;

            ctx.font =
                font(42, true);

            ctx.fillText(
                purchaseRank,
                1378,
                594
            );

            // ==================================================
            // 하단 안내
            // ==================================================

            ctx.fillStyle =
                COLORS.pink;

            ctx.font =
                font(28);

            ctx.fillText(
                'ⓘ',
                66,
                728
            );

            ctx.fillStyle =
                COLORS.gray;

            ctx.font =
                font(19);

            ctx.fillText(
                '2026.09.06 이후의 데이터만 기록됩니다.',
                115,
                728
            );

            // ==================================================
            // 하단 선
            // ==================================================

            ctx.strokeStyle =
                COLORS.divider;

            ctx.lineWidth = 2;

            ctx.beginPath();

            ctx.moveTo(
                704,
                718
            );

            ctx.lineTo(
                1141,
                718
            );

            ctx.stroke();

            // ==================================================
            // 하단 서버명
            // ==================================================

            ctx.fillStyle =
                COLORS.footer;

            ctx.font =
                font(12, true);

            ctx.fillText(
                'S O D D U  D I S C O R D  S E R V E R',
                1172,
                728
            );

            // ==================================================
            // 이미지 전송
            // ==================================================

            const attachment =
                new AttachmentBuilder(
                    canvas.toBuffer('image/png'),
                    {
                        name: 'profile.png'
                    }
                );

            await message.channel.send({
                files: [attachment]
            });

        } catch (error) {

            console.error(
                '❌ $정보 이미지 생성 오류:',
                error
            );

            await message.channel.send(
                '❌ 정보 이미지를 생성하는 중 오류가 발생했어요.'
            );
        }
    }
);

// ======================================================
// 로그인
// ======================================================

client.login(TOKEN);
