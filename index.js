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

// 역할별 지정 색상 및 왕관 보유 여부 매핑
const SERVER_ROLES_CONFIG = [
    { id: '1456729030459134117', name: '서버 오너', color: '#FF79C6', hasCrown: true },    // 핑크 (왕관 O)
    { id: '1458178323434836199', name: '서버 관리자', color: '#5775A8', hasCrown: true },  // 남색 (왕관 O)
    { id: '1545686320993796126', name: '서버 관리자', color: '#5775A8', hasCrown: true },  // 남색 (왕관 O)
    { id: '1529484356748574720', name: '판매자', color: '#50FA7B', hasCrown: false },     // 민트 (왕관 X)
    { id: '1522815168286036098', name: '판매자', color: '#50FA7B', hasCrown: false },     // 민트 (왕관 X)
    { id: '1456735270119411734', name: '회원', color: '#A3E635', hasCrown: false }        // 연두 (왕관 X)
];

const BUY_TIERS_CONFIG = [
    { id: '1489943721146449920', name: 'Crystal', color: '#C084FC' },
    { id: '1456737896525725719', name: 'Emerald', color: '#34D399' },
    { id: '1456736865779581031', name: 'Ruby', color: '#F87171' },
    { id: '1456736771344826535', name: 'Gold', color: '#FACC15' },
    { id: '1456736573797171384', name: 'Silver', color: '#FB923C' },
    { id: '1457383788236505299', name: 'Bronze', color: '#D97706' }
];

async function update_user_purchase(user_id, amount) {
    const user_key = `user_${user_id}`;
    if (!await db.has(user_key)) {
        await db.set(user_key, { total_amount: 0, buy_count: 0, max_amount: 0 });
    }

    await db.add(`${user_key}.total_amount`, amount);
    await db.add(`${user_key}.buy_count`, 1);

    const current_data = await db.get(user_key);
    if (amount > current_data.max_amount) {
        await db.set(`${user_key}.max_amount`, amount);
    }
}

async function get_user_rank(user_id) {
    const all_data = await db.all();
    const user_entries = all_data.filter(entry => entry.id.startsWith('user_'));

    user_entries.sort((a, b) => b.value.total_amount - a.value.total_amount);
    const rankIndex = user_entries.findIndex(entry => entry.id === `user_${user_id}`);
    
    return rankIndex !== -1 ? `#${rankIndex + 1}` : `#${user_entries.length + 1}`;
}

function getRoleInfo(member, config_list, default_name = '회원', default_color = '#A3E635', default_crown = false) {
    if (!member) return { name: default_name, color: default_color, hasCrown: default_crown };
    for (const role_info of config_list) {
        if (member.roles.cache.has(role_info.id)) {
            return { name: role_info.name, color: role_info.color, hasCrown: role_info.hasCrown || false };
        }
    }
    return { name: default_name, color: default_color, hasCrown: default_crown };
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
    return text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1D400}-\u{1D7FF}]/gu, '').trim();
}

async function drawSvgIcon(ctx, svgString, x, y, width, height) {
    const svgBuffer = Buffer.from(svgString);
    const img = await loadImage(`data:image/svg+xml;base64,${svgBuffer.toString('base64')}`);
    ctx.drawImage(img, x, y, width, height);
}

// 고정 핑크 포인트(#FCA5A5) 아이콘 SVG
const ICONS = {
    calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#726D7A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,
    discord: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#726D7A"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`,
    info: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#484350" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
    coin: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FCA5A5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"></ellipse><path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6"></path><path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"></path></svg>`,
    list: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FCA5A5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><line x1="7" y1="8" x2="17" y2="8"></line><line x1="7" y1="12" x2="17" y2="12"></line><line x1="7" y1="16" x2="13" y2="16"></line></svg>`,
    user: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FCA5A5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`,
    users: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FCA5A5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path><path d="M21 21v-2a4 4 0 0 0-3-3.85"></path><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"></path><path d="M1 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"></path></svg>`
};

function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawCrownIcon(ctx, x, y, size, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y + size);
    ctx.lineTo(x, y + size * 0.3);
    ctx.lineTo(x + size * 0.3, y + size * 0.6);
    ctx.lineTo(x + size * 0.5, y);
    ctx.lineTo(x + size * 0.7, y + size * 0.6);
    ctx.lineTo(x + size, y + size * 0.3);
    ctx.lineTo(x + size, y + size);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

async function drawCircleAvatar(ctx, url, x, y, size, roleColor, hasCrown) {
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
        
        ctx.strokeStyle = roleColor;
        ctx.lineWidth = 3;
        ctx.stroke();

        // 왕관 권한이 있는 관리자/오너만 뱃지 표시
        if (hasCrown) {
            const badgeX = x + size - 14;
            const badgeY = y + size - 18;
            ctx.fillStyle = roleColor;
            ctx.beginPath();
            ctx.arc(badgeX, badgeY, 11, 0, Math.PI * 2);
            ctx.fill();
            
            drawCrownIcon(ctx, badgeX - 6, badgeY - 6, 12, '#16151A');
        }
    } catch (e) {
        console.error(`아바타 로드 오류: ${e}`);
    }
}

