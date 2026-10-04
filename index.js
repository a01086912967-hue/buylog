const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    SlashCommandBuilder,
    PermissionFlagsBits,
    REST,
    Routes,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    MessageFlags
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// 기존 설정
const LOG_CHANNEL_ID = '1457384858065047663';
const ROLE_ID = '1457383788236505299';
const CALCULATOR_ROLE_ID = '1456747541348749342';
const IMAGE_URL = 'https://i.imgur.com/jokl6LQ.gif';
const LIGHT_PINK_COLOR = 0xFFB6C1;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));


// ========================================
// 봇 준비
// ========================================

client.once('ready', async () => {

    console.log(`[릴리웨이] 봇이 성공적으로 실행되었습니다: ${client.user.tag}`);

    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

        // 기존 슬래시 명령어 삭제
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: [] }
        );
        console.log('기존 슬래시 명령어를 모두 삭제했습니다.');

    } catch (error) {
        console.error('기존 명령어 삭제 중 오류 발생:', error);
    }


    // 1) /지급완료
    const logCommand = new SlashCommandBuilder()
        .setName('지급완료')
        .setDescription('구매 완료 로그를 전송합니다.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option => option.setName('구매자').setDescription('구매한 유저').setRequired(true))
        .addStringOption(option => option.setName('상품').setDescription('구매한 상품명').setRequired(true))
        .addStringOption(option => option.setName('수량').setDescription('구매한 수량').setRequired(true))
        .addStringOption(option => option.setName('금액').setDescription('사용된 금액').setRequired(true))
        .addUserOption(option => option.setName('판매자').setDescription('해당 관리 판매자 (미선택 시 명령어 사용자로 지정)').setRequired(false));

    // 2) /패널
    const panelCommand = new SlashCommandBuilder()
        .setName('패널')
        .setDescription('안내 패널을 생성합니다.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    // 3) /서바이벌
    const survivalCommand = new SlashCommandBuilder()
        .setName('서바이벌')
        .setDescription('서바이벌 패널을 생성합니다.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    // 명령어 등록
    await client.application.commands.create(logCommand);
    console.log('/지급완료 명령어가 등록되었습니다.');

    await client.application.commands.create(panelCommand);
    console.log('/패널 명령어가 등록되었습니다.');

    await client.application.commands.create(survivalCommand);
    console.log('/서바이벌 명령어가 등록되었습니다.');

});


// ========================================
// 버튼 / 인터랙션
// ========================================

client.on('interactionCreate', async interaction => {

    // ========================================
    // 버튼 클릭 이벤트
    // ========================================
    if (interaction.isButton()) {

        if (interaction.customId === 'notice_btn') {
            await interaction.reply({
                content:
                    `### <#1457384179535712473> 미작성 시 주의사항\n` +
                    `-# - 2일 내 작성하지 않으면 <@&1550129139086794852> 지급돼요.\n` +
                    `-# - 해당 역할 보유 시 다음 번 구매가 어려울 수 있어요.`,
                ephemeral: true
            });
            return;
        }

        if (interaction.customId === 'panel_inquiry') {
            await interaction.reply({ content: '문의사항이 있다면 관리자에게 문의해주세요.', ephemeral: true });
            return;
        }

        if (interaction.customId === 'panel_apply') {
            await interaction.reply({ content: '신청을 진행하려면 안내사항을 먼저 확인해주세요.', ephemeral: true });
            return;
        }

        if (interaction.customId === 'panel_rules') {
            await interaction.reply({ content: '서버 이용 규정을 확인해주세요.', ephemeral: true });
            return;
        }

        if (interaction.customId === 'panel_help') {
            await interaction.reply({ content: '도움이 필요한 경우 관리자에게 문의해주세요.', ephemeral: true });
            return;
        }

        // 서바이벌 버튼 응답
        if (interaction.customId === 'survival_info') {
            await interaction.reply({ content: '⚔️ 현재 서바이벌 시즌 1 진행 중입니다.', ephemeral: true });
            return;
        }

        if (interaction.customId === 'survival_rules') {
            await interaction.reply({ content: '📜 **서바이벌 규칙**: 테러, 핵 사용 금지', ephemeral: true });
            return;
        }

        if (interaction.customId === 'survival_shop') {
            await interaction.reply({ content: '🛒 상점 기능은 상점 채널을 이용해 주세요.', ephemeral: true });
            return;
        }

        return;
    }


    // 슬래시 명령어가 아니면 종료
    if (!interaction.isChatInputCommand()) return;


    // ========================================
    // /서바이벌 (Components V2 / SeparatorBuilder 적용)
    // ========================================
    if (interaction.commandName === '서바이벌') {

        const title = new TextDisplayBuilder()
            .setContent('## ⚔️ 서바이벌 콘텐츠 안내');

        const description = new TextDisplayBuilder()
            .setContent(
                '서바이벌 모드에 오신 것을 환영합니다!\n' +
                '아래 버튼을 눌러 관련 정보를 확인하세요.'
            );

        const separator1 = new SeparatorBuilder();
        const separator2 = new SeparatorBuilder();

        const survivalButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('survival_info').setLabel('정보 확인').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('survival_rules').setLabel('서바이벌 규칙').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('survival_shop').setLabel('상점').setStyle(ButtonStyle.Success)
        );

        const survivalPanel = new ContainerBuilder()
            .setAccentColor(LIGHT_PINK_COLOR)
            .addTextDisplayComponents(title)
            .addSeparatorComponents(separator1)
            .addTextDisplayComponents(description)
            .addSeparatorComponents(separator2)
            .addActionRowComponents(survivalButtons);

        await interaction.channel.send({
            components: [survivalPanel],
            flags: MessageFlags.IsComponentsV2
        });

        await interaction.reply({
            content: '서바이벌 패널을 생성했습니다.',
            ephemeral: true
        });

        return;
    }


    // ========================================
    // /패널
    // ========================================
    if (interaction.commandName === '패널') {

        const title = new TextDisplayBuilder().setContent('## ✦ 서버 이용 안내');
        const description = new TextDisplayBuilder().setContent(
            '필요한 메뉴를 아래에서 선택해주세요.\n' +
            '각 버튼을 눌러 관련 안내를 확인할 수 있습니다.'
        );

        const panelButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel_inquiry').setLabel('문의').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('panel_apply').setLabel('신청').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('panel_rules').setLabel('규정').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('panel_help').setLabel('도움말').setStyle(ButtonStyle.Secondary)
        );

        const panel = new ContainerBuilder()
            .setAccentColor(LIGHT_PINK_COLOR)
            .addTextDisplayComponents(title)
            .addTextDisplayComponents(description)
            .addActionRowComponents(panelButtons);

        await interaction.channel.send({
            components: [panel],
            flags: MessageFlags.IsComponentsV2
        });

        await interaction.reply({
            content: '패널을 생성했습니다.',
            ephemeral: true
        });

        return;
    }


    // ========================================
    // /지급완료
    // ========================================
    if (interaction.commandName === '지급완료') {

        await interaction.reply({ content: '지급완료를 처리 중입니다. . .', ephemeral: true });

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

        await logChannel.send({ content: `${buyer}`, embeds: [logEmbed] });

        const replyEmbed = new EmbedBuilder()
            .setColor(LIGHT_PINK_COLOR)
            .setDescription(
                `**아이템이 정상적으로 지급되었어요.**\n` +
                `**https://discord.com/channels/1456729030459134115/1457384179535712473 작성은 필수입니다.**`
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('notice_btn').setLabel('주의사항').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setLabel('후기작성').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${interaction.guildId}/1457384179535712473`)
        );

        await interaction.channel.send({
            content: `${buyer}`,
            embeds: [replyEmbed],
            components: [row]
        });

        return;
    }

});


// ========================================
// $가격 / $로벅스 / $서바이벌
// ========================================

client.on('messageCreate', async message => {

    if (message.author.bot) return;

    const args = message.content.trim().split(/\s+/);
    const command = args[0];

    switch (command) {

        case '$서바이벌': {
            const embed = new EmbedBuilder()
                .setColor(LIGHT_PINK_COLOR)
                .setTitle('⚔️ 서바이벌 정보')
                .setDescription('`$서바이벌` 명령어가 실행되었습니다.');

            return message.channel.send({ embeds: [embed] });
        }

        case '$가격':
        case '$로벅스': {

            if (!message.member || !message.member.roles.cache.has(CALCULATOR_ROLE_ID)) {
                return message.reply('해당 명령어를 사용할 권한이 없습니다.');
            }

            const tempMsg = await message.reply('계산을 진행 중입니다 . .');

            try {
                if (message.deletable) await message.delete();
            } catch (err) {
                console.error('유저 메시지 삭제 권한 오류:', err);
            }

            await sleep(2000);

            try {
                if (tempMsg.deletable) await tempMsg.delete();
            } catch (err) {
                console.error('안내 메시지 삭제 오류:', err);
            }

            if (command === '$가격') {
                const rate = parseFloat(args[1]);
                const robux = parseFloat(args[2]);

                if (isNaN(rate) || isNaN(robux) || rate <= 0 || robux <= 0) {
                    return message.channel.send(
                        '올바른 사용법: `$가격 (만 원당 로벅스량) (구매할 로벅스 수)`\n' +
                        '예시: `$가격 1300 240`'
                    );
                }

                const rawPrice = (robux / rate) * 10000;
                const finalPrice = Math.ceil(rawPrice / 100) * 100;

                const embed = new EmbedBuilder()
                    .setColor(LIGHT_PINK_COLOR)
                    .setDescription(
                        `## [ ! ] 로벅스 가격 결과 <:robux:1554139067913080882>\n` +
                        `**만 원당 로벅스 가격 : \`${rate.toLocaleString()}\`\n` +
                        `구매할 로벅스 수량 : \`${robux.toLocaleString()}\`**\n\n` +
                        `**계산된 로벅스 가격 = \`${finalPrice.toLocaleString()}\`원**`
                    );

                return message.channel.send({ embeds: [embed] });
            }

            if (command === '$로벅스') {
                const rate = parseFloat(args[1]);
                const money = parseFloat(args[2]);

                if (isNaN(rate) || isNaN(money) || rate <= 0 || money <= 0) {
                    return message.channel.send(
                        '올바른 사용법: `$로벅스 (만 원당 로벅스량) (보낼 돈)`\n' +
                        '예시: `$로벅스 1300 1900`'
                    );
                }

                const totalRobux = Math.floor((money / 10000) * rate);

                const embed = new EmbedBuilder()
                    .setColor(LIGHT_PINK_COLOR)
                    .setDescription(
                        `## [ ! ] 지급 로벅스 결과 <:robux:1554139067913080882>\n` +
                        `**만 원당 로벅스 가격 : \`${rate.toLocaleString()}\`\n` +
                        `보낼 금액 : \`${money.toLocaleString()}\`원**\n\n` +
                        `**계산된 로벅스 수량 = \`${totalRobux.toLocaleString()}\` R$**`
                    );

                return message.channel.send({ embeds: [embed] });
            }

            break;
        }
    }

});


// ========================================
// TOKEN 확인 및 로그인
// ========================================

if (!process.env.TOKEN) {
    console.error("오류: Variables에 'TOKEN'이 설정되어 있지 않습니다!");
    process.exit(1);
}

client.login(process.env.TOKEN);
