const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// 구매 로그가 전송될 채널 ID
const LOG_CHANNEL_ID = '1457384858065047663';
// 이미지 URL
const IMAGE_URL = 'https://i.imgur.com/jokl6LQ.gif';

client.once('ready', () => {
    console.log(`[릴리웨이] 봇이 성공적으로 실행되었습니다: ${client.user.tag}`);

    // /지급완료 명령어 등록
    const logCommand = new SlashCommandBuilder()
        .setName('지급완료')
        .setDescription('구매 완료 로그를 전송합니다.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option =>
            option.setName('구매자')
                .setDescription('구매한 유저')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('상품')
                .setDescription('구매한 상품명')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('금액')
                .setDescription('사용된 금액')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('판매자')
                .setDescription('해당 관리 판매자')
                .setRequired(true));

    client.application.commands.create(logCommand);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === '지급완료') {
        const buyer = interaction.options.getUser('구매자');
        const item = interaction.options.getString('상품');
        const price = interaction.options.getString('금액');
        const seller = interaction.options.getUser('판매자');

        const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);

        if (!logChannel) {
            return interaction.reply({ content: '로그 채널을 찾을 수 없습니다.', ephemeral: true });
        }

        // 1. 로그 채널용 임베드 메시지
        const logEmbed = new EmbedBuilder()
            .setColor(0xFFB6C1)
            .setDescription(
                `°.✩┈┈∘┈˃̶ ୨ ୧˂̶┈∘┈┈✩.°\n` +
                `${buyer}, ${item} 구매 감사합니다 .ᐟ.ᐟ\n\n` +
                `사용된 금액 : ${price}\n\n` +
                `해당 관리 판매자: ${seller}\n\n` +
                `°.✩┈┈∘┈˃̶ ୨ ୧˂̶┈∘┈┈✩.°\n` +
                `࣪𓏲ּ ᥫ᭡ ₊ 𝑻𝒉𝒂𝒏𝒌 𝒚𝒐𝒖 ⊹ ˑ ִֶ 𓂃`
            )
            .setImage(IMAGE_URL);

        // 로그 채널에 구매자 멘션 + 임베드 전송
        await logChannel.send({
            content: `${buyer}`,
            embeds: [logEmbed]
        });

        // 2. 명령어를 사용한 채널에 전송될 안내 임베드
        const replyEmbed = new EmbedBuilder()
            .setColor(0x87CEEB)
            .setDescription(
                `**아이템이 정상적으로 지급되었어요.**\n` +
                `https://discord.com/channels/1456729030459134115/1457384179535712473 작성은 필수입니다.**`
            );

        // 명령어를 입력한 채널에 구매자 멘션 + 임베드로 응답
        await interaction.reply({
            content: `${buyer}`,
            embeds: [replyEmbed]
        });
    }
});

// 릴리웨이 Value(Variables)의 TOKEN 값을 읽어옵니다.
if (!process.env.TOKEN) {
    console.error("오류: 릴리웨이 Variables에 'TOKEN'이 설정되어 있지 않습니다!");
    process.exit(1);
}

client.login(process.env.TOKEN);
