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
const PURCHASE_LOG_CHANNEL_ID = '1457384858065047663';

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

        // 캔버스 크기 지정
        const canvas = createCanvas(800, 420);
        const ctx = canvas.getContext('2d');

        // 배경
        ctx.fillStyle = '#0F0F12';
        ctx.beginPath();
        ctx.roundRect(0, 0, 800, 420, 20);
        ctx.fill();

        // 1. 프로필 서클 테두리 및 원형 아바타
        ctx.strokeStyle = '#D67D27';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(100, 90, 48, 0, Math.PI * 2);
        ctx.stroke();

        const avatarURL = user.displayAvatarURL({ extension: 'png', size: 128 });
        try {
            const avatar = await loadImage(avatarURL);
            ctx.save();
            ctx.beginPath();
            ctx.arc(100, 90, 44, 0, Math.PI * 2, true);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(avatar, 56, 46, 88, 88);
            ctx.restore();
        } catch (e) { }

        // 유저네임 및 등급 (sans-serif 기본 폰트 적용)
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 28px sans-serif';
        ctx.fillText(`${user.username}`, 170, 82);

        ctx.fillStyle = '#D67D27';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText(`${userRank}`, 170, 108);

        // 가입일
        ctx.fillStyle = '#72767D';
        ctx.font = '14px sans-serif';
        ctx.fillText(`JOINED: ${joinedAt}`, 620, 82);

        // 2. TOTAL VOLUME 박스 (메인 구매 금액)
        ctx.fillStyle = '#18181C';
        ctx.beginPath();
        ctx.roundRect(40, 160, 350, 170, 15);
        ctx.fill();

        ctx.fillStyle = '#8E9297';
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText('TOTAL VOLUME', 65, 195);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 36px sans-serif';
        ctx.fillText(`$${totalAmount.toLocaleString()}`, 65, 250);

        ctx.fillStyle = '#8E9297';
        ctx.font = '13px sans-serif';
        ctx.fillText('DEALS', 65, 290);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText(`${buyCount}`, 65, 312);

        // 3. 우측 서브 정보 박스 (DEALS & STATUS)
        ctx.fillStyle = '#18181C';
        ctx.beginPath();
        ctx.roundRect(410, 160, 350, 170, 15);
        ctx.fill();

        ctx.fillStyle = '#8E9297';
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText('TOTAL DEALS', 435, 195);

        ctx.fillStyle = '#2ECC71';
        ctx.font = 'bold 36px sans-serif';
        ctx.fillText(`${buyCount} COUNT`, 435, 250);

        // 4. 하단 안내 문구
        ctx.fillStyle = '#EE4B2B';
        ctx.font = '12px sans-serif';
        ctx.fillText('* Data recorded starting from 2026.09.06', 40, 370);

        const attachment = new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'profile.png' });
        await message.reply({ files: [attachment] });
    }
});

client.login(TOKEN);
