const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
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

const GUILD_ID = '1456729030459134115';
const PURCHASE_LOG_CHANNEL_ID = '1457384858065047663';

const db = new QuickDB();

let FONT_FAMILY = 'sans-serif';

async function setupFont() {
    const fontPath = path.join(__dirname, 'Pretendard-Bold.otf');
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

// 역할별 설정 (오너: 왕관, 관리자: 렌치, 판매자: 돈, 회원: 새싹)
const SERVER_ROLES_CONFIG = [
    { 
        id: '1456729030459134117', 
        name: '서버 오너', 
        color: '#FF79C6',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23FF79C6"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/></svg>`
    },
    { 
        id: '1458178323434836199', 
        name: '서버 관리자', 
        color: '#5775A8',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%235775A8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`
    },
    { 
        id: '1545686320993796126', 
        name: '서버 관리자', 
        color: '#5775A8',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%235775A8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`
    },
    { 
        id: '1529484356748574720', 
        name: '판매자', 
        color: '#50FA7B',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%2350FA7B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"></circle><line x1="12" y1="8" x2="12" y2="16"></line><path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 2-3 2-3 4s3 2 3 4a2.5 2.5 0 0 1-5 0"></path></svg>`
    },
    { 
        id: '1522815168286036098', 
        name: '판매자', 
        color: '#50FA7B',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%2350FA7B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"></circle><line x1="12" y1="8" x2="12" y2="16"></line><path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 2-3 2-3 4s3 2 3 4a2.5 2.5 0 0 1-5 0"></path></svg>`
    },
    { 
        id: '1456735270119411734', 
        name: '회원', 
        color: '#A3E635',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23A3E635" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20h10"></path><path d="M10 20c0-4.4 3.6-8 8-8v-1c-5 0-9 4-9 9"></path><path d="M14 20c0-7.7-6.3-14-14-14v1c7 0 13 6 13 13"></path></svg>`
    }
];

const BUY_TIERS_CONFIG = [
    { id: '1489943721146449920', name: 'Crystal', color: '#C084FC' },
    { id: '1456737896525725719', name: 'Emerald', color: '#34D399' },
    { id: '1456736865779581031', name: 'Ruby', color: '#F87171' },
    { id: '1456736771344826535', name: 'Gold', color: '#FACC15' },
    { id: '1456736573797171384', name: 'Silver', color: '#FB923C' },
    { id: '1457383788236505299', name: 'Bronze', color: '#D97706' }
];

async function get_user_rank(user_id) {
    const all_data = await db.all();
    const user_entries = all_data.filter(entry => entry.id.startsWith('user_'));

    user_entries.sort((a, b) => (b.value.total_amount || 0) - (a.value.total_amount || 0));
    const rankIndex = user_entries.findIndex(entry => entry.id === `user_${user_id}`);
    
    return rankIndex !== -1 ? `#${rankIndex + 1}` : `#1`;
}

function getRoleInfo(member) {
    const defaultRole = SERVER_ROLES_CONFIG[SERVER_ROLES_CONFIG.length - 1];
    if (!member) return defaultRole;
    for (const role_info of SERVER_ROLES_CONFIG) {
        if (member.roles.cache.has(role_info.id)) {
            return role_info;
        }
    }
    return defaultRole;
}

function getBuyTierInfo(member) {
    if (!member) return null;
    for (const tier of BUY_TIERS_CONFIG) {
        if (member.roles.cache.has(tier.id)) {
            return tier;
        }
    }
    return null;
}

function cleanText(text) {
    return text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1D400}-\u{1D7FF}]/gu, '').trim();
}

async function drawSvgIcon(ctx, svgString, x, y, width, height) {
    try {
        const svgBuffer = Buffer.from(svgString);
        const img = await loadImage(`data:image/svg+xml;base64,${svgBuffer.toString('base64')}`);
        ctx.drawImage(img, x, y, width, height);
    } catch (e) {
        console.error('SVG 변환 에러:', e);
    }
}

function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

