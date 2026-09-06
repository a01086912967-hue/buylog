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

// --- [ 서버 및 채널 설정 ] ---
const GUILD_ID = '1456729030459134115';
const PURCHASE_LOG_CHANNEL_ID = '1457384858065047663';

const db = new QuickDB();

// 한글 폰트 자동 다운로드 및 등록
let FONT_FAMILY = 'sans-serif';

async function setupFont() {
    const fontPath = path.join(__dirname, 'NanumGothic.ttf');
    try {
        if (!fs.existsSync(fontPath)) {
            console.log('한글 폰트 다운로드 중...');
            const res = await fetch('https://github.com/google/fonts/raw/main/ofl/nanumgothic/NanumGothic-Regular.ttf');
            const buffer = Buffer.from(await res.arrayBuffer());
            fs.writeFileSync(fontPath, buffer);
        }
        registerFont(fontPath, { family: 'NanumGothic' });
        FONT_FAMILY = 'NanumGothic';
        console.log('한글 폰트 등록 완료!');
    } catch (e) {
        console.error('폰트 로드 실패, 기본 폰트를 사용합니다:', e);
    }
}

// 서버 역할 우선순위
const SERVER_ROLES_CONFIG = [
    { id: '1456729030459134117', name: '방장' },
    { id: '1458178323434836199', name: '서버 관리자' },
    { id: '1545686320993796126', name: '서버 관리자' },
    { id: '1529484356748574720', name: '판매자' },
    { id: '1522815168286036098', name: '판매자' },
    { id: '1456735270119411734', name: '회원' }
];

// 구매 등급 우선순위
const BUY_TIERS_CONFIG = [
    { id: '1489943721146449920', name: 'Crystal' },
    { id: '1456737896525725719', name: 'Emerald' },
    { id: '1456736865779581031', name: 'Ruby' },
    { id: '1456736771344826535', name: 'Gold' },
    { id: '1456736573797171384', name: 'Silver' },
    { id: '1457383788236505299', name: 'Bronze' }
];

// --- [ DB 및 유틸리티 함수 ] ---

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
        
        ctx.strokeStyle = '#FFC1D6';
        ctx.lineWidth = 3;
        ctx.stroke();
    } catch (e) {
        console.error(`아바타 로드 오류: ${e}`);
    }
}

// --- [ 이벤트 핸들러 ] ---

