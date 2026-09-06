const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage, registerFont } = require('canvas');
const { QuickDB } = require('quick.db');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

const fetch = globalThis.fetch;
const TOKEN = process.env.DISCORD_TOKEN;

const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
];
const client = new Client({ intents });

const db = new QuickDB();

// ─────────────────────────────────────
// 색상 및 폰트 설정 (제시해주신 파이썬 코드 기반)
// ─────────────────────────────────────
const CONFIG = {
    W: 1536,
    H: 808,
    BG: "#0d0d0f",
    CARD: "#141416",
    CARD_BORDER: "#303034",
    WHITE: "#f4eef2",
    GRAY: "#8f8b90",
    PINK: "#f48fbd",
    BORDER: "#4b3440",
    LINE: "#363338"
};

let FONT_FAMILY = 'sans-serif';

async function setupFont() {
    const fontsDir = path.join(__dirname, 'fonts');
    if (!fs.existsSync(fontsDir)) {
        fs.mkdirSync(fontsDir, { recursive: true });
    }

    const fontPath = path.join(fontsDir, 'Pretendard-Bold.otf');
    try {
        if (!fs.existsSync(fontPath)) {
            const res = await fetch('https://github.com/orioncactus/pretendard/raw/main/packages/pretendard/dist/public/static/Pretendard-Bold.otf');
            const buffer = Buffer.from(await res.arrayBuffer());
            fs.writeFileSync(fontPath, buffer);
        }
        registerFont(fontPath, { family: 'Pretendard' });
        FONT_FAMILY = 'Pretendard';
    } catch (e) {
        console.error('폰트 로드 실패:', e);
    }
}

// ─────────────────────────────────────
// 유틸리티 함수
// ─────────────────────────────────────

function drawRoundedRect(ctx, x, y, w, h, r, fill, outline = null, strokeWidth = 1) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();

    if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
    }
    if (outline) {
        ctx.lineWidth = strokeWidth;
        ctx.strokeStyle = outline;
        ctx.stroke();
    }
}

function drawGlowText(ctx, text, x, y, font, fill = CONFIG.PINK) {
    ctx.save();
    ctx.font = font;
    ctx.shadowColor = fill;
    ctx.shadowBlur = 12;
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
    ctx.restore();
}

async function get_user_rank(user_id) {
    const all_data = await db.all();
    const user_entries = all_data.filter(entry => entry.id.startsWith('user_'));
    user_entries.sort((a, b) => (b.value.total_amount || 0) - (a.value.total_amount || 0));
    const rankIndex = user_entries.findIndex(entry => entry.id === `user_${user_id}`);
    return rankIndex !== -1 ? `#${rankIndex + 1}` : `#1`;
}

// ─────────────────────────────────────
// 이미지 생성 메인 로직
// ─────────────────────────────────────

