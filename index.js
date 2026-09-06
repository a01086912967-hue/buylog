const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas'); // Node.js용 이미지 라이브러리
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args)); // Node.js용 HTTP 라이브러리
const { QuickDB } = require('quick.db'); // 데이터를 파일에 영구 저장하는 간단 DB
const dotenv = require('dotenv');
const { join } = require('path');

dotenv.config();
const TOKEN = process.env.DISCORD_TOKEN;

// 디스코드 설정
const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
];
const client = new Client({ intents });

// --- [ 설정 구역 ] ---
const GUILD_ID = '1456729030459134115';
const PURCHASE_LOG_CHANNEL_ID = '1457384858065047663';

// 데이터베이스 초기화 (코드가 있는 폴더에 database.sqlite 파일이 생기며 데이터가 영구 저장됩니다)
const db = new QuickDB();

// 폰트 설정 (윈도우/리눅스/맥 시스템 기본 고딕체 사용)
const FONT_FAMILY = 'Malgun Gothic, AppleGothic, sans-serif';

// 서버 역할 우선순위 (위에서부터 높은 순)
const SERVER_ROLES_CONFIG = [
    { id: '1456729030459134117', name: '방장 👑' },
    { id: '1458178323434836199', name: '서버 관리자 👑' },
    { id: '1545686320993796126', name: '서버 관리자 👑' },
    { id: '1529484356748574720', name: '판매자 💎' },
    { id: '1522815168286036098', name: '판매자 💎' },
    { id: '1456735270119411734', name: '회원 👤' }
];

// 구매 등급 우선순위 (위에서부터 높은 순)
const BUY_TIERS_CONFIG = [
    { id: '1489943721146449920', name: 'Crystal 💎' },
    { id: '1456737896525725719', name: 'Emerald 🟢' },
    { id: '1456736865779581031', name: 'Ruby 🔴' },
    { id: '1456736771344826535', name: 'Gold 🟡' },
    { id: '1456736573797171384', name: 'Silver ⚪' },
    { id: '1457383788236505299', name: 'Bronze 🟤' }
];


// --- [ 데이터베이스 관련 함수 (quick.db 사용) ] ---

// 유저 구매 데이터 업데이트 (DB 파일에 즉시 저장)
async function update_user_purchase(user_id, amount) {
    const user_key = `user_${user_id}`;
    
    // 데이터가 없으면 기본값으로 초기화
    if (!await db.has(user_key)) {
        await db.set(user_key, { total_amount: 0, buy_count: 0, max_amount: 0 });
    }

    // 금액 및 횟수 추가
    await db.add(`${user_key}.total_amount`, amount);
    await db.add(`${user_key}.buy_count`, 1);

    // 단일 최대 거래 금액 업데이트
    const current_data = await db.get(user_key);
    if (amount > current_data.max_amount) {
        await db.set(`${user_key}.max_amount`, amount);
    }
    
    console.log(`💾 DB 저장 완료: 유저 ${user_id} - 금액 ₩${amount.toLocaleString()} 추가`);
}

// 총 구매 금액 기준 유저의 순위 가져오기 (DB 데이터를 전체 계산)
async function get_user_rank(user_id) {
    const all_data = await db.all();
    // 유저 데이터만 필터링
    const user_entries = all_data.filter(entry => entry.id.startsWith('user_'));

    // 총 구매 금액 내림차순 정렬
    user_entries.sort((a, b) => b.value.total_amount - a.value.total_amount);

    const rankIndex = user_entries.findIndex(entry => entry.id === `user_${user_id}`);
    
    if (rankIndex !== -1) {
        return `#${rankIndex + 1}`;
    }
    
    // 데이터가 없으면 현재 데이터가 있는 유저 수 + 1 표시
    return `#${user_entries.length + 1}`;
}


// --- [ 유틸리티 함수 ] ---

// 멤버가 가진 가장 높은 우선순위의 역할 이름을 가져옴
function getHighestRoleName(member, config_list, default_name = '회원 👤') {
    if (!member) return default_name;
    for (const role_info of config_list) {
        if (member.roles.cache.has(role_info.id)) {
            return role_info.name;
        }
    }
    return default_name;
}

// 둥글게 자른 아바타 그리기 함수
async function drawCircleAvatar(ctx, url, x, y, size) {
    try {
        const avatarBuffer = await fetch(url).then(res => res.arrayBuffer());
        const avatarImg = await loadImage(Buffer.from(avatarBuffer));
        
        ctx.save();
        ctx.beginPath();
        // 둥근 원 마스크 생성
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.clip(); // 마스크 영역 안쪽에만 그리기
        
        ctx.drawImage(avatarImg, x, y, size, size);
        ctx.restore();
        
        // 아바타 다크 핑크 테두리
        ctx.strokeStyle = '#FFC1D6';
        ctx.lineWidth = 3;
        ctx.stroke();
    } catch (e) {
        console.error(`❌ 아바타 로드 실패 (URL: ${url}): ${e}`);
    }
}


