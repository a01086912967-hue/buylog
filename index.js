const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { QuickDB } = require('quick.db');
const https = require('https');
const fs = require('fs');
const path = require('path');

const db = new QuickDB();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

const TOKEN = process.env.TOKEN;
const PURCHASE_LOG_CHANNEL_ID = '1457384858065047663';

// 나눔고딕 폰트 자동 다운로드 및 등록
const fontPath = path.join(__dirname, 'NanumGothic.ttf');
function setupFont() {
    return new Promise((resolve) => {
        if (fs.existsSync(fontPath)) {
            GlobalFonts.registerFromPath(fontPath, 'NanumGothic');
            return resolve();
        }
        const file = fs.createWriteStream(fontPath);
        https.get('https://github.com/google/fonts/raw/main/ofl/nanumgothic/NanumGothic-Bold.ttf', (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                GlobalFonts.registerFromPath(fontPath, 'NanumGothic');
                resolve();
            });
        }).on('error', () => resolve());
    });
}

function getMemberRank(totalAmount) {
    if (totalAmount >= 500000) return 'VIP CLIENT';
    if (totalAmount >= 100000) return 'GOLD CLIENT';
    if (totalAmount >= 30000) return 'SILVER CLIENT';
    return 'BRONZE CLIENT';
}

client.once('ready', async () => {
    await setupFont(); // 폰트 등록 진행
    console.log('봇 준비 완료! (폰트 로드 완료)');

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

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand() && interaction.commandName === '지급완료') {
        await interaction.reply({ content: '처리를 시작합니다.', ephemeral: true });

        const itemName = interaction.options.getString('상품');
        const itemQty = interaction.options.getString('수량');
        const amountStr = interaction.options.getString('금액');
        
        const numericAmount = parseInt(amountStr.replace(/[^0-9]/g, '')) || 0;

        const buyer = interaction.options.getUser('구매자') || interaction.user;
        const seller = interaction.options.getUser('판매자') || interaction.user;

        await db.add(`user_${buyer.id}.totalAmount`, numericAmount);
        await db.add(`user_${buyer.id}.buyCount`, 1);

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

        const ticketEmbed = new EmbedBuilder()
            .setColor(0xFFD1DC)
            .setDescription(`**아이템이 정상적으로 지급되었어요.** <a:veryheart:1479957265871143104>\nhttps://discord.com/channels/1456729030459134115/1457384179535712473 작성은 필수입니다`);

        await interaction.channel.send({
            content: `${buyer}`,
            embeds: [ticketEmbed]
        });
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content.trim() === '$내정보') {
        const user = message.author;
        const member = message.member;

        const totalAmount = (await db.get(`user_${user.id}.totalAmount`)) || 0;
        const buyCount = (await db.get(`user_${user.id}.buyCount`)) || 0;
        const userRank = getMemberRank(totalAmount);

        const joinedAt = member?.joinedAt 
            ? member.joinedAt.toISOString().split('T')[0] 
            : '2026.09.06';

        const canvas = createCanvas(750, 380);
        const ctx = canvas.getContext('2d');

        // 메인 다크 배경
        ctx.fillStyle = '#121214';
        ctx.beginPath();
        ctx.roundRect(0, 0, 750, 380, 20);
        ctx.fill();

        // 1. 프로필 영역
        ctx.fillStyle = '#1A1A1E';
        ctx.beginPath();
        ctx.roundRect(25, 25, 700, 100, 15);
        ctx.fill();

        // 아바타
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

        // 등록된 NanumGothic 폰트 적용
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 22px NanumGothic';
        ctx.fillText(`${user.username}`, 125, 63);

        ctx.fillStyle = '#E5A93C';
        ctx.font = 'bold 14px NanumGothic';
        ctx.fillText(`${userRank}`, 125, 88);

        ctx.fillStyle = '#72767D';
        ctx.font = '13px NanumGothic';
        ctx.fillText(`가입일: ${joinedAt}`, 550, 75);

        // 2. 구매 금액 박스
        ctx.fillStyle = '#1A1A1E';
        ctx.beginPath();
        ctx.roundRect(25, 140, 340, 160, 15);
        ctx.fill();

        ctx.fillStyle = '#8E9297';
        ctx.font = 'bold 13px NanumGothic';
        ctx.fillText('TOTAL VOLUME', 45, 175);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 30px NanumGothic';
        ctx.fillText(`₩${totalAmount.toLocaleString()}`, 45, 225);

        // 3. 구매 횟수 박스
        ctx.fillStyle = '#1A1A1E';
        ctx.beginPath();
        ctx.roundRect(385, 140, 340, 160, 15);
        ctx.fill();

        ctx.fillStyle = '#8E9297';
        ctx.font = 'bold 13px NanumGothic';
        ctx.fillText('TOTAL DEALS', 405, 175);

        ctx.fillStyle = '#2ECC71';
        ctx.font = 'bold 30px NanumGothic';
        ctx.fillText(`${buyCount} 회`, 405, 225);

        // 하단 텍스트
        ctx.fillStyle = '#5C5E66';
        ctx.font = '12px NanumGothic';
        ctx.fillText('* 해당 데이터는 2026.09.06일 부터 기준입니다.', 25, 335);

        const attachment = new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'profile.png' });
        await message.reply({ files: [attachment] });
    }
});

client.login(TOKEN);
