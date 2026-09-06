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

// 고급 폰트 (Pretendard) 다운로드 및 등록
let FONT_FAMILY = 'sans-serif';

async function setupFont() {
    const fontPath = path.join(__dirname, 'Pretendard-Bold.otf');
    try {
        if (!fs.existsSync(fontPath)) {
            console.log('Pretendard 폰트 다운로드 중...');
            const res = await fetch('https://github.com/orioncactus/pretendard/raw/main/packages/pretendard/dist/public/static/Pretendard-Bold.otf');
            const buffer = Buffer.from(await res.arrayBuffer());
            fs.writeFileSync(fontPath, buffer);
        }
        registerFont(fontPath, { family: 'Pretendard' });
        FONT_FAMILY = 'Pretendard';
        console.log('Pretendard 폰트 등록 완료!');
    } catch (e) {
        console.error('폰트 로드 실패, 기본 폰트를 사용합니다:', e);
    }
}

// 역할 설정
const SERVER_ROLES_CONFIG = [
    { id: '1456729030459134117', name: '방장' },
    { id: '1458178323434836199', name: '서버 관리자' },
    { id: '1545686320993796126', name: '서버 관리자' },
    { id: '1529484356748574720', name: '판매자' },
    { id: '1522815168286036098', name: '판매자' },
    { id: '1456735270119411734', name: '회원' }
];

const BUY_TIERS_CONFIG = [
    { id: '1489943721146449920', name: 'Crystal' },
    { id: '1456737896525725719', name: 'Emerald' },
    { id: '1456736865779581031', name: 'Ruby' },
    { id: '1456736771344826535', name: 'Gold' },
    { id: '1456736573797171384', name: 'Silver' },
    { id: '1457383788236505299', name: 'Bronze' }
];

// DB 유틸리티
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

function getHighestRoleName(member, config_list, default_name = '회원') {
    if (!member) return default_name;
    for (const role_info of config_list) {
        if (member.roles.cache.has(role_info.id)) {
            return role_info.name;
        }
    }
    return default_name;
}