async function generateProfileImage(target, member, userData) {
    const { W, H } = CONFIG;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // 1. 전체 배경
    ctx.fillStyle = CONFIG.BG;
    ctx.fillRect(0, 0, W, H);

    // 2. 바깥 테두리 카드 (23, 40) ~ (W - 23, H - 40)
    drawRoundedRect(ctx, 23, 40, W - 46, H - 80, 30, "#101012", CONFIG.BORDER, 2);

    // 3. 상단 아바타 (77, 104, size: 225)
    const avatarX = 77, avatarY = 104, avatarSize = 225;
    try {
        const avatarUrl = target.displayAvatarURL({ extension: 'png', size: 256 });
        const res = await fetch(avatarUrl);
        const avatarBuffer = Buffer.from(await res.arrayBuffer());
        const avatarImg = await loadImage(avatarBuffer);

        // 원형 클리핑 아바타
        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, 102.5, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatarImg, avatarX + 10, avatarY + 10, 205, 205);
        ctx.restore();

        // 외곽선 테두리
        ctx.lineWidth = 5;
        ctx.strokeStyle = CONFIG.PINK;
        ctx.beginPath();
        ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
        ctx.stroke();
    } catch (e) {
        console.error('아바타 로드 오류:', e);
    }

    // 온라인 점 (핑크)
    ctx.fillStyle = CONFIG.PINK;
    ctx.beginPath();
    ctx.arc(270, 292, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = "#101012";
    ctx.stroke();

    // 4. 사용자 이름 & 글로우
    drawGlowText(ctx, target.username, 352, 182, `bold 66px ${FONT_FAMILY}`, CONFIG.PINK);

    // 디스코드 태그
    ctx.fillStyle = "#666267";
    ctx.font = `34px ${FONT_FAMILY}`;
    ctx.fillText("#0001", 352, 236);

    // 역할 아이콘 & 이름
    ctx.fillStyle = CONFIG.PINK;
    ctx.font = `bold 38px ${FONT_FAMILY}`;
    ctx.fillText("♛", 352, 295);

    ctx.font = `bold 29px ${FONT_FAMILY}`;
    ctx.fillText("서버 관리자", 407, 295);

    // 5. 가입일 영역
    ctx.fillStyle = "#a7a2a7";
    ctx.font = `40px ${FONT_FAMILY}`;
    ctx.fillText("▣", 770, 225);

    ctx.fillStyle = "#aaa5aa";
    ctx.font = `25px ${FONT_FAMILY}`;
    ctx.fillText("가입일", 836, 210);

    const joinedStr = member ? member.joinedAt.toLocaleDateString('ko-KR').replace(/\. /g, '. ').slice(0, -1) : "2020. 01. 02";
    ctx.fillStyle = CONFIG.WHITE;
    ctx.font = `29px ${FONT_FAMILY}`;
    ctx.fillText(joinedStr, 836, 252);

    // 세로 구분선
    ctx.strokeStyle = "#373338";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(1038, 166);
    ctx.lineTo(1038, 273);
    ctx.stroke();

    // 6. 서버 영역
    ctx.fillStyle = "#bcb7bc";
    ctx.font = `bold 45px ${FONT_FAMILY}`;
    ctx.fillText("◉", 1100, 225);

    ctx.fillStyle = "#aaa5aa";
    ctx.font = `25px ${FONT_FAMILY}`;
    ctx.fillText("서버", 1175, 205);

    ctx.fillStyle = CONFIG.WHITE;
    ctx.font = `bold 19px ${FONT_FAMILY}`;
    ctx.fillText("SODDU DISCORD SERVER", 1175, 238);

    ctx.fillStyle = CONFIG.PINK;
    ctx.font = `bold 35px ${FONT_FAMILY}`;
    ctx.fillText("›", 1450, 241);

    ctx.fillStyle = "#634353";
    ctx.font = `13px ${FONT_FAMILY}`;
    ctx.fillText("S I N C E   2 0 2 0", 1175, 271);

    // 7. 통계 4개 카드 (배치 및 내부 디자인)
    const cards = [
        { x1: 56, x2: 400 },
        { x1: 418, x2: 760 },
        { x1: 778, x2: 1120 },
        { x1: 1138, x2: 1480 }
    ];

    for (const card of cards) {
        drawRoundedRect(ctx, card.x1, 354, card.x2 - card.x1, 296, 25, CONFIG.CARD, CONFIG.CARD_BORDER, 2);
    }

    // [카드 1] 총 거래량
    ctx.fillStyle = CONFIG.PINK;
    ctx.font = `45px ${FONT_FAMILY}`;
    ctx.fillText("◎", 94, 425);

    ctx.fillStyle = "#bdb8bd";
    ctx.font = `26px ${FONT_FAMILY}`;
    ctx.fillText("총 거래량", 163, 424);

    ctx.fillStyle = CONFIG.WHITE;
    ctx.font = `bold 48px ${FONT_FAMILY}`;
    ctx.fillText(`₩${userData.total_amount || 0}`, 95, 502);

    ctx.strokeStyle = CONFIG.LINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(95, 535);
    ctx.lineTo(360, 535);
    ctx.stroke();

    ctx.fillStyle = "#aaa5aa";
    ctx.font = `21px ${FONT_FAMILY}`;
    ctx.fillText("최대 거래 금액", 95, 572);

    ctx.fillStyle = CONFIG.WHITE;
    ctx.font = `bold 28px ${FONT_FAMILY}`;
    ctx.fillText(`₩${userData.max_amount || 0}`, 95, 612);

    // [카드 2] 총 거래 횟수
    ctx.fillStyle = CONFIG.PINK;
    ctx.font = `43px ${FONT_FAMILY}`;
    ctx.fillText("▤", 456, 425);

    ctx.fillStyle = "#bdb8bd";
    ctx.font = `26px ${FONT_FAMILY}`;
    ctx.fillText("총 거래 횟수", 535, 424);

    ctx.fillStyle = CONFIG.WHITE;
    ctx.font = `bold 48px ${FONT_FAMILY}`;
    ctx.fillText(`${userData.buy_count || 0}`, 456, 503);

    // [카드 3] 역할
    ctx.fillStyle = CONFIG.PINK;
    ctx.font = `48px ${FONT_FAMILY}`;
    ctx.fillText("♙", 817, 425);

    ctx.fillStyle = "#bdb8bd";
    ctx.font = `26px ${FONT_FAMILY}`;
    ctx.fillText("역할", 895, 424);

    ctx.fillStyle = CONFIG.PINK;
    ctx.font = `bold 32px ${FONT_FAMILY}`;
    ctx.fillText("서버 관리자", 817, 504);

    ctx.font = `42px ${FONT_FAMILY}`;
    ctx.fillText("♛", 1000, 506);

    // [카드 4] 초대 횟수 & 서버 순위
    ctx.fillStyle = CONFIG.PINK;
    ctx.font = `46px ${FONT_FAMILY}`;
    ctx.fillText("♧", 1177, 425);

    ctx.fillStyle = "#bdb8bd";
    ctx.font = `26px ${FONT_FAMILY}`;
    ctx.fillText("초대 횟수", 1250, 424);

    ctx.fillStyle = CONFIG.WHITE;
    ctx.font = `bold 48px ${FONT_FAMILY}`;
    ctx.fillText("0", 1177, 503);

    ctx.strokeStyle = CONFIG.LINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(1177, 535);
    ctx.lineTo(1440, 535);
    ctx.stroke();

    ctx.fillStyle = "#aaa5aa";
    ctx.font = `21px ${FONT_FAMILY}`;
    ctx.fillText("서버 순위", 1177, 572);

    const userRank = await get_user_rank(target.id);
    ctx.fillStyle = CONFIG.PINK;
    ctx.font = `bold 42px ${FONT_FAMILY}`;
    ctx.fillText(userRank, 1378, 582);

    // 8. 하단 텍스트 영역
    ctx.fillStyle = CONFIG.PINK;
    ctx.font = `31px ${FONT_FAMILY}`;
    ctx.fillText("ⓘ", 66, 728);

    ctx.fillStyle = "#aaa5aa";
    ctx.font = `20px ${FONT_FAMILY}`;
    ctx.fillText("2026.09.06 이후의 데이터만 기록됩니다.", 115, 723);

    ctx.strokeStyle = CONFIG.LINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(705, 717);
    ctx.lineTo(1140, 717);
    ctx.stroke();

    ctx.fillStyle = "#634353";
    ctx.font = `bold 13px ${FONT_FAMILY}`;
    ctx.fillText("S O D D U   D I S C O R D   S E R V E R", 1172, 720);

    return canvas.toBuffer();
}

// ─────────────────────────────────────
// 디스코드 명령어 처리
// ─────────────────────────────────────

client.once('ready', async () => {
    await setupFont();
    console.log(`${client.user.username} 파이썬 스타일 이미지 변환봇 준비 완료!`);
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith('$')) return;

    const command = message.content.substring(1).trim().split(' ');

    if (command[0] === '정보') {
        try {
            const target = message.mentions.users.first() || message.author;
            const member = message.guild ? message.guild.members.cache.get(target.id) : null;

            const userData = await db.get(`user_${target.id}`) || { total_amount: 0, buy_count: 0, max_amount: 0 };

            const imageBuffer = await generateProfileImage(target, member, userData);
            const attachment = new AttachmentBuilder(imageBuffer, { name: 'user_info.png' });

            await message.reply({ files: [attachment] });
        } catch (err) {
            console.error('명령어 처리 중 에러 발생:', err);
        }
    }
});

client.login(TOKEN);