// --- [ 디스코드 이벤트 및 명령어 ] ---

client.once('ready', async () => {
    // 슬래시 명령어 등록
    const commands = [
        new SlashCommandBuilder()
            .setName('지급완료')
            .setDescription('구매 데이터를 기록하고 로그를 전송합니다.')
            .addUserOption(option => option.setName('구매자').setDescription('아이템을 지급받을 유저').setRequired(true))
            .addIntegerOption(option => option.setName('금액').setDescription('거래 금액 (숫자만 입력)').setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        // 길드 전용 명령어로 등록
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
        console.log(`✅ ${client.user.username} 봇 준비 완료 및 명령어 동기화 완료!`);
        console.log(`   데이터베이스: database.sqlite 파일에 영구 저장됩니다.`);
    } catch (error) {
        console.error('❌ 명령어 동기화 실패:', error);
    }
});

// 슬래시 명령어 핸들러
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === '지급완료') {
        // 권한 체크
        if (!interaction.member.permissions.has(GatewayIntentBits.Administrator)) {
            return interaction.reply({ content: "❌ 이 명령어를 사용할 권한이 없습니다.", ephemeral: true });
        }

        const 구매자 = interaction.options.getUser('구매자');
        const 금액 = interaction.options.getInteger('금액');

        // 데이터베이스 업데이트 (파일에 영구 저장)
        await update_user_purchase(구매자.id, 금액);
        
        // 구매 완료 응답 (봇이 명령어를 실행한 채널)
        const success_embed = new EmbedBuilder()
            .setDescription(`**${구매자}님, 아이템이 정상적으로 지급되었어요.** <a:veryheart:1479957265871143104>`)
            .setColor(0xFFC1D6) // 다크 핑크 테마
            .setFields([{ name: "", value: "리뷰 작성은 필수입니다.\n(채널 링크는 실제 채널에 맞게 수정 필요)" }]);
        await interaction.reply({ embeds: [success_embed] });

        // 구매 로그 채널로 로그 전송
        const log_channel = client.channels.cache.get(PURCHASE_LOG_CHANNEL_ID);
        if (log_channel) {
            // DB에서 최신 데이터 가져오기
            const user_data = await db.get(`user_${구매자.id}`);
            const log_embed = new EmbedBuilder()
                .setTitle("🛍️ 아이템 지급 완료 로그")
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
        } else {
            console.error(`❌ 로그 채널 (ID: ${PURCHASE_LOG_CHANNEL_ID})을 찾을 수 없습니다.`);
        }
    }
});


