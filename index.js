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

// 유저 순위 계산 함수
async function getUserRank(userId) {
    const allData = await db.all();
    const userAmountMap = [];

    for (const item of allData) {
        if (item.id.startsWith('user_') && item.id.endsWith('.totalAmount')) {
            const uid = item.id.split('_')[1].split('.')[0];
            userAmountMap.push({ id: uid, amount: item.value || 0 });
        }
    }

    userAmountMap.sort((a, b) => b.amount - a.amount);
    const rankIndex = userAmountMap.findIndex(u => u.id === userId);
    return rankIndex !== -1 ? `#${rankIndex + 1}` : '#-';
}

client.once('ready', async () => {
    console.log('봇 준비 완료!');

    const commands = [
        new SlashCommandBuilder()
            .setName('지급완료')
            .setDescription('지급 완료 알림 및 로그를 전송합니다.')
            .addStringOption(opt => opt.setName('금액').setDescription('구매 금액').setRequired(true))
            .addStringOption(opt => opt.setName('상품').setDescription('구매한 상품명').setRequired(true))
            .addStringOption(opt => opt.setName('수량').setDescription('구매 수량').setRequired(true))
            .addUserOption(opt => opt.setName('구매자').setDescription('구매한 유저').setRequired(false))
            .addUserOption(opt => opt.setName('판매자').setDescription('담당 판매자').setRequired(false)),

        new SlashCommandBuilder()
            .setName('금액추가')
            .setDescription('특정 유저의 누적 구매 금액을 수동으로 추가합니다.')
            .addUserOption(opt => opt.setName('유저').setDescription('대상 유저').setRequired(true))
            .addIntegerOption(opt => opt.setName('금액').setDescription('추가할 금액(원)').setRequired(true)),

        new SlashCommandBuilder()
            .setName('횟수추가')
            .setDescription('특정 유저의 구매 횟수를 수동으로 추가합니다.')
            .addUserOption(opt => opt.setName('유저').setDescription('대상 유저').setRequired(true))
            .addIntegerOption(opt => opt.setName('횟수').setDescription('추가할 횟수').setRequired(true))
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
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === '지급완료') {
        await interaction.reply({ content: '처리를 시작합니다.', ephemeral: true });

        const itemName = interaction.options.getString('상품');
        const itemQty = interaction.options.getString('수량');
        const amountStr = interaction.options.getString('금액');
        const numericAmount = parseInt(amountStr.replace(/[^0-9]/g, '')) || 0;

        const buyer = interaction.options.getUser('구매자') || interaction.user;
        const seller = interaction.options.getUser('판매자') || interaction.user;

        await db.add(`user_${buyer.id}.totalAmount`, numericAmount);
        await db.add(`user_${buyer.id}.buyCount`, 1);

        const currentBiggest = (await db.get(`user_${buyer.id}.biggestDeal`)) || 0;
        if (numericAmount > currentBiggest) {
            await db.set(`user_${buyer.id}.biggestDeal`, numericAmount);
        }

        try {
            const logChannel = await client.channels.fetch(PURCHASE_LOG_CHANNEL_ID);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor(0xFFD1DC)
                    .setDescription(`°.✩┈┈∘┈˃̶ ୨<a:Pinkheartgif:1545408138377695352> ୧˂̶┈∘┈┈✩.°\n\n${buyer}, ${itemName} (${itemQty}개) 구매 감사합니다 .ᐟ.ᐟ\n\n사용된 금액 : ${amountStr}\n\n해당 관리 판매자: ${seller}\n\n°.✩┈┈∘┈˃̶ ୨<a:Pinkheartgif:1545408138377695352> ୧˂̶┈∘┈┈✩.°\n࣪𓏲ּ ᥫ᭡ ₊ 𝑻𝒉𝒂𝒏𝒌 𝒚𝒐𝒖 ⊹ ˑ ִֶ 𓂃`)
                    .setImage('https://i.imgur.com/jokl6LQ.gif');

                await logChannel.send({ content: `${buyer}`, embeds: [logEmbed] });
            }
        } catch (error) {
            console.error("로그 채널 전송 오류:", error);
        }

        const ticketEmbed = new EmbedBuilder()
            .setColor(0xFFD1DC)
            .setDescription(`**아이템이 정상적으로 지급되었어요.** <a:veryheart:1479957265871143104>\nhttps://discord.com/channels/1456729030459134115/1457384179535712473 작성은 필수입니다`);

        await interaction.channel.send({ content: `${buyer}`, embeds: [ticketEmbed] });
    }

    if (interaction.commandName === '금액추가') {
        const targetUser = interaction.options.getUser('유저');
        const amount = interaction.options.getInteger('금액');

        await db.add(`user_${targetUser.id}.totalAmount`, amount);

        const currentBiggest = (await db.get(`user_${targetUser.id}.biggestDeal`)) || 0;
        if (amount > currentBiggest) {
            await db.set(`user_${targetUser.id}.biggestDeal`, amount);
        }

        await interaction.reply({ content: `${targetUser.username} - Amount added: ₩${amount.toLocaleString()}`, ephemeral: true });
    }

    if (interaction.commandName === '횟수추가') {
        const targetUser = interaction.options.getUser('유저');
        const count = interaction.options.getInteger('횟수');

        await db.add(`user_${targetUser.id}.buyCount`, count);

        await interaction.reply({ content: `${targetUser.username} - Deals count added: ${count}`, ephemeral: true });
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content.trim() === '$내정보') {
        const user = message.author;
        const member = message.member;

        const totalAmount = (await db.get(`user_${user.id}.totalAmount`)) || 0;
        const buyCount = (await db.get(`user_${user.id}.buyCount`)) || 0;
        const biggestDeal = (await db.get(`user_${user.id}.biggestDeal`)) || 0;
        
        const userRank = await getUserRank(user.id);

        // 가장 높은 역할 가져오기 (@everyone 제외)
        const highestRole = member?.roles.highest.name !== '@everyone' 
            ? member?.roles.highest.name 
            : 'Member';

        const joinedAt = member?.joinedAt 
            ? member.joinedAt.toISOString().split('T')[0] 
            : '2026.09.06';

        const canvas = createCanvas(800, 420);
        const ctx = canvas.getContext('2d');

        // 배경
        ctx.fillStyle = '#0F0F12';
        ctx.beginPath();
        ctx.roundRect(0, 0, 800, 420, 20);
        ctx.fill();

        // 아바타
        const avatarURL = user.displayAvatarURL({ extension: 'png', size: 128 });
        try {
            const avatar = await loadImage(avatarURL);
            ctx.save();
            ctx.beginPath();
            ctx.arc(90, 85, 45, 0, Math.PI * 2, true);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(avatar, 45, 40, 90, 90);
            ctx.restore();
        } catch (e) { }

        // 유저명 & 가장 높은 역할
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 28px sans-serif';
        ctx.fillText(`${user.username}`, 160, 80);

        ctx.fillStyle = '#E5A93C';
        ctx.font = 'bold 15px sans-serif';
        ctx.fillText(`ROLE: ${highestRole}`, 160, 105);

        // 가입일
        ctx.fillStyle = '#72767D';
        ctx.font = '14px sans-serif';
        ctx.fillText(`JOINED: ${joinedAt}`, 600, 80);

        // TOTAL VOLUME
        ctx.fillStyle = '#18181C';
        ctx.beginPath();
        ctx.roundRect(40, 160, 350, 170, 15);
        ctx.fill();

        ctx.fillStyle = '#8E9297';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText('TOTAL VOLUME', 65, 195);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 32px sans-serif';
        ctx.fillText(`₩${totalAmount.toLocaleString()}`, 65, 245);

        ctx.fillStyle = '#8E9297';
        ctx.font = '13px sans-serif';
        ctx.fillText('BIGGEST DEAL', 65, 288);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText(`₩${biggestDeal.toLocaleString()}`, 65, 312);

        // TOTAL DEALS & RANK
        ctx.fillStyle = '#18181C';
        ctx.beginPath();
        ctx.roundRect(410, 160, 350, 170, 15);
        ctx.fill();

        ctx.fillStyle = '#8E9297';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText('TOTAL DEALS', 435, 195);

        ctx.fillStyle = '#2ECC71';
        ctx.font = 'bold 32px sans-serif';
        ctx.fillText(`${buyCount}`, 435, 245);

        ctx.fillStyle = '#8E9297';
        ctx.font = '13px sans-serif';
        ctx.fillText('RANK', 435, 288);

        ctx.fillStyle = '#E5A93C';
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText(`${userRank}`, 435, 312);

        // 하단 안내 문구
        ctx.fillStyle = '#EE4B2B';
        ctx.font = '12px sans-serif';
        ctx.fillText('* Data recorded starting from 2026.09.06', 40, 370);

        const attachment = new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'profile.png' });
        await message.reply({ files: [attachment] });
    }
});

client.login(TOKEN);