client.once('ready', async () => {
    await setupFont();

    const commands = [
        new SlashCommandBuilder()
            .setName('지급완료')
            .setDescription('구매 데이터를 기록하고 로그를 전송합니다.')
            .addUserOption(option => option.setName('구매자').setDescription('유저 선택').setRequired(true))
            .addIntegerOption(option => option.setName('금액').setDescription('거래 금액').setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
        console.log(`${client.user.username} 구동 완료!`);
    } catch (error) {
        console.error('슬래시 명령어 동기화 실패:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === '지급완료') {
        if (!interaction.member.permissions.has(GatewayIntentBits.Administrator)) {
            return interaction.reply({ content: "권한이 없습니다.", ephemeral: true });
        }

        const 구매자 = interaction.options.getUser('구매자');
        const 금액 = interaction.options.getInteger('금액');

        await update_user_purchase(구매자.id, 금액);
        
        const success_embed = new EmbedBuilder()
            .setDescription(`**${구매자}님, 아이템이 정상적으로 지급되었어요.**`)
            .setColor(0xFFC1D6)
            .setFields([{ name: "", value: "리뷰 작성은 필수입니다." }]);
        await interaction.reply({ embeds: [success_embed] });

        const log_channel = client.channels.cache.get(PURCHASE_LOG_CHANNEL_ID);
        if (log_channel) {
            const user_data = await db.get(`user_${구매자.id}`);
            const log_embed = new EmbedBuilder()
                .setTitle("아이템 지급 완료 로그")
                .setColor(0xFFC1D6)
                .setTimestamp()
                .addFields(
                    { name: "구매자", value: `${구매자} (${구매자.id})`, inline: true },
                    { name: "처리 관리자", value: `${interaction.user}`, inline: true },
                    { name: "거래 금액", value: `₩${금액.toLocaleString()}`, inline: false },
                    { name: "유저 누적 금액", value: `₩${user_data.total_amount.toLocaleString()}`, inline: true },
                    { name: "유저 누적 횟수", value: `${user_data.buy_count}회`, inline: true }
                );
            await log_channel.send({ embeds: [log_embed] });
        }
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith('$')) return;

    const command = message.content.substring(1).trim().split(' ');
    
    if (command[0] === '정보') {
        const target = message.mentions.users.first() || message.author;
        const member = message.guild.members.cache.get(target.id);
        
        const user_key = `user_${target.id}`;
        let user_data = await db.get(user_key) || { total_amount: 0, buy_count: 0, max_amount: 0 };
        
        const roleInfo = getRoleInfo(member, SERVER_ROLES_CONFIG);
        const buyTier = getBuyTierInfo(member);

        const W = 1000, H = 480;
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');

        // 메인 박스
        drawRoundedRect(ctx, 10, 10, W - 20, H - 20, 24);
        ctx.fillStyle = "#141318";
        ctx.fill();
        ctx.strokeStyle = "#232029";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 핑크 네온 글로우
        const glow = ctx.createRadialGradient(W - 80, 20, 10, W - 80, 20, 320);
        glow.addColorStop(0, 'rgba(252, 165, 165, 0.07)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);

        // 아바타
        await drawCircleAvatar(ctx, target.displayAvatarURL({ extension: 'png', size: 128 }), 50, 48, 110, roleInfo.color, roleInfo.hasCrown);

        // 닉네임 & 디스코드 ID
        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold 34px ${FONT_FAMILY}`;
        ctx.fillText(target.username, 185, 85);

        ctx.fillStyle = "#55505C";
        ctx.font = `16px ${FONT_FAMILY}`;
        ctx.fillText("#0001", 185, 113);

        // 역할 표시 (관리자/오너만 왕관 출력)
        let roleStartX = 185;
        if (roleInfo.hasCrown) {
            drawCrownIcon(ctx, 185, 128, 14, roleInfo.color);
            roleStartX = 205;
        }
        ctx.fillStyle = roleInfo.color;
        ctx.font = `bold 16px ${FONT_FAMILY}`;
        ctx.fillText(roleInfo.name, roleStartX, 141);

        // 가입일
        await drawSvgIcon(ctx, ICONS.calendar, 510, 62, 20, 20);
        ctx.fillStyle = "#726D7A";
        ctx.font = `13px ${FONT_FAMILY}`;
        ctx.fillText("가입일", 538, 74);
        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold 17px ${FONT_FAMILY}`;
        const joined_str = member ? member.joinedAt.toLocaleDateString('ko-KR').replace(/\. /g, '.').slice(0, -1) : "2020.01.02";
        ctx.fillText(joined_str, 538, 101);

        // 세로 구분선
        ctx.strokeStyle = "#232029";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(650, 65);
        ctx.lineTo(650, 115);
        ctx.stroke();

        // 서버 정보
        await drawSvgIcon(ctx, ICONS.discord, 678, 62, 22, 22);
        ctx.fillStyle = "#726D7A";
        ctx.font = `13px ${FONT_FAMILY}`;
        ctx.fillText("서버", 708, 74);
        
        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold 16px ${FONT_FAMILY}`;
        const raw_guild_name = cleanText(message.guild.name);
        const guild_name = raw_guild_name.length > 16 ? `${raw_guild_name.substring(0, 16)}...` : raw_guild_name;
        ctx.fillText(`${guild_name} >`, 708, 98);

        ctx.fillStyle = "#3F3A46";
        ctx.font = `10px ${FONT_FAMILY}`;
        ctx.fillText("SINCE 2020", 708, 114);

        // 하단 카드 4개 규격 조정
        const card_y = 190, card_h = 200, card_w = 210, gap = 16, start_x = 42;
        const card_bg = "#1A1820";

        // Card 1: 총 거래량
        drawRoundedRect(ctx, start_x, card_y, card_w, card_h, 16);
        ctx.fillStyle = card_bg;
        ctx.fill();
        await drawSvgIcon(ctx, ICONS.coin, start_x + 16, card_y + 18, 22, 22);
        ctx.fillStyle = "#A39EAB";
        ctx.font = `15px ${FONT_FAMILY}`;
        ctx.fillText("총 거래량", start_x + 48, card_y + 35);

        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold 28px ${FONT_FAMILY}`;
        ctx.fillText(`₩${user_data.total_amount.toLocaleString()}`, start_x + 16, card_y + 100);

        ctx.fillStyle = "#635E6C";
        ctx.font = `12px ${FONT_FAMILY}`;
        ctx.fillText("최대 거래 금액", start_x + 16, card_y + 150);
        ctx.fillStyle = "#D1D5DB";
        ctx.font = `bold 14px ${FONT_FAMILY}`;
        ctx.fillText(`₩${user_data.max_amount.toLocaleString()}`, start_x + 16, card_y + 172);

        // Card 2: 총 거래 횟수
        const x_2 = start_x + card_w + gap;
        drawRoundedRect(ctx, x_2, card_y, card_w, card_h, 16);
        ctx.fillStyle = card_bg;
        ctx.fill();
        await drawSvgIcon(ctx, ICONS.list, x_2 + 16, card_y + 18, 22, 22);
        ctx.fillStyle = "#A39EAB";
        ctx.font = `15px ${FONT_FAMILY}`;
        ctx.fillText("총 거래 횟수", x_2 + 48, card_y + 35);

        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold 36px ${FONT_FAMILY}`;
        ctx.fillText(`${user_data.buy_count}`, x_2 + 16, card_y + 105);

        // Card 3: 역할 / 구매 등급 (구매 등급 없으면 NONE)
        const x_3 = start_x + (card_w + gap) * 2;
        drawRoundedRect(ctx, x_3, card_y, card_w, card_h, 16);
        ctx.fillStyle = card_bg;
        ctx.fill();
        await drawSvgIcon(ctx, ICONS.user, x_3 + 16, card_y + 18, 22, 22);
        ctx.fillStyle = "#A39EAB";
        ctx.font = `15px ${FONT_FAMILY}`;
        ctx.fillText("역할", x_3 + 48, card_y + 35);

        if (buyTier) {
            ctx.fillStyle = buyTier.color;
            ctx.font = `bold 22px ${FONT_FAMILY}`;
            ctx.fillText(buyTier.name, x_3 + 16, card_y + 105);
        } else {
            ctx.fillStyle = "#635E6C";
            ctx.font = `bold 24px ${FONT_FAMILY}`;
            ctx.fillText("NONE", x_3 + 16, card_y + 105);
        }

        // Card 4: 초대 횟수 & 서버 순위
        const x_4 = start_x + (card_w + gap) * 3;
        drawRoundedRect(ctx, x_4, card_y, card_w, card_h, 16);
        ctx.fillStyle = card_bg;
        ctx.fill();
        await drawSvgIcon(ctx, ICONS.users, x_4 + 16, card_y + 18, 22, 22);
        ctx.fillStyle = "#A39EAB";
        ctx.font = `15px ${FONT_FAMILY}`;
        ctx.fillText("초대 횟수", x_4 + 48, card_y + 35);

        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold 36px ${FONT_FAMILY}`;
        ctx.fillText("0", x_4 + 16, card_y + 105);

        ctx.fillStyle = "#635E6C";
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText("서버 순위", x_4 + 16, card_y + 168);

        const purchase_rank_str = await get_user_rank(target.id);
        ctx.fillStyle = roleInfo.color;
        ctx.font = `bold 28px ${FONT_FAMILY}`;
        ctx.fillText(purchase_rank_str, x_4 + 125, card_y + 168);

        // 하단 안내 정보
        await drawSvgIcon(ctx, ICONS.info, 42, 425, 16, 16);
        ctx.fillStyle = "#484350";
        ctx.font = `12px ${FONT_FAMILY}`;
        ctx.fillText("2026.09.06 이후의 데이터만 기록됩니다.", 64, 438);
        ctx.fillText("SODDU DISCORD SERVER", 780, 438);

        const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'profile.png' });
        await message.reply({ files: [attachment] });
    }
});

client.login(TOKEN);
