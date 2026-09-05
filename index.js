const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { QuickDB } = require('quick.db');
const https = require('https');

const db = new QuickDB();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

const TOKEN = process.env.TOKEN;

// ---------------- [ 설정 영역 ] ----------------
const GUILD_ID = '1456729030459134115'; // 서버 ID (즉시 반영용)
const PURCHASE_LOG_CHANNEL_ID = '1457384858065047663'; // 구매 지급 로그 채널 ID
const INFO_LOG_CHANNEL_ID = '1545759434175815771'; // 유저 정보 변경 로그 채널 ID
// ------------------------------------------------

// 온라인 폰트 로드 및 등록 로직
function loadOnlineFont() {
    return new Promise((resolve) => {
        const fontUrl = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf';
        https.get(fontUrl, (res) => {
            const data = [];
            res.on('data', (chunk) => data.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(data);
                GlobalFonts.register(buffer, 'CustomFont');
                console.log('폰트 글로벌 등록 성공!');
                resolve();
            });
        }).on('error', (err) => {
            console.error('폰트 로드 실패:', err);
            resolve();
        });
    });
}

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
    await loadOnlineFont();
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
        // 서버 ID 지정을 통해 디스코드에 즉시 등록
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, GUILD_ID),
            { body: commands }
        );
        console.log('서버 전용 슬래시 명령어 즉시 등록 완료!');
    } catch (error) {
        console.error('슬래시 명령어 등록 실패:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // 1. /지급완료
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
            console.error("구매 로그 채널 전송 오류:", error);
        }

        const ticketEmbed = new EmbedBuilder()
            .setColor(0xFFD1DC)
            .setDescription(`**아이템이 정상적으로 지급되었어요.** <a:veryheart:1479957265871143104>\nhttps://discord.com/channels/1456729030459134115/1457384179535712473 작성은 필수입니다`);

        await interaction.channel.send({ content: `${buyer}`, embeds: [ticketEmbed] });
    }

    // 2. /금액추가
    if (interaction.commandName === '금액추가') {
        const targetUser = interaction.options.getUser('유저');
        const amount = interaction.options.getInteger('금액');

        await db.add(`user_${targetUser.id}.totalAmount`, amount);

        const currentBiggest = (await db.get(`user_${targetUser.id}.biggestDeal`)) || 0;
        if (amount > currentBiggest) {
            await db.set(`user_${targetUser.id}.biggestDeal`, amount);
        }

        const newTotal = (await db.get(`user_${targetUser.id}.totalAmount`)) || 0;

        await interaction.reply({ content: `${targetUser.username} 님의 누적 금액에 ₩${amount.toLocaleString()}을 추가했습니다.`, ephemeral: true });

        // 정보 변경 로그 채널 전송
        try {
            const infoLogChannel = await client.channels.fetch(INFO_LOG_CHANNEL_ID);
            if (infoLogChannel) {
                const infoEmbed = new EmbedBuilder()
                    .setColor(0x3498DB)
                    .setTitle('🛠️ 유저 정보 변경 알림 (금액 추가)')
                    .addFields(
                        { name: '처리 관리자', value: `${interaction.user} (${interaction.user.tag})`, inline: true },
                        { name: '대상 유저', value: `${targetUser} (${targetUser.tag})`, inline: true },
                        { name: '추가된 금액', value: `₩${amount.toLocaleString()}`, inline: false },
                        { name: '변경 후 총 누적 금액', value: `₩${newTotal.toLocaleString()}`, inline: false }
                    )
                    .setTimestamp();

                await infoLogChannel.send({ embeds: [infoEmbed] });
            }
        } catch (error) {
            console.error("유저 정보 변경 로그 전송 오류:", error);
        }
    }

    // 3. /횟수추가
    if (interaction.commandName === '횟수추가') {
        const targetUser = interaction.options.getUser('유저');
        const count = interaction.options.getInteger('횟수');

        await db.add(`user_${targetUser.id}.buyCount`, count);
        const newCount = (await db.get(`user_${targetUser.id}.buyCount`)) || 0;

        await interaction.reply({ content: `${targetUser.username} 님의 구매 횟수에 ${count}회를 추가했습니다.`, ephemeral: true });

        // 정보 변경 로그 채널 전송
        try {
            const infoLogChannel = await client.channels.fetch(INFO_LOG_CHANNEL_ID);
            if (infoLogChannel) {
                const infoEmbed = new EmbedBuilder()
                    .setColor(0x2ECC71)
                    .setTitle('🛠️ 유저 정보 변경 알림 (횟수 추가)')
                    .addFields(
                        { name: '처리 관리자', value: `${interaction.user} (${interaction.user.tag})`, inline: true },
                        { name: '대상 유저', value: `${targetUser} (${targetUser.tag})`, inline: true },
                        { name: '추가된 횟수', value: `${count}회`, inline: false },
                        { name: '변경 후 총 구매 횟수', value: `${newCount}회`, inline: false }
                    )
                    .setTimestamp();

                await infoLogChannel.send({ embeds: [infoEmbed] });
            }
        } catch (error) {
            console.error("유저 정보 변경 로그 전송 오류:", error);
        }
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

        const highestRole = member?.roles?.highest?.name && member.roles.highest.name !== '@everyone' 
            ? member.roles.highest.name 
            : 'Member';

        const joinedAt = member?.joinedAt 
            ? member.joinedAt.toISOString().split('T')[0] 
            : '2026.09.06';

        const canvas = createCanvas(800, 420);
        const ctx = canvas.getContext('2d');

        // 메인 배경
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
        ctx.font = '28px CustomFont';
        ctx.fillText(`${user.username}`, 160, 80);

        ctx.fillStyle = '#E5A93C';
        ctx.font = '15px CustomFont';
        ctx.fillText(`ROLE: ${highestRole}`, 160, 105);

        // 가입일
        ctx.fillStyle = '#72767D';
        ctx.font = '14px CustomFont';
        ctx.fillText(`JOINED: ${joinedAt}`, 600, 80);

        // TOTAL VOLUME
        ctx.fillStyle = '#18181C';
        ctx.beginPath();
        ctx.roundRect(40, 160, 350, 170, 15);
        ctx.fill();

        ctx.fillStyle = '#8E9297';
        ctx.font = '14px CustomFont';
        ctx.fillText('TOTAL VOLUME', 65, 195);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '32px CustomFont';
        ctx.fillText(`₩${totalAmount.toLocaleString()}`, 65, 245);

        ctx.fillStyle = '#8E9297';
        ctx.font = '13px CustomFont';
        ctx.fillText('BIGGEST DEAL', 65, 288);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '16px CustomFont';
        ctx.fillText(`₩${biggestDeal.toLocaleString()}`, 65, 312);

        // TOTAL DEALS & RANK
        ctx.fillStyle = '#18181C';
        ctx.beginPath();
        ctx.roundRect(410, 160, 350, 170, 15);
        ctx.fill();

        ctx.fillStyle = '#8E9297';
        ctx.font = '14px CustomFont';
        ctx.fillText('TOTAL DEALS', 435, 195);

        ctx.fillStyle = '#2ECC71';
        ctx.font = '32px CustomFont';
        ctx.fillText(`${buyCount}`, 435, 245);

        ctx.fillStyle = '#8E9297';
        ctx.font = '13px CustomFont';
        ctx.fillText('RANK', 435, 288);

        ctx.fillStyle = '#E5A93C';
        ctx.font = '18px CustomFont';
        ctx.fillText(`${userRank}`, 435, 312);

        // 하단 안내 문구
        ctx.fillStyle = '#EE4B2B';
        ctx.font = '12px CustomFont';
        ctx.fillText('* Data recorded starting from 2026.09.06', 40, 370);

        const attachment = new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'profile.png' });
        await message.reply({ files: [attachment] });
    }
});

client.login(TOKEN);
