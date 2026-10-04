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

// ========================================
// 🎲 데이터 저장소 (1인 1회 선택 제한 메모리)
// ========================================
// Key: MessageID_UserID -> Value: 'cooperate' | 'betray'
const userChoices = new Map();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));


// ========================================
// 봇 준비 & 슬래시 명령어 등록
// ========================================

client.once('ready', async () => {

    console.log(`[릴리웨이] 봇이 성공적으로 실행되었습니다: ${client.user.tag}`);

    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

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
        .addUserOption(option => option.setName('판매자').setDescription('해당 관리 판매자').setRequired(false));

    // 2) /패널
    const panelCommand = new SlashCommandBuilder()
        .setName('패널')
        .setDescription('안내 패널을 생성합니다.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    // 3) /협력배신패널 (시간, 제목, 문구 옵션)
    const coopBetrayCommand = new SlashCommandBuilder()
        .setName('협력배신패널')
        .setDescription('시간 제한이 있는 협력/배신 선택 패널을 생성합니다.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addIntegerOption(option =>
            option.setName('시간_분')
                .setDescription('패널을 몇 분 동안 진행할지 설정하세요. (예: 10)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('제목')
                .setDescription('패널 제목 (기본값: 🤝 협력 vs 🗡️ 배신)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('문구')
                .setDescription('패널 추가 설명 문구')
                .setRequired(false)
        );

    await client.application.commands.create(logCommand);
    await client.application.commands.create(panelCommand);
    await client.application.commands.create(coopBetrayCommand);
    console.log('슬래시 명령어들이 성공적으로 등록되었습니다.');

});


// ========================================
// 인터랙션 (버튼 & 슬래시 명령어)
// ========================================

client.on('interactionCreate', async interaction => {

    // ========================================
    // 버튼 클릭 이벤트
    // ========================================
    if (interaction.isButton()) {

        // 기존 일반 패널 버튼들
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


        // ========================================
        // 🤝 협력 / 🗡️ 배신 버튼 클릭 반응
        // ========================================
        if (interaction.customId === 'game_cooperate' || interaction.customId === 'game_betray') {

            const messageId = interaction.message.id;
            const userId = interaction.user.id;
            const storageKey = `${messageId}_${userId}`;

            // 이미 선택한 경우 변경 불가
            if (userChoices.has(storageKey)) {
                const existingChoice = userChoices.get(storageKey) === 'cooperate' ? '🤝 협력' : '🗡️ 배신';
                await interaction.reply({
                    content: `❌ 이미 선택을 완료하셨습니다! (선택한 항목: **${existingChoice}**)\n선택은 변경할 수 없습니다.`,
                    ephemeral: true
                });
                return;
            }

            const choiceType = interaction.customId === 'game_cooperate' ? 'cooperate' : 'betray';
            const choiceLabel = choiceType === 'cooperate' ? '🤝 협력' : '🗡️ 배신';

            // 선택 내역 메모리에 저장
            userChoices.set(storageKey, choiceType);

            // 유저에게 응답
            await interaction.reply({
                content: `🔮 **${choiceLabel}**을(를) 선택하셨습니다.\n선택은 변경할 수 없습니다. 결과를 운명에 맡기세요 . . . 🎲`,
                ephemeral: true
            });

            // 📜 로그 채널에 기록 알림 전송
            const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
            if (logChannel) {
                const choiceLogEmbed = new EmbedBuilder()
                    .setColor(choiceType === 'cooperate' ? 0x57F287 : 0xED4245)
                    .setTitle('🎲 [협력/배신] 플레이어 선택 로그')
                    .addFields(
                        { name: '👤 유저', value: `${interaction.user} (${interaction.user.tag})`, inline: true },
                        { name: '🎯 선택한 항목', value: `**${choiceLabel}**`, inline: true },
                        { name: '📌 채널', value: `${interaction.channel}`, inline: true }
                    )
                    .setTimestamp();

                await logChannel.send({ embeds: [choiceLogEmbed] });
            }

            return;
        }

        return;
    }


    if (!interaction.isChatInputCommand()) return;


    // ========================================
    // /협력배신패널 (시간설정, 로그 기록, V2 Component)
    // ========================================
    if (interaction.commandName === '협력배신패널') {

        const durationMinutes = interaction.options.getInteger('시간_분');
        const customTitle = interaction.options.getString('제목') || '🤝 협력 vs 🗡️ 배신';
        const customDescription = interaction.options.getString('문구') || '상대방과의 관계를 생각하여 신중하게 선택하세요!';

        // 마감 시간 계산
        const endTime = Math.floor((Date.now() + durationMinutes * 60 * 1000) / 1000);

        const titleDisplay = new TextDisplayBuilder()
            .setContent(`## ${customTitle}`);

        const descriptionDisplay = new TextDisplayBuilder()
            .setContent(
                `${customDescription}\n\n` +
                `⏳ **마감 시간**: <t:${endTime}:R> (<t:${endTime}:f> 까지)\n` +
                `⚠️ **주의**: 한 번 선택하면 절대로 변경할 수 없습니다.\n\n` +
                `📜 **게임 룰 안내**\n` +
                `• **협력 + 협력** ➔ 전체 이벤트 룰렛\n` +
                `• **배신 + 협력** ➔ 배신자만 이벤트 룰렛\n` +
                `• **배신 + 배신** ➔ 보상 없음`
            );

        const separator1 = new SeparatorBuilder();
        const separator2 = new SeparatorBuilder();

        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('game_cooperate')
                .setLabel('협력')
                .setEmoji('🤝')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('game_betray')
                .setLabel('배신')
                .setEmoji('🗡️')
                .setStyle(ButtonStyle.Danger)
        );

        const panelContainer = new ContainerBuilder()
            .setAccentColor(LIGHT_PINK_COLOR)
            .addTextDisplayComponents(titleDisplay)
            .addSeparatorComponents(separator1)
            .addTextDisplayComponents(descriptionDisplay)
            .addSeparatorComponents(separator2)
            .addActionRowComponents(actionRow);

        // 채널에 패널 전송
        const panelMessage = await interaction.channel.send({
            components: [panelContainer],
            flags: MessageFlags.IsComponentsV2
        });

        await interaction.reply({
            content: `협력/배신 패널이 생성되었습니다. (${durationMinutes}분 후 마감됩니다)`,
            ephemeral: true
        });

        // ========================================
        // ⏱️ 지정된 시간 후 패널 마감 처리 (비활성화)
        // ========================================
        setTimeout(async () => {
            try {
                const closedTitle = new TextDisplayBuilder()
                    .setContent(`## 🔒 ${customTitle} [종료됨]`);

                const closedDescription = new TextDisplayBuilder()
                    .setContent(
                        `🚫 **본 패널 선택이 마감되었습니다.**\n\n` +
                        `📜 **게임 룰**\n` +
                        `• **협력 + 협력** ➔ 전체 이벤트 룰렛\n` +
                        `• **배신 + 협력** ➔ 배신자만 이벤트 룰렛\n` +
                        `• **배신 + 배신** ➔ 보상 없음`
                    );

                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('game_cooperate')
                        .setLabel('협력 (마감)')
                        .setEmoji('🤝')
                        .setStyle(ButtonStyle.Success)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('game_betray')
                        .setLabel('배신 (마감)')
                        .setEmoji('🗡️')
                        .setStyle(ButtonStyle.Danger)
                        .setDisabled(true)
                );

                const closedContainer = new ContainerBuilder()
                    .setAccentColor(0x808080) // 회색으로 변경
                    .addTextDisplayComponents(closedTitle)
                    .addSeparatorComponents(separator1)
                    .addTextDisplayComponents(closedDescription)
                    .addSeparatorComponents(separator2)
                    .addActionRowComponents(disabledRow);

                await panelMessage.edit({
                    components: [closedContainer],
                    flags: MessageFlags.IsComponentsV2
                });

            } catch (err) {
                console.error('패널 마감 처리 실패 (메시지가 삭제되었을 수 있음):', err);
            }
        }, durationMinutes * 60 * 1000);

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
// $가격 / $로벅스
// ========================================

client.on('messageCreate', async message => {

    if (message.author.bot) return;

    const args = message.content.trim().split(/\s+/);
    const command = args[0];

    switch (command) {

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
