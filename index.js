const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, REST, Routes } = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// 구매 로그가 전송될 채널 ID
const LOG_CHANNEL_ID = '1457384858065047663';
// 부여할 역할 ID
const ROLE_ID = '1457383788236505299';
// 이미지 URL
const IMAGE_URL = 'https://i.imgur.com/jokl6LQ.gif';
// 연핑크 색상 공통 정의
const LIGHT_PINK_COLOR = 0xFFB6C1;

client.once('ready', async () => {
    console.log(`[릴리웨이] 봇이 성공적으로 실행되었습니다: ${client.user.tag}`);

    // 기존 슬래시 명령어 완전히 초기화 후 재등록
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        console.log('기존 슬래시 명령어를 모두 삭제했습니다.');
    } catch (error) {
        console.error('기존 명령어 삭제 중 오류 발생:', error);
    }

    // /지급완료 명령어 빌드
    const logCommand = new SlashCommandBuilder()
        .setName('지급완료')
        .setDescription('구매 완료 로그를 전송합니다.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        // 필수 항목 (4개)
        .addUserOption(option =>
            option.setName('구매자')
                .setDescription('구매한 유저')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('상품')
                .setDescription('구매한 상품명')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('수량')
                .setDescription('구매한 수량')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('금액')
                .setDescription('사용된 금액')
                .setRequired(true))
        // 선택 항목 (1개)
        .addUserOption(option =>
            option.setName('판매자')
                .setDescription('해당 관리 판매자 (미선택 시 명령어 사용자로 지정)')
                .setRequired(false));

    await client.application.commands.create(logCommand);
    console.log('새로운 /지급완료 명령어가 등록되었습니다.');
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === '지급완료') {
        // 1. 명령어 입력자 본인에게만 보이는 처리 중 메시지
        await interaction.reply({ 
            content: '지급완료를 처리 중입니다. . .', 
            ephemeral: true 
        });

        const buyer = interaction.options.getUser('구매자');
        const item = interaction.options.getString('상품');
        const count = interaction.options.getString('수량');
        const price = interaction.options.getString('금액');
        
        // 판매자 미선택 시 명령어 사용자로 설정
        const seller = interaction.options.getUser('판매자') || interaction.user;

        // 2. 역할 부여 로직 (이미 보유 중이면 냅둠)
        try {
            const member = await interaction.guild.members.fetch(buyer.id);
            if (member && !member.roles.cache.has(ROLE_ID)) {
                await member.roles.add(ROLE_ID);
            }
        } catch (error) {
            console.error('역할 부여 중 오류 발생:', error);
        }

        const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);

        if (!logChannel) {
            return interaction.followUp({ content: '로그 채널을 찾을 수 없습니다.', ephemeral: true });
        }

        // 3. 지정된 로그 채널용 연핑크 임베드 메시지
        const logEmbed = new EmbedBuilder()
            .setColor(LIGHT_PINK_COLOR)
            .setDescription(
                `°.✩┈┈∘┈˃̶ ୨ ୧˂̶┈∘┈┈✩.°\n` +
                `${buyer}, ${item} (${count}) 구매 감사합니다 .ᐟ.ᐟ\n\n` +
                `사용된 금액 : ${price}\n\n` +
                `해당 관리 판매자: ${seller}\n\n` +
                `°.✩┈┈∘┈˃̶ ୨ ୧˂̶┈∘┈┈✩.°\n` +
                `࣪𓏲ּ ᥫ᭡ ₊ 𝑻𝒉𝒂𝒏𝒌 𝒚𝒐𝒖 ⊹ ˑ ִֶ 𓂃`
            )
            .setImage(IMAGE_URL);

        // 로그 채널에 구매자 멘션 + 연핑크 임베드 전송
        await logChannel.send({
            content: `${buyer}`,
            embeds: [logEmbed]
        });

        // 4. 명령어를 사용한 채널에 전송할 안내 연핑크 임베드
        const replyEmbed = new EmbedBuilder()
            .setColor(LIGHT_PINK_COLOR)
            .setDescription(
                `**아이템이 정상적으로 지급되었어요.**\n` +
                `**https://discord.com/channels/1456729030459134115/1457384179535712473 작성은 필수입니다.**`
            );

        // 명령어가 실행된 채널에 공개 메시지로 전송
        await interaction.channel.send({
            content: `${buyer}`,
            embeds: [replyEmbed]
        });
    }
});

if (!process.env.TOKEN) {
    console.error("오류: 릴리웨이 Variables에 'TOKEN'이 설정되어 있지 않습니다!");
    process.exit(1);
}

client.login(process.env.TOKEN);
