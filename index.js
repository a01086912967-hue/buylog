const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { QuickDB } = require('quick.db');
const db = new QuickDB(); // 데이터 저장용 Local DB (json 형태)

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

const TOKEN = process.env.TOKEN;
const PURCHASE_LOG_CHANNEL_ID = '1457384858065047663'; // 로그 채널 ID

// 구매 금액에 따른 등급 판정 함수
function getMemberRank(totalAmount) {
    if (totalAmount >= 100000) return 'VIP';
    if (totalAmount >= 50000) return 'Gold';
    if (totalAmount >= 10000) return 'Silver';
    return 'Bronze';
}

client.once('ready', async () => {
    console.log('봇 준비 완료!');

    const commands = [
        new SlashCommandBuilder()
            .setName('지급완료')
            .setDescription('지급 완료 알림 및 로그를 전송합니다.')
            .addStringOption(option => 
                option.setName('금액')
                    .setDescription('구매 금액 (숫자만 입력 ex: 10000)')
                    .setRequired(true))
            .addStringOption(option => 
                option.setName('상품')
                    .setDescription('구매한 상품명')
                    .setRequired(true))
            .addStringOption(option => 
                option.setName('수량')
                    .setDescription('구매 수량')
                    .setRequired(true))
            .addUserOption(option => 
                option.setName('구매자')
                    .setDescription('구매한 유저 (미입력 시 본인)')
                    .setRequired(false))
            .addUserOption(option => 
                option.setName('판매자')
                    .setDescription('담당 판매자 (미입력 시 본인)')
                    .setRequired(false))
    ];

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('슬래시 명령어 등록 완료!');
    } catch (error) {
        console.error('슬래시 명령어 등록 실패:', error);
    }
});

// 1. 슬래시 명령어 (/지급완료) 처리
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand() && interaction.commandName === '지급완료') {
        await interaction.reply({ content: '처리를 시작합니다.', ephemeral: true });

        const itemName = interaction.options.getString('상품');
        const itemQty = interaction.options.getString('수량');
        const amountStr = interaction.options.getString('금액');
        const amount = parseInt(amountStr.replace(/[^0-9]/g, '')) || 0; // 숫자만 추출하여 누적 계산

        const buyer = interaction.options.getUser('구매자') || interaction.user;
        const seller = interaction.options.getUser('판매자') || interaction.user;

        // DB에 구매 데이터 축적 (2026.09.06 기준 기록)
        await db.add(`user_${buyer.id}.totalAmount`, amount);
        await db.add(`user_${buyer.id}.buyCount`, 1);

        // 로그 채널 전송
        try {
            const logChannel = await client.channels.fetch(PURCHASE_LOG_CHANNEL_ID);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor(0xFFD1DC)
                    .setDescription(`°.✩┈┈∘┈˃̶ ୨<a:Pinkheartgif:1545408138377695352> ୧˂̶┈∘┈┈✩.°\n\n${buyer}, ${itemName} (${itemQty}개) 구매 감사합니다 .ᐟ.ᐟ\n\n사용된 금액 : ${amountStr}\n\n해당 관리 판매자: ${seller}\n\n°.✩┈┈∘┈˃̶ ୨<a:Pinkheartgif:1545408138377695352> ୧˂̶┈∘┈┈✩.°\n࣪𓏲ּ ᥫ᭡ ₊ 𝑻𝒉𝒂𝒏𝒌 𝒚𝒐𝒖 ⊹ ˑ ִֶ 𓂃`)
                    .setImage('https://i.imgur.com/jokl6LQ.gif');

                await logChannel.send({
                    content: `${buyer}`,
                    embeds: [logEmbed]
                });
            }
        } catch (error) {
            console.error("로그 채널 전송 오류:", error);
        }

        // 티켓 채널 전송
        const ticketEmbed = new EmbedBuilder()
            .setColor(0xFFD1DC)
            .setDescription(`**아이템이 정상적으로 지급되었어요.** <a:veryheart:1479957265871143104>\nhttps://discord.com/channels/1456729030459134115/1457384179535712473 작성은 필수입니다`);

        await interaction.channel.send({
            content: `${buyer}`,
            embeds: [ticketEmbed]
        });
    }
});

// 2. 메시지 감지 ($내정보) 처리
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content.trim() === '$내정보') {
        const user = message.author;
        const member = message.member;

        // DB에서 유저 누적 구매 기록 로드
        const totalAmount = (await db.get(`user_${user.id}.totalAmount`)) || 0;
        const buyCount = (await db.get(`user_${user.id}.buyCount`)) || 0;
        const userRank = getMemberRank(totalAmount);

        // 서버 가입일 포맷팅 (YYYY-MM-DD)
        const joinedAt = member?.joinedAt 
            ? member.joinedAt.toISOString().split('T')[0] 
            : '알 수 없음';

        // Canvas를 이용한 카드 이미지 제작 (가로 700px, 세로 280px)
        const canvas = createCanvas(700, 280);
        const ctx = canvas.getContext('2d');

        // 배경 처리 (핑크 그라데이션)
        const gradient = ctx.createLinearGradient(0, 0, 700, 280);
        gradient.addColorStop(0, '#FFE4E1');
        gradient.addColorStop(1, '#FFC0CB');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 카드 프레임 박스
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.roundRect(20, 20, 660, 240, 15);
        ctx.fill();

        // 아바타 원형 출력
        const avatarURL = user.displayAvatarURL({ extension: 'png', size: 128 });
        const avatar = await loadImage(avatarURL);
        
        ctx.save();
        ctx.beginPath();
        ctx.arc(100, 140, 55, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatar, 45, 85, 110, 110);
        ctx.restore();

        // 텍스트 스타일 지정 및 텍스트 채우기
        ctx.fillStyle = '#333333';
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText(`${user.username}`, 180, 75);

        ctx.font = '16px sans-serif';
        ctx.fillStyle = '#666666';
        ctx.fillText(`서버 가입일: ${joinedAt}`, 180, 105);

        ctx.fillStyle = '#222222';
        ctx.font = '18px sans-serif';
        ctx.fillText(`총 구매 금액: ${totalAmount.toLocaleString()} 원`, 180, 150);
        ctx.fillText(`총 구매 횟수: ${buyCount} 회`, 180, 180);
        ctx.fillText(`유저 등급: ${userRank}`, 180, 210);

        // 기준 날짜 안내 텍스트
        ctx.font = '13px sans-serif';
        ctx.fillStyle = '#888888';
        ctx.fillText(`* 해당 데이터는 2026.09.06일 부터 기준입니다.`, 180, 240);

        // 이미지를 디스코드 첨부파일로 변환 후 전송
        const attachment = new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'profile.png' });
        await message.reply({ files: [attachment] });
    }
});

client.login(TOKEN);