// 캔버스 라운드 사각형 보조 함수
function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// 아이콘 뱃지 그리기 함수 (이미지 아이콘 스타일)
function drawIconBadge(ctx, x, y, type) {
    ctx.save();
    ctx.fillStyle = "#2D2028";
    drawRoundedRect(ctx, x, y, 28, 28, 8);
    ctx.fill();

    ctx.strokeStyle = "#FCA5A5";
    ctx.lineWidth = 2;
    ctx.beginPath();

    if (type === 'coin') {
        ctx.arc(x + 14, y + 14, 6, 0, Math.PI * 2);
    } else if (type === 'list') {
        ctx.moveTo(x + 8, y + 10); ctx.lineTo(x + 20, y + 10);
        ctx.moveTo(x + 8, y + 14); ctx.lineTo(x + 20, y + 14);
        ctx.moveTo(x + 8, y + 18); ctx.lineTo(x + 20, y + 18);
    } else if (type === 'user') {
        ctx.arc(x + 14, y + 11, 4, 0, Math.PI * 2);
        ctx.moveTo(x + 8, y + 21); ctx.arcTo(x + 14, y + 16, x + 20, y + 21, 6);
    } else if (type === 'users') {
        ctx.arc(x + 11, y + 11, 3, 0, Math.PI * 2);
        ctx.arc(x + 17, y + 11, 3, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.restore();
}

// 아바타 그리기
async function drawCircleAvatar(ctx, url, x, y, size) {
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
        
        ctx.strokeStyle = '#FCA5A5';
        ctx.lineWidth = 3;
        ctx.stroke();

        // 작은 핑크 서클 뱃지
        ctx.fillStyle = '#FCA5A5';
        ctx.beginPath();
        ctx.arc(x + size - 5, y + size - 15, 12, 0, Math.PI * 2);
        ctx.fill();
    } catch (e) {
        console.error(`아바타 로드 오류: ${e}`);
    }
}

// --- [ 이벤트 핸들러 ] ---

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

// $정보 명령어
client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith('$')) return;

    const command = message.content.substring(1).trim().split(' ');
    
    if (command[0] === '정보') {
        const target = message.mentions.users.first() || message.author;
        const member = message.guild.members.cache.get(target.id);
        
        const user_key = `user_${target.id}`;
        let user_data = await db.get(user_key) || { total_amount: 0, buy_count: 0, max_amount: 0 };
        
        const W = 1000, H = 500;
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');

        // 메인 배경 그라데이션 및 외곽 테두리
        drawRoundedRect(ctx, 10, 10, W - 20, H - 20, 24);
        ctx.fillStyle = "#16151A";
        ctx.fill();
        ctx.strokeStyle = "#2D262E";
        ctx.lineWidth = 2;
        ctx.stroke();

        // 은은한 네온 핑크 앰비언트 글로우 효과
        const glowGradient = ctx.createRadialGradient(W - 100, 0, 10, W - 100, 0, 400);
        glowGradient.addColorStop(0, 'rgba(252, 165, 165, 0.08)');
        glowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glowGradient;
        ctx.fillRect(0, 0, W, H);

        // 아바타
        await drawCircleAvatar(ctx, target.displayAvatarURL({ extension: 'png', size: 128 }), 55, 55, 120);

        // 유저이름 & 태그
        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold 38px ${FONT_FAMILY}`;
        ctx.fillText(target.username, 205, 95);

        ctx.fillStyle = "#6B6570";
        ctx.font = `20px ${FONT_FAMILY}`;
        ctx.fillText("#0001", 205, 130);

        const highest_server_role = getHighestRoleName(member, SERVER_ROLES_CONFIG);
        ctx.fillStyle = "#FCA5A5";
        ctx.font = `bold 18px ${FONT_FAMILY}`;
        ctx.fillText(highest_server_role, 205, 162);

        // 상단 우측 (가입일 & 서버 정보)
        ctx.fillStyle = "#7D7784";
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText("가입일", 520, 80);
        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold 18px ${FONT_FAMILY}`;
        const joined_str = member ? member.joinedAt.toLocaleDateString('ko-KR').replace(/\. /g, '.').slice(0, -1) : "2020.01.02";
        ctx.fillText(joined_str, 520, 108);

        ctx.strokeStyle = "#2A2630";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(660, 70);
        ctx.lineTo(660, 120);
        ctx.stroke();

        ctx.fillStyle = "#7D7784";
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText("서버", 690, 80);
        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold 18px ${FONT_FAMILY}`;
        const guild_name = message.guild.name.length > 18 ? `${message.guild.name.substring(0, 18)}...` : message.guild.name;
        ctx.fillText(`${guild_name} >`, 690, 108);

        // 하단 데이터 카드 4개
        const card_y = 205, card_h = 210, card_w = 210, gap = 18, start_x = 45;
        const card_bg = "#1D1B22";

        // 1. 총 거래량
        drawRoundedRect(ctx, start_x, card_y, card_w, card_h, 18);
        ctx.fillStyle = card_bg;
        ctx.fill();
        drawIconBadge(ctx, start_x + 18, card_y + 20, 'coin');
        ctx.fillStyle = "#A09A8E";
        ctx.font = `16px ${FONT_FAMILY}`;
        ctx.fillText("총 거래량", start_x + 55, card_y + 40);

        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold 30px ${FONT_FAMILY}`;
        ctx.fillText(`₩${user_data.total_amount.toLocaleString()}`, start_x + 18, card_y + 105);

        ctx.fillStyle = "#6B6570";
        ctx.font = `13px ${FONT_FAMILY}`;
        ctx.fillText("최대 거래 금액", start_x + 18, card_y + 155);
        ctx.fillStyle = "#D1D5DB";
        ctx.font = `bold 15px ${FONT_FAMILY}`;
        ctx.fillText(`₩${user_data.max_amount.toLocaleString()}`, start_x + 18, card_y + 180);

        // 2. 총 거래 횟수
        const x_2 = start_x + card_w + gap;
        drawRoundedRect(ctx, x_2, card_y, card_w, card_h, 18);
        ctx.fillStyle = card_bg;
        ctx.fill();
        drawIconBadge(ctx, x_2 + 18, card_y + 20, 'list');
        ctx.fillStyle = "#A09A8E";
        ctx.font = `16px ${FONT_FAMILY}`;
        ctx.fillText("총 거래 횟수", x_2 + 55, card_y + 40);

        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold 38px ${FONT_FAMILY}`;
        ctx.fillText(`${user_data.buy_count}`, x_2 + 18, card_y + 110);

        // 3. 구매 등급
        const x_3 = start_x + (card_w + gap) * 2;
        drawRoundedRect(ctx, x_3, card_y, card_w, card_h, 18);
        ctx.fillStyle = card_bg;
        ctx.fill();
        drawIconBadge(ctx, x_3 + 18, card_y + 20, 'user');
        ctx.fillStyle = "#A09A8E";
        ctx.font = `16px ${FONT_FAMILY}`;
        ctx.fillText("구매 등급", x_3 + 55, card_y + 40);

        const highest_tier_role = getHighestRoleName(member, BUY_TIERS_CONFIG, 'NONE');
        ctx.fillStyle = "#FCA5A5";
        ctx.font = `bold 22px ${FONT_FAMILY}`;
        ctx.fillText(highest_tier_role, x_3 + 18, card_y + 110);

        // 4. 서버 순위 카드
        const x_4 = start_x + (card_w + gap) * 3;
        drawRoundedRect(ctx, x_4, card_y, card_w, card_h, 18);
        ctx.fillStyle = card_bg;
        ctx.fill();
        drawIconBadge(ctx, x_4 + 18, card_y + 20, 'users');
        ctx.fillStyle = "#A09A8E";
        ctx.font = `16px ${FONT_FAMILY}`;
        ctx.fillText("초대 횟수", x_4 + 55, card_y + 40);

        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold 38px ${FONT_FAMILY}`;
        ctx.fillText("0", x_4 + 18, card_y + 110);

        ctx.fillStyle = "#6B6570";
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText("서버 순위", x_4 + 18, card_y + 175);

        const purchase_rank_str = await get_user_rank(target.id);
        ctx.fillStyle = "#FCA5A5";
        ctx.font = `bold 30px ${FONT_FAMILY}`;
        ctx.fillText(purchase_rank_str, x_4 + 120, card_y + 175);

        // 하단 푸터 문구
        ctx.fillStyle = "#55505A";
        ctx.font = `13px ${FONT_FAMILY}`;
        ctx.fillText("ⓘ  2026.09.06 이후의 데이터만 기록됩니다.", 45, 455);
        ctx.fillText("SODDU DISCORD SERVER", 780, 455);

        const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'profile.png' });
        await message.reply({ files: [attachment] });
    }
});

client.login(TOKEN);