async function drawCircleAvatar(ctx, url, x, y, size, roleInfo) {
    try {
        const res = await fetch(url);
        const arrayBuffer = await res.arrayBuffer();
        const avatarImg = await loadImage(Buffer.from(arrayBuffer));
        
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.clip();
        
        ctx.drawImage(avatarImg, x, y, size, size);
        ctx.restore();
        
        // 아바타 테두리
        ctx.strokeStyle = "#5775A8";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
        ctx.stroke();

        // 우측 하단 소형 뱃지
        const badgeX = x + size - 12;
        const badgeY = y + size - 14;
        ctx.fillStyle = roleInfo.color;
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, 11, 0, Math.PI * 2);
        ctx.fill();
        
        await drawSvgIcon(ctx, roleInfo.icon, badgeX - 6, badgeY - 6, 12, 12);
    } catch (e) {
        console.error(`아바타 로드 오류: ${e}`);
    }
}

client.once('ready', async () => {
    await setupFont();
    console.log(`${client.user.username} 정밀 프로필 시스템 준비 완료!`);
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith('$')) return;

    const command = message.content.substring(1).trim().split(' ');
    
    if (command[0] === '정보') {
        try {
            const target = message.mentions.users.first() || message.author;
            const member = message.guild.members.cache.get(target.id);
            
            const user_key = `user_${target.id}`;
            let user_data = await db.get(user_key) || { total_amount: 0, buy_count: 0, max_amount: 0 };
            
            const roleInfo = getRoleInfo(member);
            const buyTier = getBuyTierInfo(member);

            const W = 1000, H = 450;
            const canvas = createCanvas(W, H);
            const ctx = canvas.getContext('2d');

            // 1. 전체 메인 배경 (이미지 디자인 그대로)
            drawRoundedRect(ctx, 0, 0, W, H, 28);
            ctx.fillStyle = "#121116";
            ctx.fill();

            // 은은한 네온 글로우
            const glow = ctx.createRadialGradient(850, 40, 10, 850, 40, 300);
            glow.addColorStop(0, 'rgba(255, 255, 255, 0.03)');
            glow.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, W, H);

            // 2. 프로필 아바타
            await drawCircleAvatar(ctx, target.displayAvatarURL({ extension: 'png', size: 128 }), 45, 45, 115, roleInfo);

            // 3. 닉네임 & 디스코드 태그
            ctx.fillStyle = "#FFFFFF";
            ctx.font = `bold 36px ${FONT_FAMILY}`;
            ctx.fillText(target.username, 182, 85);

            ctx.fillStyle = "#4E4956";
            ctx.font = `bold 18px ${FONT_FAMILY}`;
            ctx.fillText("#0001", 182, 113);

            // 역할 이름 표시 (예: 서버 관리자)
            ctx.fillStyle = roleInfo.color;
            ctx.font = `bold 17px ${FONT_FAMILY}`;
            ctx.fillText(roleInfo.name, 202, 142);

            // 4. 상단 우측 : 가입일 영역
            ctx.fillStyle = "#7D7787";
            ctx.font = `14px ${FONT_FAMILY}`;
            ctx.fillText("가입일", 540, 68);

            ctx.fillStyle = "#FFFFFF";
            ctx.font = `bold 22px ${FONT_FAMILY}`;
            const joined_str = member ? member.joinedAt.toLocaleDateString('ko-KR').replace(/\. /g, '.').slice(0, -1) : "2026.3.18";
            ctx.fillText(joined_str, 540, 102);

            // Center Line (구분선)
            ctx.strokeStyle = "#27242E";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(655, 60);
            ctx.lineTo(655, 110);
            ctx.stroke();

            // 5. 상단 우측 : 서버 영역
            ctx.fillStyle = "#7D7787";
            ctx.font = `14px ${FONT_FAMILY}`;
            ctx.fillText("서버", 715, 68);

            ctx.fillStyle = "#FFFFFF";
            ctx.font = `bold 22px ${FONT_FAMILY}`;
            ctx.fillText(">", 715, 100);

            ctx.fillStyle = "#3F3A46";
            ctx.font = `bold 11px ${FONT_FAMILY}`;
            ctx.fillText("SINCE 2020", 715, 118);

            // 6. 하단 4개 카트 레이아웃
            const card_y = 175, card_h = 205, card_w = 212, gap = 16, start_x = 36;
            const card_bg = "#18161D";

            // [카드 1] 총 거래량
            drawRoundedRect(ctx, start_x, card_y, card_w, card_h, 18);
            ctx.fillStyle = card_bg;
            ctx.fill();

            ctx.fillStyle = "#8F8998";
            ctx.font = `15px ${FONT_FAMILY}`;
            ctx.fillText("총 거래량", start_x + 50, card_y + 38);

            ctx.fillStyle = "#FFFFFF";
            ctx.font = `bold 32px ${FONT_FAMILY}`;
            ctx.fillText(`₩${user_data.total_amount}`, start_x + 18, card_y + 110);

            ctx.fillStyle = "#5E5867";
            ctx.font = `12px ${FONT_FAMILY}`;
            ctx.fillText("최대 거래 금액", start_x + 18, card_y + 155);

            ctx.fillStyle = "#A8A2B2";
            ctx.font = `bold 14px ${FONT_FAMILY}`;
            ctx.fillText(`₩${user_data.max_amount}`, start_x + 18, card_y + 175);

            // [카드 2] 총 거래 횟수
            const x_2 = start_x + card_w + gap;
            drawRoundedRect(ctx, x_2, card_y, card_w, card_h, 18);
            ctx.fillStyle = card_bg;
            ctx.fill();

            ctx.fillStyle = "#8F8998";
            ctx.font = `15px ${FONT_FAMILY}`;
            ctx.fillText("총 거래 횟수", x_2 + 50, card_y + 38);

            ctx.fillStyle = "#FFFFFF";
            ctx.font = `bold 38px ${FONT_FAMILY}`;
            ctx.fillText(`${user_data.buy_count}`, x_2 + 18, card_y + 115);

            // [카드 3] 역할
            const x_3 = start_x + (card_w + gap) * 2;
            drawRoundedRect(ctx, x_3, card_y, card_w, card_h, 18);
            ctx.fillStyle = card_bg;
            ctx.fill();

            ctx.fillStyle = "#8F8998";
            ctx.font = `15px ${FONT_FAMILY}`;
            ctx.fillText("역할", x_3 + 70, card_y + 38);

            if (buyTier) {
                ctx.fillStyle = buyTier.color;
                ctx.font = `bold 26px ${FONT_FAMILY}`;
                ctx.fillText(buyTier.name, x_3 + 18, card_y + 115);
            } else {
                ctx.fillStyle = "#3B3743";
                ctx.font = `bold 28px ${FONT_FAMILY}`;
                ctx.fillText("NONE", x_3 + 18, card_y + 115);
            }

            // [카드 4] 초대 횟수 & 서버 순위
            const x_4 = start_x + (card_w + gap) * 3;
            drawRoundedRect(ctx, x_4, card_y, card_w, card_h, 18);
            ctx.fillStyle = card_bg;
            ctx.fill();

            ctx.fillStyle = "#8F8998";
            ctx.font = `15px ${FONT_FAMILY}`;
            ctx.fillText("초대 횟수", x_4 + 50, card_y + 38);

            ctx.fillStyle = "#FFFFFF";
            ctx.font = `bold 38px ${FONT_FAMILY}`;
            ctx.fillText("0", x_4 + 18, card_y + 115);

            ctx.fillStyle = "#5E5867";
            ctx.font = `14px ${FONT_FAMILY}`;
            ctx.fillText("서버 순위", x_4 + 18, card_y + 172);

            const purchase_rank_str = await get_user_rank(target.id);
            ctx.fillStyle = "#FACC15"; // 요청하신 노란색 강조
            ctx.font = `bold 28px ${FONT_FAMILY}`;
            ctx.fillText(purchase_rank_str, x_4 + 128, card_y + 172);

            // 7. 하단 텍스트 안내 영역
            ctx.fillStyle = "#3F3A46";
            ctx.font = `12px ${FONT_FAMILY}`;
            ctx.fillText("2026.09.06 이후의 데이터만 기록됩니다.", 56, 412);
            ctx.fillText("SODDU DISCORD SERVER", 788, 412);

            const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'profile.png' });
            await message.reply({ files: [attachment] });
        } catch (err) {
            console.error('정보 처리 중 에러 발생:', err);
        }
    }
});

client.login(TOKEN);
