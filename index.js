const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, AttachmentBuilder, PermissionsBitField } = require('discord.js');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { QuickDB } = require('quick.db');
const https = require('https');

const db = new QuickDB({ filePath: './database.sqlite' });

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ] 
});

const TOKEN = process.env.TOKEN;

// ---------------- [ 설정 ] ----------------
const GUILD_ID = '1456729030459134115'; 
const PURCHASE_LOG_CHANNEL_ID = '1457384858065047663'; // 로그 채널 ID
const REVIEW_CHANNEL_ID = '1457384179535712473';       // 구매후기 채널 ID
// ------------------------------------------

const FONT_FAMILY = 'CustomFont, sans-serif, "Noto Sans KR", Arial';

function loadOnlineFont() {
    return new Promise((resolve) => {
        const fontUrl = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf';
        https.get(fontUrl, (res) => {
            const data = [];
            res.on('data', (chunk) => data.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(data);
                GlobalFonts.register(buffer, 'CustomFont');
                resolve();
            });
        }).on('error', (err) => {
            console.error('폰트 로드 실패:', err);
            resolve();
        });
    });
}

// 봇 켜질 때 슬래시 명령어 자동 등록
client.once('ready', async () => {
    await loadOnlineFont();
    console.log(`봇 접속 성공: ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName('지급완료')
            .setDescription('지급 완료 알림 및 구매 로그를 전송합니다.')
            .addStringOption(opt => opt.setName('금액').setDescription('구매 금액').setRequired(true))
            .addStringOption(opt => opt.setName('상품').setDescription('구매한 상품명').setRequired(true))
            .addStringOption(opt => opt.setName('수량').setDescription('구매 수량').setRequired(true))
            .addUserOption(opt => opt.setName('구매자').setDescription('구매한 유저').setRequired(true))
            .addUserOption(opt => opt.setName('판매자').setDescription('담당 판매자').setRequired(false))
    ];

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, GUILD_ID),
            { body: commands }
        );
        console.log('✅ [/지급완료] 슬래시 명령어 자동 동기화 완료!');
    } catch (error) {
        console.error('❌ 슬래시 명령어 등록 오류:', error);
    }
});

// /지급완료 명령어 처리
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === '지급완료') {
        const itemName = interaction.options.getString('상품');
        const itemQty = interaction.options.getString('수량');
        const amountStr = interaction.options.getString('금액');
        const numericAmount = parseInt(amountStr.replace(/[^0-9]/g, '')) || 0;

        const buyer = interaction.options.getUser('구매자');
        const seller = interaction.options.getUser('판매자') || interaction.user;

        // DB 금액 및 횟수 적립
        const currentAmount = (await db.get(`user_${buyer.id}.totalAmount`)) || 0;
        const currentCount = (await db.get(`user_${buyer.id}.buyCount`)) || 0;
        await db.set(`user_${buyer.id}.totalAmount`, Number(currentAmount) + numericAmount);
        await db.set(`user_${buyer.id}.buyCount`, Number(currentCount) + 1);

        const currentBiggest = (await db.get(`user_${buyer.id}.biggestDeal`)) || 0;
        if (numericAmount > currentBiggest) {
            await db.set(`user_${buyer.id}.biggestDeal`, numericAmount);
        }

        // 1. 구매 로그 채널 전송 (원본 텍스트 및 이모지 적용)
        try {
            const logChannel = await client.channels.fetch(PURCHASE_LOG_CHANNEL_ID);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor(0xFFB6C1)
                    .setDescription(`°.✩┈┈∘┈˃̶ ୨<a:Pinkheartgif:1545408138377695352> ୧˂̶┈∘┈┈✩.°\n\n${buyer}, ${itemName} (${itemQty}개) 구매 감사합니다 .ᐟ.ᐟ\n\n사용된 금액 : ${amountStr}\n\n해당 관리 판매자: ${seller}\n\n°.✩┈┈∘┈˃̶ ୨<a:Pinkheartgif:1545408138377695352> ୧˂̶┈∘┈┈✩.°\n࣪𓏲ּ ᥫ᭡ ₊ 𝑻𝒉𝒂نك 𝒚𝒐𝒖 ⊹ ˑ ִֶ 𓂃`)
                    .setImage('https://i.imgur.com/jokl6LQ.gif');

                await logChannel.send({ content: `${buyer}`, embeds: [logEmbed] });
            }
        } catch (error) {
            console.error("로그 채널 오류:", error);
        }

        // 2. 현재 티켓 채널 전송 (원본 형태 적용)
        const ticketEmbed = new EmbedBuilder()
            .setColor(0xFFB6C1)
            .setDescription(`아이템이 정상적으로 지급되었어요. <a:veryheart:1479957265871143104>\n<#${REVIEW_CHANNEL_ID}> 작성은 필수입니다`);

        await interaction.reply({ content: `${buyer}`, embeds: [ticketEmbed] });
    }
});

client.login(TOKEN);
