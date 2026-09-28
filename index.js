const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers
    ]
});

// 구매 로그가 전송될 채널 ID
const LOG_CHANNEL_ID = '1457384858065047663';
// 부여할 역할 ID
const ROLE_ID = '1457383788236505299';
// 계산기 명령어 사용 허용 역할 ID
const CALCULATOR_ROLE_ID = '1456747541348749342';
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

    // 1. /지급완료 명령어 빌드
    const logCommand = new SlashCommandBuilder()
        .setName('지급완료')
        .setDescription('구매 완료 로그를 전송합니다.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option => option.setName('구매자').setDescription('구매한 유저').setRequired(true))
        .addStringOption(option => option.setName('상품').setDescription('구매한 상품명').setRequired(true))
        .addStringOption(option => option.setName('수량').setDescription('구매한 수량').setRequired(true))
        .addStringOption(option => option.setName('금액').setDescription('사용된 금액').setRequired(true))
        .addUserOption(option => option.setName('판매자').setDescription('해당 관리 판매자 (미선택 시 명령어 사용자로 지정)').setRequired(false));

    // 2. /가격 명령어 빌드
    const priceCommand = new SlashCommandBuilder()
        .setName('가격')
        .setDescription('구매할 로벅스 가격을 계산합니다.')
        .addNumberOption(option => option.setName('만원당로벅스').setDescription('만 원당 로벅스량 (예: 1300)').setRequired(true))
        .addNumberOption(option => option.setName('구매할로벅스').setDescription('구매할 로벅스 수량 (예: 240)').setRequired(true));

    // 3. /로벅스 명령어 빌드
    const robuxCommand = new SlashCommandBuilder()
        .setName('로벅스')
        .setDescription('보낼 금액에 따른 로벅스 수량을 계산합니다.')
        .addNumberOption(option => option.setName('만원당로벅스').setDescription('만 원당 로벅스량 (예: 1300)').setRequired(true))
        .addNumberOption(option => option.setName('보낼돈').setDescription('보낼 돈 (예: 1900)').setRequired(true));

    // 명령어 일괄 등록
    await client.application.commands.create(logCommand);
    await client.application.commands.create(priceCommand);
    await client.application.commands.create(robuxCommand);
    console.log('새로운 슬래시 명령어들이 등록되었습니다.');
});

client.on('interactionCreate', async interaction => {
    // 버튼 클릭 이벤트 처리
    if (interaction.isButton()) {
        if (interaction.customId === 'notice_btn') {
            await interaction.reply({
                content: `###  <#1457384179535712473>  미작성 시 주의사항 \n-# - 2일 내 작성하지 않으면 <@&1550129139086794852>  지급돼요.\n-# - 해당 역할 보유 시 다음 번 구매가 어려울 수 있어요.`,
                ephemeral: true
            });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    // --- /지급완료 ---
    if (interaction.commandName === '지급완료') {
        await interaction.reply({ 
            content: '지급완료를 처리 중입니다. . .', 
            ephemeral: true 
        });

        const buyer = interaction.options.getUser('구매자');
        const item = interaction.options.getString('상품');
        const count = interaction.options.getString('수량');
        const price = interaction.options.getString('금액');
        const seller = interaction.options.getUser('판매자') || interaction.user;

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

        await logChannel.send({
            content: `${buyer}`,
            embeds: [logEmbed]
        });

        const replyEmbed = new EmbedBuilder()
            .setColor(LIGHT_PINK_COLOR)
            .setDescription(
                `**아이템이 정상적으로 지급되었어요.**\n` +
                `**https://discord.com/channels/1456729030459134115/1457384179535712473 작성은 필수입니다.**`
            );

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('notice_btn')
                    .setLabel('주의사항')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setLabel('후기작성')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`https://discord.com/channels/${interaction.guildId}/1457384179535712473`)
            );

        await interaction.channel.send({
            content: `${buyer}`,
            embeds: [replyEmbed],
            components: [row]
        });
    }

    // --- /가격 & /로벅스 계산 명령어 처리 ---
    if (interaction.commandName === '가격' || interaction.commandName === '로벅스') {
        // 역할 권한 체크 (1456747541348749342 역할 보유 여부)
        const member = interaction.member;
        if (!member || !member.roles.cache.has(CALCULATOR_ROLE_ID)) {
            return interaction.reply({ content: '해당 명령어를 사용할 권한이 없습니다.', ephemeral: true });
        }

        // 1. 나만 보이는 메시지로 "계산을 진행 중입니다 . ." 전송
        await interaction.reply({
            content: '계산을 진행 중입니다 . .',
            ephemeral: true
        });

        // 2. /가격
        if (interaction.commandName === '가격') {
            const rate = interaction.options.getNumber('만원당로벅스');
            const robux = interaction.options.getNumber('구매할로벅스');

            if (rate <= 0 || robux <= 0) {
                return interaction.editReply({ content: '0보다 큰 숫자를 입력해 주세요.' });
            }

            // 백원 단위(0.1만 원) 올림 처리
            const rawWan = robux / rate;
            const roundedWan = Math.ceil(rawWan * 10) / 10;
            const finalPrice = Math.round(roundedWan * 10000);

            const embed = new EmbedBuilder()
                .setColor(LIGHT_PINK_COLOR)
                .setDescription(
                    `## [ ! ] 로벅스 가격 결과 <:robux:1554139067913080882>\n` +
                    `**만 원당 로벅스 가격 : \`${rate.toLocaleString()}\`\n` +
                    `구매할 로벅스 수량 : \`${robux.toLocaleString()}\`**\n\n` +
                    `**계산된 로벅스 가격 = \`${finalPrice.toLocaleString()}\`원**`
                );

            // 기존 "계산을 진행 중입니다 . ." 메시지를 결과 임베드로 수정
            return interaction.editReply({ content: null, embeds: [embed] });
        }

        // 3. /로벅스
        if (interaction.commandName === '로벅스') {
            const rate = interaction.options.getNumber('만원당로벅스');
            const money = interaction.options.getNumber('보낼돈');

            if (rate <= 0 || money <= 0) {
                return interaction.editReply({ content: '0보다 큰 숫자를 입력해 주세요.' });
            }

            // 받을 로벅스 수량 계산 (소수점 버림 처리)
            const totalRobux = Math.floor((money / 10000) * rate);

            const embed = new EmbedBuilder()
                .setColor(LIGHT_PINK_COLOR)
                .setDescription(
                    `## [ ! ] 지급 로벅스 결과 <:robux:1554139067913080882>\n` +
                    `**만 원당 로벅스 가격 : \`${rate.toLocaleString()}\`\n` +
                    `보낼 금액 : \`${money.toLocaleString()}\`원**\n\n` +
                    `**계산된 로벅스 수량 = \`${totalRobux.toLocaleString()}\` R$**`
                );

            // 기존 "계산을 진행 중입니다 . ." 메시지를 결과 임베드로 수정
            return interaction.editReply({ content: null, embeds: [embed] });
        }
    }
});

if (!process.env.TOKEN) {
    console.error("오류: 릴리웨이 Variables에 'TOKEN'이 설정되어 있지 않습니다!");
    process.exit(1);
}

client.login(process.env.TOKEN);