// 텍스트 명령어 핸들러
client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith('$')) return;

    const command = message.content.substring(1).trim().split(' ');
    const cmd_name = command[0];
    
    // --- [ $정보 명령 ] ---
    if (cmd_name == '정보') {
        const target = message.mentions.users.first() || message.author;
        // 멤버 객체 가져오기 (역할 확인용)
        const member = message.guild.members.cache.get(target.id);
        
        // 1. 데이터베이스에서 유저 데이터 가져오기 (로드)
        const user_key = `user_${target.id}`;
        let user_data = await db.get(user_key);
        if (!user_data) {
            // DB에 데이터가 없는 신규 유저 기본값
            user_data = { total_amount: 0, buy_count: 0, max_amount: 0 };
        }
        
        // 2. 이미지 생성 시작
        const W = 900, H = 480;
        const bg_color = "#121114"; // 다크 배경
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');

        // 배경 그리기
        ctx.fillStyle = bg_color;
        ctx.fillRect(0, 0, W, H);

        // --- 상단 프로필 구역 ---
        // 아바타 원형으로 그리기
        await drawCircleAvatar(ctx, target.displayAvatarURL({ extension: 'png', size: 128 }), 60, 60, 110);

        // 닉네임 및 디스코드 ID 그리기
        ctx.fillStyle = "white";
        ctx.font = `bold 32px ${FONT_FAMILY}`;
        ctx.fillText(target.username, 195, 95);

        ctx.fillStyle = "#8B858F";
        ctx.font = `16px ${FONT_FAMILY}`;
        ctx.fillText(`@${target.username}`, 195, 122);

        // 유저 이름 아래 '서버 역할' 그리기
        const highest_server_role = getHighestRoleName(member, SERVER_ROLES_CONFIG);
        ctx.fillStyle = "#FFC1D6"; // 다크 핑크
        ctx.font = `18px ${FONT_FAMILY}`;
        ctx.fillText(highest_server_role, 195, 153);

        // 상단 우측 가입일 및 서버 정보 구역
        const joined_str = member ? member.joinedAt.toLocaleDateString('ko-KR') : "2026. 09. 06";
        ctx.fillStyle = "#8B858F";
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText("가입일", 520, 85);
        ctx.fillStyle = "white";
        ctx.font = `16px ${FONT_FAMILY}`;
        ctx.fillText(joined_str, 520, 105);
        
        // 구분선 그리기
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
        // 서버 이름이 길면 자름
        const guild_name = message.guild.name.length > 15 ? `${message.guild.name.substring(0, 15)}...` : message.guild.name;
        ctx.fillText(guild_name, 700, 105);

        // --- 메인 데이터 카드 4개 구역 ---
        const card_y = 200, card_h = 190, card_w = 195, gap = 15;
        const card_bg = "#1B191E"; // 카드 배경색

        // 카드용 폰트 스타일 정의
        const font_card_title = `15px ${FONT_FAMILY}`;
        const font_card_value = `bold 32px ${FONT_FAMILY}`; // 거래횟수, 순위용
        const font_card_money = `22px ${FONT_FAMILY}`; // 총거래량용
        const font_card_tier = `20px ${FONT_FAMILY}`; // 구매등급용
        const font_card_sub = `12px ${FONT_FAMILY}`; // 최대거래금액 레이블용

        // 1. 총 거래량 카드 (최대 거래 금액 포함)
        ctx.fillStyle = card_bg;
        ctx.beginPath();
        ctx.roundRect(40, card_y, card_w, card_h, 16);
        ctx.fill();
        ctx.fillStyle = "#8B858F";
        ctx.font = font_card_title;
        ctx.fillText("총 거래량", 60, card_y + 40);
        ctx.fillStyle = "white";
        ctx.font = `bold ${font_card_money}`;
        ctx.fillText(`₩${user_data.total_amount.toLocaleString()}`, 60, card_y + 85);
        
        ctx.fillStyle = "#8B858F";
        ctx.font = font_card_sub;
        ctx.fillText("최대 거래 금액", 60, card_y + 130);
        ctx.fillStyle = "#DDDDDD";
        ctx.font = `bold ${font_card_sub}`;
        ctx.fillText(`₩${user_data.max_amount.toLocaleString()}`, 60, card_y + 150);


        // 2. 총 거래 횟수 카드
        const x_2 = 40 + card_w + gap;
        ctx.fillStyle = card_bg;
        ctx.beginPath();
        ctx.roundRect(x_2, card_y, card_w, card_h, 16);
        ctx.fill();
        ctx.fillStyle = "#8B858F";
        ctx.font = font_card_title;
        ctx.fillText("총 거래 횟수", x_2 + 20, card_y + 40);
        ctx.fillStyle = "white";
        ctx.font = font_card_value;
        ctx.fillText(`${user_data.buy_count}`, x_2 + 20, card_y + 85);

        // 3. '구매 등급' 카드 (다크 핑크 테마)
        const x_3 = 40 + (card_w + gap) * 2;
        ctx.fillStyle = card_bg;
        ctx.beginPath();
        ctx.roundRect(x_3, card_y, card_w, card_h, 16);
        ctx.fill();
        ctx.fillStyle = "#8B858F";
        ctx.font = font_card_title;
        ctx.fillText("구매 등급", x_3 + 20, card_y + 40);
        // 유저의 가장 높은 구매 등급 가져오기
        const highest_tier_role = getHighestRoleName(member, BUY_TIERS_CONFIG, 'NONE');
        ctx.fillStyle = "#FFC1D6"; // 다크 핑크
        ctx.font = `bold ${font_card_tier}`;
        ctx.fillText(highest_tier_role, x_3 + 20, card_y + 85);


        // 4. '서버 구매 순위' 카드 (DB에서 실시간 계산)
        const x_4 = 40 + (card_w + gap) * 3;
        ctx.fillStyle = card_bg;
        ctx.beginPath();
        ctx.roundRect(x_4, card_y, card_w, card_h, 16);
        ctx.fill();
        ctx.fillStyle = "#8B858F";
        ctx.font = font_card_title;
        ctx.fillText("서버 구매 순위", x_4 + 20, card_y + 40);
        // DB 전체 데이터를 기반으로 유저의 순위 계산
        const purchase_rank_str = await get_user_rank(target.id);
        ctx.fillStyle = "#FFC1D6"; // 다크 핑크
        ctx.font = font_card_value;
        ctx.fillText(purchase_rank_str, x_4 + 20, card_y + 85);


        // --- 하단 풋터 구역 ---
        const font_footer = `12px ${FONT_FAMILY}`;
        ctx.fillStyle = "#5A555E";
        ctx.font = font_footer;
        ctx.fillText('ⓘ  2026.09.06 이후의 데이터만 기록됩니다.', 40, 435);
        ctx.fillText('SODDU DISCORD SERVER', 710, 435);

        // 이미지 전송
        const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'profile.png' });
        await message.channel.send({ files: [attachment] });
    }
});

// 봇 실행
client.login(TOKEN);
