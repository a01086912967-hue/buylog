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

// 요청하신 색상 매핑이 적용된 역할 설정
const SERVER_ROLES_CONFIG = [
    { id: '1456729030459134117', name: '서버 오너', color: '#FF79C6' },    // 핑크색
    { id: '1458178323434836199', name: '서버 관리자', color: '#5775A8' },  // 남색
    { id: '1545686320993796126', name: '서버 관리자', color: '#5775A8' },  // 남색
    { id: '1529484356748574720', name: '판매자', color: '#50FA7B' },       // 민트색
    { id: '1522815168286036098', name: '판매자', color: '#50FA7B' },       // 민트색
    { id: '1456735270119411734', name: '회원', color: '#A3E635' }          // 연두색
];

const BUY_TIERS_CONFIG = [
    { id: '1489943721146449920', name: 'Crystal', color: '#C084FC' },     // 연보라
    { id: '1456737896525725719', name: 'Emerald', color: '#34D399' },     // 에메랄드
    { id: '1456736865779581031', name: 'Ruby', color: '#F87171' },        // 빨간색
    { id: '1456736771344826535', name: 'Gold', color: '#FACC15' },        // 노란색
    { id: '1456736573797171384', name: 'Silver', color: '#FB923C' },      // 주황색
    { id: '1457383788236505299', name: 'Bronze', color: '#D97706' }       // 갈색~주황빛
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

function getRoleInfo(member, config_list, default_name = '회원', default_color = '#A3E635') {
    if (!member) return { name: default_name, color: default_color };
    for (const role_info of config_list) {
        if (member.roles.cache.has(role_info.id)) {
            return { name: role_info.name, color: role_info.color };
        }
    }
    return { name: default_name, color: default_color };
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

// 원본 왕관 백터 그리기
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

// 원본 카드 아이콘 백터화 (동전, 문서, 유저, 초대)
function drawCardIcon(ctx, x, y, type) {
    ctx.save();
    ctx.fillStyle = "#272129";
    drawRoundedRect(ctx, x, y, 32, 32, 10);
    ctx.fill();

    ctx.strokeStyle = "#FCA5A5";
    ctx.lineWidth = 2;
    ctx.beginPath();

    if (type === 'coin') {
        ctx.ellipse(x + 16, y + 12, 7, 3, 0, 0, Math.PI * 2);
        ctx.moveTo(x + 9, y + 12); ctx.lineTo(x + 9, y + 19); ctx.arcTo(x + 16, y + 23, x + 23, y + 19, 7); ctx.lineTo(x + 23, y + 12);
    } else if (type === 'list') {
        ctx.rect(x + 10, y + 8, 12, 16);
        ctx.moveTo(x + 13, y + 12); ctx.lineTo(x + 19, y + 12);
        ctx.moveTo(x + 13, y + 16); ctx.lineTo(x + 17, y + 16);
    } else if (type === 'user') {
        ctx.arc(x + 16, y + 12, 4, 0, Math.PI * 2);
        ctx.moveTo(x + 10, y + 22); ctx.arcTo(x + 16, y + 17, x + 22, y + 22, 6);
    } else if (type === 'users') {
        ctx.arc(x + 13, y + 12, 3, 0, Math.PI * 2);
        ctx.arc(x + 19, y + 12, 3, 0, Math.PI * 2);
        ctx.moveTo(x + 8, y + 21); ctx.arcTo(x + 13, y + 17, x + 18, y + 21, 5);
    }
    ctx.stroke();
    ctx.restore();
}

async function drawCircleAvatar(ctx, url, x, y, size, roleColor) {
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
        
        // 원본과 동일한 프로필 테두리 링
        ctx.strokeStyle = roleColor;
        ctx.lineWidth = 3.5;
        ctx.stroke();

        // 우측 하단 왕관 포인트 뱃지
        const badgeX = x + size - 16;
        const badgeY = y + size - 20;
        ctx.fillStyle = roleColor;
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, 13, 0, Math.PI * 2);
        ctx.fill();
        
        drawCrownIcon(ctx, badgeX - 7, badgeY - 7, 14, '#16151A');
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
        const tierInfo = getRoleInfo(member, BUY_TIERS_CONFIG, 'NONE', '#8B858F');

        const W = 1040, H = 510;
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');

        // 메인 프레임
        drawRoundedRect(ctx, 12, 12, W - 24, H - 24, 28);
        ctx.fillStyle = "#121115";
        ctx.fill();
        ctx.strokeStyle = "#25222B";
        ctx.lineWidth = 2;
        ctx.stroke();

        // 핑크 우측 상단 네온 글로우
        const glow = ctx.createRadialGradient(W - 80, 20, 10, W - 80, 20, 350);
        glow.addColorStop(0, 'rgba(252, 165, 165, 0.08)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);

        // 아바타
        await drawCircleAvatar(ctx, target.displayAvatarURL({ extension: 'png', size: 128 }), 55, 55, 125, roleInfo.color);

        // 닉네임 & 디스코드 ID
        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold 42px ${FONT_FAMILY}`;
        ctx.fillText(target.username, 215, 95);

        ctx.fillStyle = "#55505C";
        ctx.font = `20px ${FONT_FAMILY}`;
        ctx.fillText("#0001", 215, 130);

        // 왕관 아이콘 + 서버 역할 이름
        drawCrownIcon(ctx, 215, 147, 16, roleInfo.color);
        ctx.fillStyle = roleInfo.color;
        ctx.font = `bold 18px ${FONT_FAMILY}`;
        ctx.fillText(roleInfo.name, 238, 162);

        // 가입일 & 서버 정보 영역
        ctx.fillStyle = "#726D7A";
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText("가입일", 550, 80);
        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold 19px ${FONT_FAMILY}`;
        const joined_str = member ? member.joinedAt.toLocaleDateString('ko-KR').replace(/\. /g, '.').slice(0, -1) : "2020.01.02";
        ctx.fillText(joined_str, 550, 110);

        ctx.strokeStyle = "#25222B";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(690, 70);
        ctx.lineTo(690, 120);
        ctx.stroke();

        ctx.fillStyle = "#726D7A";
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText("서버", 720, 80);
        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold 19px ${FONT_FAMILY}`;
        const guild_name = message.guild.name.length > 16 ? `${message.guild.name.substring(0, 16)}...` : message.guild.name;
        ctx.fillText(`${guild_name} >`, 720, 110);

        // 하단 카드 4개
        const card_y = 210, card_h = 215, card_w = 218, gap = 17, start_x = 48;
        const card_bg = "#1A1820";

        // Card 1: 총 거래량
        drawRoundedRect(ctx, start_x, card_y, card_w, card_h, 20);
        ctx.fillStyle = card_bg;
        ctx.fill();
        drawCardIcon(ctx, start_x + 18, card_y + 22, 'coin');
        ctx.fillStyle = "#A39EAB";
        ctx.font = `16px ${FONT_FAMILY}`;
        ctx.fillText("총 거래량", start_x + 58, card_y + 43);

        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold 32px ${FONT_FAMILY}`;
        ctx.fillText(`₩${user_data.total_amount.toLocaleString()}`, start_x + 18, card_y + 110);

        ctx.fillStyle = "#635E6C";
        ctx.font = `13px ${FONT_FAMILY}`;
        ctx.fillText("최대 거래 금액", start_x + 18, card_y + 160);
        ctx.fillStyle = "#D1D5DB";
        ctx.font = `bold 15px ${FONT_FAMILY}`;
        ctx.fillText(`₩${user_data.max_amount.toLocaleString()}`, start_x + 18, card_y + 185);

        // Card 2: 총 거래 횟수
        const x_2 = start_x + card_w + gap;
        drawRoundedRect(ctx, x_2, card_y, card_w, card_h, 20);
        ctx.fillStyle = card_bg;
        ctx.fill();
        drawCardIcon(ctx, x_2 + 18, card_y + 22, 'list');
        ctx.fillStyle = "#A39EAB";
        ctx.font = `16px ${FONT_FAMILY}`;
        ctx.fillText("총 거래 횟수", x_2 + 58, card_y + 43);

        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold 40px ${FONT_FAMILY}`;
        ctx.fillText(`${user_data.buy_count}`, x_2 + 18, card_y + 115);

        // Card 3: 구매 등급 / 역할
        const x_3 = start_x + (card_w + gap) * 2;
        drawRoundedRect(ctx, x_3, card_y, card_w, card_h, 20);
        ctx.fillStyle = card_bg;
        ctx.fill();
        drawCardIcon(ctx, x_3 + 18, card_y + 22, 'user');
        ctx.fillStyle = "#A39EAB";
        ctx.font = `16px ${FONT_FAMILY}`;
        ctx.fillText("역할", x_3 + 58, card_y + 43);

        ctx.fillStyle = tierInfo.color;
        ctx.font = `bold 22px ${FONT_FAMILY}`;
        ctx.fillText(tierInfo.name, x_3 + 18, card_y + 115);
        if (tierInfo.name !== 'NONE') {
            drawCrownIcon(ctx, x_3 + 18 + ctx.measureText(tierInfo.name).width + 8, card_y + 98, 16, tierInfo.color);
        }

        // Card 4: 초대 횟수 & 서버 순위
        const x_4 = start_x + (card_w + gap) * 3;
        drawRoundedRect(ctx, x_4, card_y, card_w, card_h, 20);
        ctx.fillStyle = card_bg;
        ctx.fill();
        drawCardIcon(ctx, x_4 + 18, card_y + 22, 'users');
        ctx.fillStyle = "#A39EAB";
        ctx.font = `16px ${FONT_FAMILY}`;
        ctx.fillText("초대 횟수", x_4 + 58, card_y + 43);

        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold 40px ${FONT_FAMILY}`;
        ctx.fillText("0", x_4 + 18, card_y + 115);

        ctx.fillStyle = "#635E6C";
        ctx.font = `15px ${FONT_FAMILY}`;
        ctx.fillText("서버 순위", x_4 + 18, card_y + 180);

        const purchase_rank_str = await get_user_rank(target.id);
        ctx.fillStyle = roleInfo.color;
        ctx.font = `bold 32px ${FONT_FAMILY}`;
        ctx.fillText(purchase_rank_str, x_4 + 130, card_y + 180);

        // 하단 서명 문구
        ctx.fillStyle = "#484350";
        ctx.font = `12px ${FONT_FAMILY}`;
        ctx.fillText("ⓘ  2026.09.06 이후의 데이터만 기록됩니다.", 48, 468);
        ctx.fillText("SODDU DISCORD SERVER", 810, 468);

        const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'profile.png' });
        await message.reply({ files: [attachment] });
    }
});

client.login(TOKEN);
