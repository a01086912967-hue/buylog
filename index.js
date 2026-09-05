const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { QuickDB } = require('quick.db');
const db = new QuickDB();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

const TOKEN = process.env.TOKEN;
const PURCHASE_LOG_CHANNEL_ID = '1457384858065047663'; // 로그 채널 ID

// 구매 금액 기준 등급 산정
function getMemberRank(totalAmount) {
    if (totalAmount >= 500000) return 'VIP CLIENT';
    if (totalAmount >= 100000) return 'GOLD CLIENT';
    if (totalAmount >= 30000) return 'SILVER CLIENT';
    return 'BRONZE CLIENT';
}

client.once('ready', async () => {
    console.log('봇 준비 완료!');

    const commands = [
        new SlashCommandBuilder()
            .setName('지급완료')
            .setDescription('지급 완료 알림 및 로그를 전송합니다.')
            .addStringOption(option => 
                option.setName('금액')
                    .setDescription('구매 금액')
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
        
        // 금액 문자열에서 숫자만 추출하여 누적
        const numericAmount = parseInt(amountStr.replace(/[^0-9]/g, '')) || 0;

        const buyer = interaction.options.getUser('구매자') || interaction.user;
        const seller = interaction.options.getUser('판매자') || interaction.user;

        // DB에 구매 금액 및 횟수 저장
        await db.add(`user_${buyer.id}.totalAmount`, numericAmount);
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

// 2. $내정보 처리 (다크 UI 스타일 카드 생성)
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content.trim() === '$내정보') {
        const user = message.author;
        const member = message.member;

        // 누적 기록 로드
        const totalAmount = (await db.get(`user_${user.id}.totalAmount`)) || 0;
        const buyCount = (await db.get(`user_${user.id}.buyCount`)) || 0;
        const userRank = getMemberRank(totalAmount);

        // 서버 가입일 포맷팅
        const joinedAt = member?.joinedAt 
            ? member.joinedAt.toISOString().split('T')[0] 
            : '2026.09.06';

        // Canvas 세팅 (가로 750px, 세로 380px)
        const canvas = createCanvas(750, 380);
        const ctx = canvas.getContext('2d');

        // 메인 어두운 배경
        ctx.fillStyle = '#121214';
        ctx.beginPath();
        ctx.roundRect(0, 0, 750, 380, 20);
        ctx.fill();

        // 1. 헤더 프로필 박스
        ctx.fillStyle = '#1A1A1E';
        ctx.beginPath();
        ctx.roundRect(25, 25, 700, 100, 15);
        ctx.fill();

        // 아바타 원형
        const avatarURL = user.displayAvatarURL({ extension: 'png', size: 128 });
        try {
            const avatar = await loadImage(avatarURL);
            ctx.save();
            ctx.beginPath();
            ctx.arc(75, 75, 35, 0, Math.PI * 2, true);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(avatar, 40, 40, 70, 70);
            ctx.restore();
        } catch (e) { }

        // 유저명 & 등급
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 22px Arial, sans-serif';
        ctx.fillText(`${user.username}`, 125, 63);

        ctx.fillStyle = '#E5A93C';
        ctx.font = 'bold 14px Arial, sans-serif';
        ctx.fillText(`${userRank}`, 125, 88);

        // 서버 가입일 (우측 상단)
        ctx.fillStyle = '#72767D';
        ctx.font = '13px Arial, sans-serif';
        ctx.fillText(`가입일: ${joinedAt}`, 580, 75);

        // 2. 정보 그리드 박스 (총 구매 금액 & 구매 횟수)
        
        // 왼쪽 박스: 총 구매 금액
        ctx.fillStyle = '#1A1A1E';
        ctx.beginPath();
        ctx.roundRect(25, 140, 340, 160, 15);
        ctx.fill();

        ctx.fillStyle = '#8E9297';
        ctx.font = 'bold 13px Arial, sans-serif';
        ctx.fillText('TOTAL VOLUME', 45, 175);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 32px Arial, sans-serif';
        ctx.fillText(`₩${totalAmount.toLocaleString()}`, 45, 225);

        // 오른쪽 박스: 총 구매 횟수
        ctx.fillStyle = '#1A1A1E';
        ctx.beginPath();
        ctx.roundRect(385, 140, 340, 160, 15);
        ctx.fill();

        ctx.fillStyle = '#8E9297';
        ctx.font = 'bold 13px Arial, sans-serif';
        ctx.fillText('TOTAL DEALS', 405, 175);

        ctx.fillStyle = '#2ECC71';
        ctx.font = 'bold 32px Arial, sans-serif';
        ctx.fillText(`${buyCount} 회`, 405, 225);

        // 3. 하단 기준일 안내 문구
        ctx.fillStyle = '#5C5E66';
        ctx.font = '12px Arial, sans-serif';
        ctx.fillText('* 해당 데이터는 2026.09.06일 부터 기준입니다.', 25, 335);

        const attachment = new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'profile.png' });
        await message.reply({ files: [attachment] });
    }
});

client.login(TOKEN);