client.once('ready', async () => {
    await setupFont(); // 폰트 준비

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
        
        const W = 900, H = 480;
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = "#121114";
        ctx.fillRect(0, 0, W, H);

        // 아바타 및 유저 정보
        await drawCircleAvatar(ctx, target.displayAvatarURL({ extension: 'png', size: 128 }), 60, 60, 110);

        ctx.fillStyle = "white";
        ctx.font = `bold 32px ${FONT_FAMILY}`;
        ctx.fillText(target.username, 195, 95);

        ctx.fillStyle = "#8B858F";
        ctx.font = `16px ${FONT_FAMILY}`;
        ctx.fillText(`@${target.username}`, 195, 122);

        const highest_server_role = getHighestRoleName(member, SERVER_ROLES_CONFIG);
        ctx.fillStyle = "#FFC1D6";
        ctx.font = `18px ${FONT_FAMILY}`;
        ctx.fillText(highest_server_role, 195, 153);

        // 가입일 & 서버 정보
        const joined_str = member ? member.joinedAt.toLocaleDateString('ko-KR') : "2026. 09. 06";
        ctx.fillStyle = "#8B858F";
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText("가입일", 520, 85);
        ctx.fillStyle = "white";
        ctx.font = `16px ${FONT_FAMILY}`;
        ctx.fillText(joined_str, 520, 105);
        
        ctx.strokeStyle = "#28242A";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(670, 75);
        ctx.lineTo(670, 125);
        ctx.stroke();
        
        ctx.fillStyle = "#8B858F";
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText("서버", 700, 85);
        ctx.fillStyle = "white";
        ctx.font = `16px ${FONT_FAMILY}`;
        const guild_name = message.guild.name.length > 15 ? `${message.guild.name.substring(0, 15)}...` : message.guild.name;
        ctx.fillText(guild_name, 700, 105);

        // 데이터 카드 4개
        const card_y = 200, card_h = 190, card_w = 195, gap = 15;
        const card_bg = "#1B191E";

        // 1. 총 거래량
        ctx.fillStyle = card_bg;
        ctx.beginPath();
        ctx.roundRect(40, card_y, card_w, card_h, 16);
        ctx.fill();
        ctx.fillStyle = "#8B858F";
        ctx.font = `15px ${FONT_FAMILY}`;
        ctx.fillText("총 거래량", 60, card_y + 40);
        ctx.fillStyle = "white";
        ctx.font = `bold 22px ${FONT_FAMILY}`;
        ctx.fillText(`₩${user_data.total_amount.toLocaleString()}`, 60, card_y + 85);
        ctx.fillStyle = "#8B858F";
        ctx.font = `12px ${FONT_FAMILY}`;
        ctx.fillText("최대 거래 금액", 60, card_y + 130);
        ctx.fillStyle = "#DDDDDD";
        ctx.font = `bold 12px ${FONT_FAMILY}`;
        ctx.fillText(`₩${user_data.max_amount.toLocaleString()}`, 60, card_y + 150);

        // 2. 총 거래 횟수
        const x_2 = 40 + card_w + gap;
        ctx.fillStyle = card_bg;
        ctx.beginPath();
        ctx.roundRect(x_2, card_y, card_w, card_h, 16);
        ctx.fill();
        ctx.fillStyle = "#8B858F";
        ctx.font = `15px ${FONT_FAMILY}`;
        ctx.fillText("총 거래 횟수", x_2 + 20, card_y + 40);
        ctx.fillStyle = "white";
        ctx.font = `bold 32px ${FONT_FAMILY}`;
        ctx.fillText(`${user_data.buy_count}`, x_2 + 20, card_y + 85);

        // 3. 구매 등급
        const x_3 = 40 + (card_w + gap) * 2;
        ctx.fillStyle = card_bg;
        ctx.beginPath();
        ctx.roundRect(x_3, card_y, card_w, card_h, 16);
        ctx.fill();
        ctx.fillStyle = "#8B858F";
        ctx.font = `15px ${FONT_FAMILY}`;
        ctx.fillText("구매 등급", x_3 + 20, card_y + 40);
        const highest_tier_role = getHighestRoleName(member, BUY_TIERS_CONFIG, 'NONE');
        ctx.fillStyle = "#FFC1D6";
        ctx.font = `bold 20px ${FONT_FAMILY}`;
        ctx.fillText(highest_tier_role, x_3 + 20, card_y + 85);

        // 4. 서버 구매 순위
        const x_4 = 40 + (card_w + gap) * 3;
        ctx.fillStyle = card_bg;
        ctx.beginPath();
        ctx.roundRect(x_4, card_y, card_w, card_h, 16);
        ctx.fill();
        ctx.fillStyle = "#8B858F";
        ctx.font = `15px ${FONT_FAMILY}`;
        ctx.fillText("서버 구매 순위", x_4 + 20, card_y + 40);
        const purchase_rank_str = await get_user_rank(target.id);
        ctx.fillStyle = "#FFC1D6";
        ctx.font = `bold 32px ${FONT_FAMILY}`;
        ctx.fillText(purchase_rank_str, x_4 + 20, card_y + 85);

        // 하단 문구
        ctx.fillStyle = "#5A555E";
        ctx.font = `12px ${FONT_FAMILY}`;
        ctx.fillText('2026.09.06 이후의 데이터만 기록됩니다.', 40, 435);
        ctx.fillText('SODDU DISCORD SERVER', 710, 435);

        const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'profile.png' });
        
        // 답장(Reply) 형식으로 이미지 전송
        await message.reply({ files: [attachment] });
    }
});

client.login(TOKEN);
